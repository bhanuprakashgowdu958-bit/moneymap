package com.moneymap.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Shared debit/credit detection, persisted cross-source deduplication, offline retry queue,
 * and webhook uploader used by both MoneyMapSmsReceiver and MoneyMapNotificationListener.
 */
public final class MoneyMapExpenseWebhook {
    private static final String TAG = "MoneyMapWebhook";
    private static final long DEDUPE_WINDOW_MS = 90_000L;
    private static final long MAX_QUEUE_AGE_MS = 7L * 24L * 60L * 60L * 1000L;
    private static final int MAX_QUEUE_SIZE = 50;

    private enum SendResult {
        SUCCESS,
        DROP_PERMANENT,
        RETRY_TRANSIENT
    }

    private static final Pattern DEBIT_SIGNAL = Pattern.compile(
        "(?:debited|debit\\s+(?:of|from|in)|paid\\s+(?:to|for|at|by|via|rs|inr|₹|[0-9])|payment\\s+(?:of\\s+)?(?:rs|inr|₹|[0-9])|sent\\s+(?:to|rs|inr|₹|[0-9])|transferred(?:\\s+(?:to|from))?|trf\\s+to|spent|withdrawn|deducted|charged|purchase|recharged?|bill\\s+(?:paid|payment)|dr\\.?\\s*(?:from|by|to|rs|inr|₹)|[0-9]\\s*dr\\.?\\b|you\\s+(?:have\\s+)?(?:paid|sent|transferred))",
        Pattern.CASE_INSENSITIVE
    );

    private static final Pattern CREDIT_SIGNAL = Pattern.compile(
        "(?:credited|received|deposited|paid\\s+you|sent\\s+you|to\\s+you|credit\\s+(?:of|to|in)|cr\\.?\\s*(?:to|by|in)|[0-9]\\s*cr\\.?\\b)",
        Pattern.CASE_INSENSITIVE
    );

    private static final Pattern GENERIC_BANK_SIGNAL = Pattern.compile(
        "(?:upi|vpa|a/c|acct|account|bbps)",
        Pattern.CASE_INSENSITIVE
    );

    private static final Pattern IGNORE_SIGNAL = Pattern.compile(
        "\\b(?:otp|one\\s+time\\s+password|verification\\s+code|payment\\s+request|collect\\s+request|has\\s+requested|requested\\s+(?:rs|inr|₹|money)|approve\\s+to\\s+pay|mandate\\s+(?:created|approved)|autopay\\s+(?:created|registered)|bill\\s+due|minimum\\s+due|pre-?approved|transaction\\s+failed|payment\\s+failed|declined|unsuccessful|cancelled|canceled|get\\s+(?:rs|inr|₹|up\\s*to|flat)|win\\s+(?:rs|inr|₹|up\\s*to)|earn\\s+(?:rs|inr|₹|up\\s*to)|avail\\s+(?:rs|inr|₹|up\\s*to)|unlock\\s+(?:rs|inr|₹)|claim\\s+(?:your|now)|chance\\s+to\\s+win|assured\\s+(?:cashback|reward)|up\\s*to\\s+(?:rs\\.?|inr|₹)|upto\\s+(?:rs\\.?|inr|₹)|flat\\s+(?:rs\\.?|inr|₹)?\\s*[0-9,.]+\\s*(?:off|cashback|discount)|scratch\\s+card|voucher|coupon|promo(?:\\s*code)?|use\\s+code|apply\\s+code|valid\\s+(?:till|until)|limited\\s+period|t&c\\s+apply|terms\\s+apply|congratulations|you(?:'ve|\\s+have)\\s+won|lucky\\s+draw|loan\\s+offer|credit\\s+limit|upgrade\\s+your\\s+card|apply\\s+now|shop\\s+(?:for|worth)|min(?:imum)?\\s+(?:spend|order)|cashback\\s+offer|special\\s+offer)\\b",
        Pattern.CASE_INSENSITIVE
    );

    // Supports: "Rs.35", "Rs:35.00", "INR 35", "₹35", "debited by 35.0", "paid 35", "35.00 Rs"
    private static final Pattern AMOUNT_SIGNAL_CURRENCY_PREFIX = Pattern.compile(
        "(?:rs\\.?|inr|₹)\\s*[:\\-]?\\s*([0-9,]+(?:\\.[0-9]{1,2})?)",
        Pattern.CASE_INSENSITIVE
    );

