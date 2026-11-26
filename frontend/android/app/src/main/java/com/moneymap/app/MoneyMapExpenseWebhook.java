package com.moneymap.app;

import android.content.Context;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Shared debit/credit detection, cross-source deduplication, and webhook uploader
 * used by both MoneyMapSmsReceiver (RECEIVE_SMS) and MoneyMapNotificationListener.
 */
public final class MoneyMapExpenseWebhook {
    private static final String TAG = "MoneyMapWebhook";
    private static final long DEDUPE_WINDOW_MS = 30_000L;

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
     * Enqueues a transaction upload if the same direction + amount has not already been
     * processed within DEDUPE_WINDOW_MS (prevents double-logging when both SMS and
     * notification listeners fire for the same transaction).
     */
    public static void submitAsync(Context context, String rawText, Runnable onComplete) {
        submitNotificationAsync(context, null, rawText, null, onComplete);
    }

    /**
     * Enqueues a notification/SMS upload while preserving separate notification title,
     * body text, and source package so the webhook can isolate sender/recipient names.
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

        String webhookUrl = MoneyMapPrefs.getWebhookUrl(context);
        if (webhookUrl == null || webhookUrl.isEmpty()) {
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

        Context appCtx = context.getApplicationContext();
        EXECUTOR.execute(() -> {
            try {
                postToWebhook(appCtx, webhookUrl, rawText, safeTitle, safeBody, sourcePackage);
            } finally {
                if (onComplete != null) onComplete.run();
            }
        });
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

    private static void postToWebhook(
        Context context,
        String webhookUrl,
        String smsText,
        String notificationTitle,
        String notificationText,
        String sourcePackage
    ) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(webhookUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(10000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");

            JSONObject body = new JSONObject();
            body.put("text", smsText);
            if (notificationTitle != null && !notificationTitle.isEmpty()) {
                body.put("notificationTitle", notificationTitle);
            }
            if (notificationText != null && !notificationText.isEmpty()) {
                body.put("notificationText", notificationText);
            }
            if (sourcePackage != null && !sourcePackage.isEmpty()) {
                body.put("sourcePackage", sourcePackage);
            }
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
                if (res.optBoolean("ignored", false)) return;

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
        } catch (Exception e) {
            Log.w(TAG, "Webhook sync failed: " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
