package com.moneymap.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Receives incoming bank/UPI debit SMS directly from Android telephony
 * (works even when payment apps or Messages use App Lock with hidden notifications).
 */
public class MoneyMapSmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        if (!MoneyMapPrefs.isSmsAutoTrackEnabled(context)) return;

        SmsMessage[] messages = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (messages == null || messages.length == 0) return;

        // Reassemble multi-part SMS messages grouped by sender
        Map<String, StringBuilder> bySender = new LinkedHashMap<>();
        for (SmsMessage sms : messages) {
            if (sms == null) continue;
            String body = sms.getDisplayMessageBody();
            if (body == null || body.isEmpty()) body = sms.getMessageBody();
            if (body == null || body.isEmpty()) continue;

            String sender = sms.getOriginatingAddress();
            String key = sender != null ? sender : "unknown";
            bySender.computeIfAbsent(key, k -> new StringBuilder()).append(body);
        }

        if (bySender.isEmpty()) return;

        PendingResult pendingResult = goAsync();
        AtomicInteger remaining = new AtomicInteger(bySender.size());

        for (StringBuilder fullBody : bySender.values()) {
            String text = fullBody.toString().trim();
            MoneyMapExpenseWebhook.submitAsync(context, text, () -> {
                if (remaining.decrementAndGet() == 0 && pendingResult != null) {
                    pendingResult.finish();
                }
            });
        }
    }
}
