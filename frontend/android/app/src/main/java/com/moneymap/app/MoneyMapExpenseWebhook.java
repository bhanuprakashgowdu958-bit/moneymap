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
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Shared debit/credit detection, cross-source deduplication, offline retry queue,
 * and webhook uploader used by both MoneyMapSmsReceiver and MoneyMapNotificationListener.
 */
public final class MoneyMapExpenseWebhook {
    private static final String TAG = "MoneyMapWebhook";
    private static final long DEDUPE_WINDOW_MS = 30_000L;
    private static final long MAX_QUEUE_AGE_MS = 7L * 24L * 60L * 60L * 1000L;
    private static final int MAX_QUEUE_SIZE = 50;

    private enum SendResult {
        SUCCESS,
        DROP_PERMANENT,
        RETRY_TRANSIENT
    }

    private static final Pattern DEBIT_SIGNAL = Pattern.compile(
        "(?:debited|paid\\s+(?:to|rs|inr|₹)|payment\\s+(?:of\\s+)?(?:rs|inr|₹)|sent\\s+(?:rs|inr|₹)|spent|withdrawn|deducted|charged|purchase|recharged?|bill\\s+(?:paid|payment)|dr\\.?\\s+(?:rs|inr|₹)|you\\s+(?:paid|sent))",
        Pattern.CASE_INSENSITIVE
    );

    private static final Pattern CREDIT_SIGNAL = Pattern.compile(
        "(?:credited|received|deposited|refund|cashback|salary|paid\\s+you|sent\\s+you|to\\s+you|credit\\s+(?:of|to|in)|cr\\.?\\s+(?:to|by))",
        Pattern.CASE_INSENSITIVE
    );

    private static final Pattern GENERIC_BANK_SIGNAL = Pattern.compile(
        "(?:upi|vpa|a/c|acct|account|bbps)",
        Pattern.CASE_INSENSITIVE
    );

    private static final Pattern IGNORE_SIGNAL = Pattern.compile(
        "\\b(?:otp|one\\s+time\\s+password|verification\\s+code|payment\\s+request|collect\\s+request|has\\s+requested|requested\\s+(?:rs|inr|₹|money)|approve\\s+to\\s+pay|mandate\\s+(?:created|approved)|autopay\\s+(?:created|registered)|bill\\s+due|minimum\\s+due|pre-?approved\\s+loan|transaction\\s+failed|payment\\s+failed|declined|unsuccessful|cancelled|canceled)\\b",
        Pattern.CASE_INSENSITIVE
    );

    private static final Pattern AMOUNT_SIGNAL = Pattern.compile(
        "(?:rs\\.?|inr|₹)\\s*([0-9,]+(?:\\.[0-9]{1,2})?)",
        Pattern.CASE_INSENSITIVE
    );

    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final ConcurrentHashMap<String, Long> RECENT_EVENTS = new ConcurrentHashMap<>();
    private static final Object QUEUE_LOCK = new Object();
    private static final AtomicBoolean NETWORK_CALLBACK_REGISTERED = new AtomicBoolean(false);

    private MoneyMapExpenseWebhook() {}

    public static boolean looksLikeDebitExpense(String text) {
        if (text == null || text.trim().length() < 8) return false;
        if (IGNORE_SIGNAL.matcher(text).find()) return false;
        boolean hasSignal = DEBIT_SIGNAL.matcher(text).find()
            || CREDIT_SIGNAL.matcher(text).find()
            || GENERIC_BANK_SIGNAL.matcher(text).find();
        return hasSignal && AMOUNT_SIGNAL.matcher(text).find();
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

        String dedupeKey = buildDedupeKey(rawText);
        long now = System.currentTimeMillis();
        pruneExpired(now);

        Long previous = RECENT_EVENTS.putIfAbsent(dedupeKey, now);
        if (previous != null && (now - previous) < DEDUPE_WINDOW_MS) {
            if (onComplete != null) onComplete.run();
            return;
        }
        if (previous != null) {
            RECENT_EVENTS.put(dedupeKey, now);
        }

        JSONObject payload = buildPayload(rawText, safeTitle, safeBody, sourcePackage, now);
        if (payload == null) {
            if (onComplete != null) onComplete.run();
            return;
        }

        Context appCtx = context.getApplicationContext();
        registerNetworkCallback(appCtx);

        EXECUTOR.execute(() -> {
            try {
                String webhookUrl = MoneyMapPrefs.getWebhookUrl(appCtx);
                if (webhookUrl == null || webhookUrl.isEmpty() || !isNetworkAvailable(appCtx)) {
                    enqueuePending(appCtx, payload);
                    return;
                }

                // Flush older offline events first to keep chronological order
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
            // SUCCESS or DROP_PERMANENT removes item from queue
        }

        synchronized (QUEUE_LOCK) {
            // Re-merge in case anything new arrived while flushing
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
        String dir = CREDIT_SIGNAL.matcher(text).find() ? "cr:" : "dr:";
        Matcher m = AMOUNT_SIGNAL.matcher(text);
        if (m.find() && m.group(1) != null) {
            String normalizedAmt = m.group(1).replace(",", "").replaceAll("\\.00$", "");
            return dir + "amt:" + normalizedAmt;
        }
        return dir + "txt:" + text.trim().toLowerCase(Locale.ROOT);
    }

    private static void pruneExpired(long now) {
        if (RECENT_EVENTS.size() < 32) return;
        Iterator<Map.Entry<String, Long>> it = RECENT_EVENTS.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<String, Long> entry = it.next();
            if ((now - entry.getValue()) > DEDUPE_WINDOW_MS * 2) {
                it.remove();
            }
        }
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
