package com.moneymap.app;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

public class MoneyMapNotificationListener extends NotificationListenerService {
    private static final String TAG = "MoneyMapNotifListener";
    private static final long DEDUPE_WINDOW_MS = 30_000L;

    private static final Set<String> PAYMENT_PACKAGES = new HashSet<>(Arrays.asList(
        "com.google.android.apps.nbu.paisa.user", // Google Pay
        "com.phonepe.app",                        // PhonePe
        "net.one97.paytm",                        // Paytm
        "in.org.npci.upiapp",                     // BHIM
        "in.amazon.mShop.android.shopping",       // Amazon Pay
        "com.dreamplug.androidapp",               // CRED
        "com.google.android.apps.messaging",      // Google Messages
        "com.samsung.android.messaging",          // Samsung Messages
        "com.android.mms"                         // Default SMS
    ));

    private static final Pattern DEBIT_SIGNAL = Pattern.compile(
        "(?:debited|paid\\s+to|sent\\s+(?:rs|inr|₹)|spent|purchase|upi|a/c|acct)",
        Pattern.CASE_INSENSITIVE
    );

    private static final Pattern AMOUNT_SIGNAL = Pattern.compile(
        "(?:rs\\.?|inr|₹)\\s*[0-9,]+",
        Pattern.CASE_INSENSITIVE
    );

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final ConcurrentHashMap<String, Long> recentMap = new ConcurrentHashMap<>();

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;
        if (!MoneyMapPrefs.isAutoTrackEnabled(this)) return;

        String pkg = sbn.getPackageName();
        if (pkg == null || pkg.equals(getPackageName())) return;

        String webhookUrl = MoneyMapPrefs.getWebhookUrl(this);
        if (webhookUrl == null || webhookUrl.isEmpty()) return;

        Notification notification = sbn.getNotification();
        if (notification == null || (notification.flags & Notification.FLAG_ONGOING_EVENT) != 0) {
            return;
        }

        Bundle extras = notification.extras;
        if (extras == null) return;

        String title = charSeqToString(extras.getCharSequence(Notification.EXTRA_TITLE));
        String text = charSeqToString(extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
        if (text.isEmpty()) {
            text = charSeqToString(extras.getCharSequence(Notification.EXTRA_TEXT));
        }
        String combined = (title + " " + text).trim();
        if (combined.length() < 8) return;

        boolean isKnownApp = PAYMENT_PACKAGES.contains(pkg.toLowerCase(Locale.ROOT));
        boolean looksLikePayment = DEBIT_SIGNAL.matcher(combined).find() && AMOUNT_SIGNAL.matcher(combined).find();

        if (!isKnownApp && !looksLikePayment) return;
        if (!looksLikePayment) return;

        long now = System.currentTimeMillis();
        String dedupeKey = pkg + "|" + combined;
        Long prev = recentMap.get(dedupeKey);
        if (prev != null && (now - prev) < DEDUPE_WINDOW_MS) {
            return;
        }
        recentMap.put(dedupeKey, now);

        executor.execute(() -> postToWebhook(webhookUrl, combined));
    }

    private void postToWebhook(String webhookUrl, String smsText) {
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
                        this,
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

    private static String charSeqToString(CharSequence cs) {
        return cs == null ? "" : cs.toString().trim();
    }

    @Override
    public void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }
}
