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
        "com.dreamplug.androidapp"                // CRED
    ));

    private static final Set<String> SMS_PACKAGES = new HashSet<>(Arrays.asList(
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

    private static final Set<String> IGNORED_CHAT_PACKAGES = new HashSet<>(Arrays.asList(
        "com.whatsapp",
        "com.whatsapp.w4b",
        "org.telegram.messenger",
        "org.telegram.messenger.web",
        "com.instagram.android",
        "com.facebook.orca",
        "com.snapchat.android",
        "com.discord",
        "org.thoughtcrime.securesms",
        "com.Slack",
        "com.microsoft.teams"
    ));

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;
        if (!MoneyMapPrefs.isAutoTrackEnabled(this)) return;

        String pkg = sbn.getPackageName();
        if (pkg == null || pkg.equals(getPackageName())) return;
        String lowerPkg = pkg.toLowerCase(Locale.ROOT);
        if (IGNORED_CHAT_PACKAGES.contains(lowerPkg)) return;

        boolean isSmsApp = SMS_PACKAGES.contains(lowerPkg);
        boolean isPaymentApp = PAYMENT_PACKAGES.contains(lowerPkg) || isKnownBankPackage(lowerPkg);
        if (!isSmsApp && !isPaymentApp) return;

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
        String senderForSmsCheck = title;

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
                        senderForSmsCheck = !msgSender.isEmpty() ? msgSender : title;
                        text = msgBody;
                        combined = msgCombined;
                        break;
                    }
                }
            }
        }

        // Check InboxStyle line arrays if still not matched
        if (!MoneyMapExpenseWebhook.looksLikeDebitExpense(combined)) {
            CharSequence[] lines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
            if (lines != null && lines.length > 0) {
                for (int i = lines.length - 1; i >= 0; i--) {
                    String line = charSeqToString(lines[i]);
                    if (MoneyMapExpenseWebhook.looksLikeDebitExpense(line)) {
                        int colonIdx = line.indexOf(':');
                        if (isSmsApp && colonIdx > 0 && colonIdx < 24) {
                            senderForSmsCheck = line.substring(0, colonIdx).trim();
                        }
                        title = "";
                        text = line;
                        combined = line;
                        break;
                    }
                }
            }
        }
        if (combined.length() < 6) return;

        if (isSmsApp && !MoneyMapExpenseWebhook.isTrustedSmsNotificationSender(senderForSmsCheck)) {
            if (MoneyMapExpenseWebhook.looksLikeDebitExpense(combined)) {
                MoneyMapExpenseWebhook.appendDiagnosticLog(
                    this,
                    "NOTIFICATION:" + pkg,
                    "IGNORED_PERSONAL_SENDER",
                    (senderForSmsCheck + ": " + combined).trim()
                );
            }
            return;
        }

        if (!MoneyMapExpenseWebhook.looksLikeDebitExpense(combined)) {
            MoneyMapExpenseWebhook.recordFilteredEvent(this, "NOTIFICATION", pkg, combined);
            return;
        }

        MoneyMapExpenseWebhook.submitNotificationAsync(this, title, text, pkg, null);
    }

    private static boolean isKnownBankPackage(String lowerPkg) {
        return lowerPkg.contains("bank")
            || lowerPkg.contains("upi")
            || lowerPkg.contains("sbi")
            || lowerPkg.contains("hdfc")
            || lowerPkg.contains("icici")
            || lowerPkg.contains("axis")
            || lowerPkg.contains("kotak")
            || lowerPkg.contains("union")
            || lowerPkg.contains("canara")
            || lowerPkg.contains("payzapp")
            || lowerPkg.contains("paisa")
            || lowerPkg.contains("bharatpe")
            || lowerPkg.contains("jupiter")
            || lowerPkg.contains("mobikwik")
            || lowerPkg.contains("freecharge")
            || lowerPkg.contains("slice");
    }

    private static String charSeqToString(CharSequence cs) {
        return cs == null ? "" : cs.toString().trim();
    }
}
