package com.moneymap.app;

import android.app.Notification;
import android.os.Bundle;
import android.os.Parcelable;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

public class MoneyMapNotificationListener extends NotificationListenerService {
    private static final Set<String> PAYMENT_PACKAGES = new HashSet<>(Arrays.asList(
        "com.google.android.apps.nbu.paisa.user", // Google Pay
        "com.phonepe.app",                        // PhonePe
        "net.one97.paytm",                        // Paytm
        "in.org.npci.upiapp",                     // BHIM
        "in.amazon.mShop.android.shopping",       // Amazon Pay
        "com.dreamplug.androidapp",               // CRED
        "com.google.android.apps.messaging",      // Google Messages
        "com.samsung.android.messaging",          // Samsung Messages
        "com.android.mms",                        // Default SMS
        "com.oplus.mms",                          // OnePlus / Oppo / Realme Messages
        "com.coloros.mms",                        // ColorOS / RealmeUI Messages
        "com.oneplus.mms",                        // OnePlus Messages
        "com.xiaomi.mms",                         // Xiaomi Messages
        "com.miui.mms",                           // MIUI Messages
        "com.truecaller"                          // Truecaller SMS
    ));

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;
        if (!MoneyMapPrefs.isAutoTrackEnabled(this)) return;

        String pkg = sbn.getPackageName();
        if (pkg == null || pkg.equals(getPackageName())) return;

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
        String subText = charSeqToString(extras.getCharSequence(Notification.EXTRA_SUB_TEXT));
        if (!subText.isEmpty() && !text.contains(subText)) {
            text = (text + " " + subText).trim();
        }
        String combined = (title + " " + text).trim();

        // Check MessagingStyle bundle array (used by Google Messages & grouped SMS alerts)
        if (!MoneyMapExpenseWebhook.looksLikeDebitExpense(combined)) {
            Parcelable[] msgs = extras.getParcelableArray(Notification.EXTRA_MESSAGES);
            if (msgs != null && msgs.length > 0) {
                for (int i = msgs.length - 1; i >= 0; i--) {
                    if (!(msgs[i] instanceof Bundle)) continue;
                    Bundle msgBundle = (Bundle) msgs[i];
                    String msgBody = charSeqToString(msgBundle.getCharSequence("text"));
                    String msgSender = charSeqToString(msgBundle.getCharSequence("sender"));
                    String msgCombined = (msgSender + " " + msgBody).trim();
                    if (MoneyMapExpenseWebhook.looksLikeDebitExpense(msgCombined)) {
                        title = msgSender;
                        text = msgBody;
                        combined = msgCombined;
                        break;
                    }
                }
            }
        }

        // Check InboxStyle line arrays if still not matched (newest may be last or first)
        if (!MoneyMapExpenseWebhook.looksLikeDebitExpense(combined)) {
            CharSequence[] lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
            if (lines != null && lines.length > 0) {
                for (int i = lines.length - 1; i >= 0; i--) {
                    String line = charSeqToString(lines[i]);
                    if (MoneyMapExpenseWebhook.looksLikeDebitExpense(line)) {
                        title = "";
                        text = line;
                        combined = line;
                        break;
                    }
                }
            }
        }
        if (combined.length() < 6) return;

        boolean isKnownApp = PAYMENT_PACKAGES.contains(pkg.toLowerCase(Locale.ROOT));
        if (!isKnownApp && !MoneyMapExpenseWebhook.looksLikeDebitExpense(combined)) return;

        if (isKnownApp && !MoneyMapExpenseWebhook.looksLikeDebitExpense(combined)) {
            MoneyMapExpenseWebhook.recordFilteredEvent(this, "NOTIFICATION", pkg, combined);
            return;
        }

        MoneyMapExpenseWebhook.submitNotificationAsync(this, title, text, pkg, null);
    }

    private static String charSeqToString(CharSequence cs) {
        return cs == null ? "" : cs.toString().trim();
    }
}
