package com.moneymap.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.Telephony;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Fallback SMS inbox scanner that reads recent bank/UPI SMS messages on app open/resume
 * when READ_SMS is granted, recovering payments missed if OEM battery rules killed the
 * background SMS_RECEIVED broadcast or before permissions were enabled.
 */
public final class MoneyMapSmsInboxReader {
    private static final long LOOKBACK_WINDOW_MS = 48L * 60L * 60L * 1000L;
    private static final int MAX_SCAN_ROWS = 60;
    private static final int MAX_SEEN_IDS = 300;
    private static final ExecutorService SCAN_EXECUTOR = Executors.newSingleThreadExecutor();
    private static final Object SCAN_LOCK = new Object();

    private MoneyMapSmsInboxReader() {}

    public static void syncRecentInboxAsync(Context context) {
        if (context == null) return;
        Context appCtx = context.getApplicationContext();
        SCAN_EXECUTOR.execute(() -> syncRecentInboxBlocking(appCtx));
    }

    public static int syncRecentInboxBlocking(Context context) {
        if (context == null) return 0;
        Context appCtx = context.getApplicationContext();

        if (!MoneyMapPrefs.isSmsAutoTrackEnabled(appCtx)) return 0;
        if (ContextCompat.checkSelfPermission(appCtx, Manifest.permission.READ_SMS)
            != PackageManager.PERMISSION_GRANTED) {
            return 0;
        }

        String webhookUrl = MoneyMapPrefs.getWebhookUrl(appCtx);
        if (webhookUrl == null || webhookUrl.isEmpty()) {
            return 0;
        }

        synchronized (SCAN_LOCK) {
            int submittedCount = 0;
            Set<String> seenIds = readSeenIds(appCtx);
            long minDateMs = System.currentTimeMillis() - LOOKBACK_WINDOW_MS;

            Uri inboxUri = Telephony.Sms.Inbox.CONTENT_URI;
            String[] projection = {
                Telephony.Sms._ID,
                Telephony.Sms.ADDRESS,
                Telephony.Sms.BODY,
                Telephony.Sms.DATE
            };
            String selection = Telephony.Sms.DATE + " >= ?";
            String[] selectionArgs = { String.valueOf(minDateMs) };
            String sortOrder = Telephony.Sms.DATE + " DESC LIMIT " + MAX_SCAN_ROWS;

            try (Cursor cursor = appCtx.getContentResolver().query(
                inboxUri,
                projection,
                selection,
                selectionArgs,
                sortOrder
            )) {
                if (cursor == null) return 0;

                int idxId = cursor.getColumnIndex(Telephony.Sms._ID);
                int idxAddr = cursor.getColumnIndex(Telephony.Sms.ADDRESS);
                int idxBody = cursor.getColumnIndex(Telephony.Sms.BODY);
                int idxDate = cursor.getColumnIndex(Telephony.Sms.DATE);

                while (cursor.moveToNext()) {
                    String smsId = idxId >= 0 ? cursor.getString(idxId) : null;
                    String addr = idxAddr >= 0 ? cursor.getString(idxAddr) : "";
                    String body = idxBody >= 0 ? cursor.getString(idxBody) : "";
                    long smsDateMs = idxDate >= 0 ? cursor.getLong(idxDate) : System.currentTimeMillis();

                    if (smsId == null || smsId.isEmpty() || seenIds.contains(smsId)) continue;
                    seenIds.add(smsId);

                    if (body == null || body.trim().length() < 6) continue;
                    String trimmed = body.trim();
                    if (!MoneyMapExpenseWebhook.looksLikeDebitExpense(trimmed)) {
                        MoneyMapExpenseWebhook.recordFilteredEvent(
                            appCtx,
                            "SMS_INBOX",
                            addr != null ? addr : "sms",
                            trimmed
                        );
                        continue;
                    }

                    boolean submitted = MoneyMapExpenseWebhook.submitHistoricalSmsSync(
                        appCtx,
                        trimmed,
                        smsDateMs,
                        addr != null ? addr : "sms_inbox"
                    );
                    if (submitted) {
                        submittedCount++;
                    }
                }
            } catch (SecurityException se) {
                MoneyMapExpenseWebhook.appendDiagnosticLog(appCtx, "SMS_INBOX", "NO_PERMISSION", se.getMessage());
            } catch (Exception e) {
                MoneyMapExpenseWebhook.appendDiagnosticLog(appCtx, "SMS_INBOX", "SCAN_ERROR", e.getMessage());
            }

            writeSeenIds(appCtx, seenIds);
            return submittedCount;
        }
    }

    private static Set<String> readSeenIds(Context context) {
        Set<String> set = new LinkedHashSet<>();
        try {
            JSONArray arr = new JSONArray(MoneyMapPrefs.getSeenSmsIdsJson(context));
            for (int i = 0; i < arr.length(); i++) {
                String id = arr.optString(i, "");
                if (!id.isEmpty()) set.add(id);
            }
        } catch (Exception ignored) {}
        return set;
    }

    private static void writeSeenIds(Context context, Set<String> seenIds) {
        JSONArray arr = new JSONArray();
        int skip = Math.max(0, seenIds.size() - MAX_SEEN_IDS);
        int idx = 0;
        for (String id : seenIds) {
            if (idx++ >= skip) {
                arr.put(id);
            }
        }
        MoneyMapPrefs.setSeenSmsIdsJson(context, arr.toString());
    }
}