    private static final Pattern AMOUNT_SIGNAL_AFTER_VERB = Pattern.compile(
        "\\b(?:debited|credited|paid|sent|spent|withdrawn|deducted|charged|transferred|received|deposited|recharged?)(?:\\s+(?:by|for|of|with|amount|amt))?\\s*[:\\-]?\\s*(?:rs\\.?|inr|₹)?\\s*([0-9,]+(?:\\.[0-9]{1,2})?)",
        Pattern.CASE_INSENSITIVE
    );

    private static final Pattern AMOUNT_SIGNAL_CURRENCY_SUFFIX = Pattern.compile(
        "\\b([0-9,]+(?:\\.[0-9]{1,2})?)\\s*(?:rs\\.?|rupees|inr)\\b",
        Pattern.CASE_INSENSITIVE
    );

    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final Object DEDUPE_LOCK = new Object();
    private static final Object QUEUE_LOCK = new Object();
    private static final AtomicBoolean NETWORK_CALLBACK_REGISTERED = new AtomicBoolean(false);

    private MoneyMapExpenseWebhook() {}

    public static boolean looksLikeDebitExpense(String text) {
        if (text == null || text.trim().length() < 6) return false;
        if (IGNORE_SIGNAL.matcher(text).find()) return false;
        boolean hasSignal = DEBIT_SIGNAL.matcher(text).find()
            || CREDIT_SIGNAL.matcher(text).find()
            || GENERIC_BANK_SIGNAL.matcher(text).find();
        return hasSignal && extractAmountString(text) != null;
    }

