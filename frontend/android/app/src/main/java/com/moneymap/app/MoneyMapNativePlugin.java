package com.moneymap.app;

import android.Manifest;
import android.app.AppOpsManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "MoneyMapNative",
    permissions = {
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        )
    }
)
public class MoneyMapNativePlugin extends Plugin {

    @Override
    public void load() {
        super.load();
        if (MoneyMapPrefs.isAppGuardEnabled(getContext()) && hasUsageStatsAccess(getContext())) {
            Intent svc = new Intent(getContext(), AppGuardService.class);
            ContextCompat.startForegroundService(getContext(), svc);
        }
    }

    @PluginMethod
    public void syncConfig(PluginCall call) {
        String webhookUrl = call.getString("webhookUrl", "");
        String budgetCheckBase = call.getString("budgetCheckBase", "");
        MoneyMapPrefs.setConfig(getContext(), webhookUrl, budgetCheckBase);
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("isNative", true);
        ret.put("hasNotificationAccess", hasNotificationListenerAccess(getContext()));
        ret.put("hasUsageAccess", hasUsageStatsAccess(getContext()));
        ret.put("hasPostNotifications", hasPostNotificationPermission(getContext()));
        ret.put("autoTrackEnabled", MoneyMapPrefs.isAutoTrackEnabled(getContext()));
        ret.put("appGuardEnabled", MoneyMapPrefs.isAppGuardEnabled(getContext()));
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    @PluginMethod
    public void setAutoTrackEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", true);
        MoneyMapPrefs.setAutoTrackEnabled(getContext(), enabled);
        call.resolve();
    }

    @PluginMethod
    public void setAppGuardEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        MoneyMapPrefs.setAppGuardEnabled(getContext(), enabled);
        Intent svc = new Intent(getContext(), AppGuardService.class);
        if (enabled && hasUsageStatsAccess(getContext())) {
            ContextCompat.startForegroundService(getContext(), svc);
        } else {
            getContext().stopService(svc);
        }
        call.resolve();
    }

    @PluginMethod
    public void openNotificationAccessSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void openUsageAccessSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void openAppInfoSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || hasPostNotificationPermission(getContext())) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationPermCallback");
    }

    @PermissionCallback
    private void notificationPermCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(ret);
    }

    private static boolean hasPostNotificationPermission(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true;
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED;
    }

    private static boolean hasNotificationListenerAccess(Context context) {
        String flat = Settings.Secure.getString(context.getContentResolver(), "enabled_notification_listeners");
        if (flat == null || flat.isEmpty()) return false;
        ComponentName cn = new ComponentName(context, MoneyMapNotificationListener.class);
        return flat.contains(cn.flattenToString()) || flat.contains(cn.flattenToShortString());
    }

    private static boolean hasUsageStatsAccess(Context context) {
        AppOpsManager appOps = (AppOpsManager) context.getSystemService(Context.APP_OPS_SERVICE);
        if (appOps == null) return false;
        int mode;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            mode = appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.getPackageName());
        } else {
            mode = appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.getPackageName());
        }
        return mode == AppOpsManager.MODE_ALLOWED;
    }
}
