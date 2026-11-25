package com.moneymap.app;

import android.content.Context;
import android.content.SharedPreferences;

public final class MoneyMapPrefs {
    private static final String PREF_NAME = "MoneyMapAutoTrackPrefs";
    private static final String KEY_WEBHOOK_URL = "webhook_url";
    private static final String KEY_BUDGET_CHECK_BASE = "budget_check_base";
    private static final String KEY_AUTO_TRACK = "auto_track_enabled";
    private static final String KEY_SMS_AUTO_TRACK = "sms_auto_track_enabled";
    private static final String KEY_APP_GUARD = "app_guard_enabled";
    private static final String KEY_LAST_GUARD_ALERTS = "last_guard_alerts";

    private MoneyMapPrefs() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
    }

    public static void setConfig(Context context, String webhookUrl, String budgetCheckBase) {
        SharedPreferences.Editor ed = prefs(context).edit();
        if (webhookUrl != null) ed.putString(KEY_WEBHOOK_URL, webhookUrl.trim());
        if (budgetCheckBase != null) ed.putString(KEY_BUDGET_CHECK_BASE, budgetCheckBase.trim());
        ed.apply();
    }

    public static String getWebhookUrl(Context context) {
        return prefs(context).getString(KEY_WEBHOOK_URL, "");
    }

    public static String getBudgetCheckBase(Context context) {
        return prefs(context).getString(KEY_BUDGET_CHECK_BASE, "");
    }

    public static boolean isAutoTrackEnabled(Context context) {
        return prefs(context).getBoolean(KEY_AUTO_TRACK, true);
    }

    public static void setAutoTrackEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(KEY_AUTO_TRACK, enabled).apply();
    }

    public static boolean isSmsAutoTrackEnabled(Context context) {
        return prefs(context).getBoolean(KEY_SMS_AUTO_TRACK, true);
    }

    public static void setSmsAutoTrackEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(KEY_SMS_AUTO_TRACK, enabled).apply();
    }

    public static boolean isAppGuardEnabled(Context context) {
        return prefs(context).getBoolean(KEY_APP_GUARD, false);
    }

    public static void setAppGuardEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(KEY_APP_GUARD, enabled).apply();
    }

    public static long getLastGuardAlertTime(Context context, String pkg) {
        return prefs(context).getLong(KEY_LAST_GUARD_ALERTS + "_" + pkg, 0L);
    }

    public static void setLastGuardAlertTime(Context context, String pkg, long ts) {
        prefs(context).edit().putLong(KEY_LAST_GUARD_ALERTS + "_" + pkg, ts).apply();
    }
}