    /**
     * Registers a default network callback so offline-queued SMS/notifications
     * automatically upload as soon as mobile data or Wi-Fi reconnects.
     */
    public static void registerNetworkCallback(Context context) {
        if (context == null) return;
        if (!NETWORK_CALLBACK_REGISTERED.compareAndSet(false, true)) return;

        Context appCtx = context.getApplicationContext();
        try {
            ConnectivityManager cm = (ConnectivityManager) appCtx.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) {
                NETWORK_CALLBACK_REGISTERED.set(false);
                return;
            }
            cm.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    flushPendingAsync(appCtx);
                }
            });
        } catch (Exception e) {
            NETWORK_CALLBACK_REGISTERED.set(false);
            Log.w(TAG, "Network callback registration skipped: " + e.getMessage());
        }
    }

    /**
     * Attempts to flush any queued offline transactions if a network connection is active.
     */
    public static void flushPendingAsync(Context context) {
        if (context == null) return;
        Context appCtx = context.getApplicationContext();
        EXECUTOR.execute(() -> flushPendingInternal(appCtx));
    }

    /**
     * Enqueues a transaction upload if the same direction + amount has not already been
     * processed within DEDUPE_WINDOW_MS (prevents double-logging when both SMS and
     * notification listeners fire for the same transaction).
     */
    public static void submitAsync(Context context, String rawText, Runnable onComplete) {
        submitNotificationAsync(context, null, rawText, null, onComplete);
    }

    /**
     * Enqueues a notification/SMS upload while preserving separate notification title,
     * body text, and source package, and persisting to an offline retry queue when offline.
     */
    public static void submitNotificationAsync(
        Context context,
        String notificationTitle,
        String notificationText,
        String sourcePackage,
        Runnable onComplete
    ) {
        String safeTitle = notificationTitle == null ? "" : notificationTitle.trim();
        String safeBody = notificationText == null ? "" : notificationText.trim();
        String rawText = (safeTitle + " " + safeBody).trim();

        if (context == null || !looksLikeDebitExpense(rawText)) {
            if (onComplete != null) onComplete.run();
            return;
        }

        Context appCtx = context.getApplicationContext();
        long now = System.currentTimeMillis();
        String dedupeKey = buildDedupeKey(rawText);
        if (isDuplicateAndRecord(appCtx, dedupeKey, now)) {
            if (onComplete != null) onComplete.run();
            return;
        }

        JSONObject payload = buildPayload(rawText, safeTitle, safeBody, sourcePackage, now);
        if (payload == null) {
            if (onComplete != null) onComplete.run();
            return;
        }

        registerNetworkCallback(appCtx);

        EXECUTOR.execute(() -> {
            try {
                String webhookUrl = MoneyMapPrefs.getWebhookUrl(appCtx);
                if (webhookUrl == null || webhookUrl.isEmpty() || !isNetworkAvailable(appCtx)) {
                    enqueuePending(appCtx, payload);
                    return;
                }

                flushPendingInternal(appCtx);

                SendResult result = postPayload(appCtx, webhookUrl, payload);
                if (result == SendResult.RETRY_TRANSIENT) {
                    enqueuePending(appCtx, payload);
                }
            } finally {
                if (onComplete != null) onComplete.run();
            }
        });
    }

    private static String extractAmountString(String text) {
        Pattern[] patterns = {
            AMOUNT_SIGNAL_CURRENCY_PREFIX,
            AMOUNT_SIGNAL_AFTER_VERB,
            AMOUNT_SIGNAL_CURRENCY_SUFFIX
        };
        for (Pattern p : patterns) {
            Matcher m = p.matcher(text);
            if (m.find() && m.group(1) != null) {
                try {
                    String raw = m.group(1).replace(",", "");
                    double val = Double.parseDouble(raw);
                    if (val > 0) {
                        return raw.replaceAll("\\.0+$", "");
                    }
                } catch (NumberFormatException ignored) {}
            }
        }
        return null;
    }

    private static boolean isDuplicateAndRecord(Context context, String dedupeKey, long now) {
        synchronized (DEDUPE_LOCK) {
            try {
                JSONObject map = new JSONObject(MoneyMapPrefs.getRecentDedupeJson(context));
                JSONObject pruned = new JSONObject();
                Iterator<String> keys = map.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    long ts = map.optLong(k, 0L);
                    if ((now - ts) < DEDUPE_WINDOW_MS * 2) {
                        pruned.put(k, ts);
                    }
                }

                long previous = pruned.optLong(dedupeKey, 0L);
                if (previous > 0L && (now - previous) < DEDUPE_WINDOW_MS) {
                    MoneyMapPrefs.setRecentDedupeJson(context, pruned.toString());
                    return true;
                }

                pruned.put(dedupeKey, now);
                MoneyMapPrefs.setRecentDedupeJson(context, pruned.toString());
                return false;
            } catch (Exception e) {
                return false;
            }
        }
    }

    private static JSONObject buildPayload(
        String smsText,
        String notificationTitle,
        String notificationText,
        String sourcePackage,
        long occurredAtMs
    ) {
        try {
            JSONObject body = new JSONObject();
            body.put("text", smsText);
            body.put("occurredAt", occurredAtMs);
            if (notificationTitle != null && !notificationTitle.isEmpty()) {
                body.put("notificationTitle", notificationTitle);
            }
            if (notificationText != null && !notificationText.isEmpty()) {
                body.put("notificationText", notificationText);
            }
            if (sourcePackage != null && !sourcePackage.isEmpty()) {
                body.put("sourcePackage", sourcePackage);
            }
            return body;
        } catch (Exception e) {
            return null;
        }
    }

    private static boolean isNetworkAvailable(Context context) {
        try {
            ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return false;
            Network active = cm.getActiveNetwork();
            if (active == null) return false;
            NetworkCapabilities caps = cm.getNetworkCapabilities(active);
            return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Exception e) {
            return false;
        }
    }

    private static void enqueuePending(Context context, JSONObject payload) {
        synchronized (QUEUE_LOCK) {
            try {
                List<JSONObject> list = readQueueLocked(context);
                list.add(payload);
                while (list.size() > MAX_QUEUE_SIZE) {
                    list.remove(0);
                }
                writeQueueLocked(context, list);
            } catch (Exception e) {
                Log.w(TAG, "Failed to enqueue offline transaction: " + e.getMessage());
            }
        }
    }

    private static void flushPendingInternal(Context context) {
        String webhookUrl = MoneyMapPrefs.getWebhookUrl(context);
        if (webhookUrl == null || webhookUrl.isEmpty() || !isNetworkAvailable(context)) {
            return;
        }

        List<JSONObject> snapshot;
        synchronized (QUEUE_LOCK) {
            snapshot = readQueueLocked(context);
        }
        if (snapshot.isEmpty()) return;

        List<JSONObject> remaining = new ArrayList<>();
        boolean hitTransientFailure = false;

        for (int i = 0; i < snapshot.size(); i++) {
            JSONObject item = snapshot.get(i);
            if (hitTransientFailure) {
                remaining.add(item);
                continue;
            }
            SendResult result = postPayload(context, webhookUrl, item);
            if (result == SendResult.RETRY_TRANSIENT) {
                hitTransientFailure = true;
                remaining.add(item);
            }
        }

        synchronized (QUEUE_LOCK) {
            List<JSONObject> current = readQueueLocked(context);
            List<JSONObject> newlyAdded = new ArrayList<>();
            for (JSONObject item : current) {
                long ts = item.optLong("occurredAt", 0L);
                boolean wasInSnapshot = false;
                for (JSONObject oldItem : snapshot) {
                    if (oldItem.optLong("occurredAt", -1L) == ts &&
                        oldItem.optString("text", "").equals(item.optString("text", ""))) {
                        wasInSnapshot = true;
                        break;
                    }
                }
                if (!wasInSnapshot) {
                    newlyAdded.add(item);
                }
            }
            remaining.addAll(newlyAdded);
            while (remaining.size() > MAX_QUEUE_SIZE) {
                remaining.remove(0);
            }
            writeQueueLocked(context, remaining);
        }
    }

    private static List<JSONObject> readQueueLocked(Context context) {
        List<JSONObject> items = new ArrayList<>();
        long cutoff = System.currentTimeMillis() - MAX_QUEUE_AGE_MS;
        try {
            JSONArray arr = new JSONArray(MoneyMapPrefs.getPendingWebhooksJson(context));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject obj = arr.optJSONObject(i);
                if (obj == null) continue;
                long ts = obj.optLong("occurredAt", System.currentTimeMillis());
                if (ts >= cutoff) {
                    items.add(obj);
                }
            }
        } catch (Exception ignored) {}
        return items;
    }

    private static void writeQueueLocked(Context context, List<JSONObject> items) {
        JSONArray arr = new JSONArray();
        for (JSONObject obj : items) {
            arr.put(obj);
        }
        MoneyMapPrefs.setPendingWebhooksJson(context, arr.toString());
    }

    private static String buildDedupeKey(String text) {
        boolean hasCredit = CREDIT_SIGNAL.matcher(text).find();
        boolean hasExplicitDebit = DEBIT_SIGNAL.matcher(text).find();
        String dir = (hasCredit && !hasExplicitDebit) ? "cr:" : "dr:";
        String amt = extractAmountString(text);
        if (amt != null) {
            return dir + "amt:" + amt;
        }
        return dir + "txt:" + text.trim().toLowerCase(Locale.ROOT);
    }

    private static SendResult postPayload(Context context, String webhookUrl, JSONObject body) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(webhookUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(10000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");

            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(bytes);
            }

            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                StringBuilder sb = new StringBuilder();
                try (BufferedReader br = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = br.readLine()) != null) {
                        sb.append(line);
                    }
                }
                JSONObject res = new JSONObject(sb.toString());
                if (!res.optBoolean("ignored", false)) {
                    String budgetAlert = res.optString("budgetAlert", "");
                    if (!budgetAlert.isEmpty() && !"null".equalsIgnoreCase(budgetAlert)) {
                        MoneyMapNotifier.showBudgetAlert(
                            context,
                            "MoneyMap Budget Alert",
                            budgetAlert,
                            (int) (System.currentTimeMillis() % 100000)
                        );
                    }
                }
                return SendResult.SUCCESS;
            }

            if (code == 429 || code >= 500) {
                return SendResult.RETRY_TRANSIENT;
            }
            return SendResult.DROP_PERMANENT;
        } catch (Exception e) {
            Log.w(TAG, "Webhook sync failed (queued for retry): " + e.getMessage());
            return SendResult.RETRY_TRANSIENT;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
