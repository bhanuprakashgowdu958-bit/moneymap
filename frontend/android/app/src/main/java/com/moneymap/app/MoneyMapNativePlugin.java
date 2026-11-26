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
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "MoneyMapNative",
    permissions = {
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        ),
        @Permission(
            alias = "sms",
            strings = { Manifest.permission.RECEIVE_SMS }
        )
    }
)
public class MoneyMapNativePlugin extends Plugin {
    private static final ExecutorService APK_EXECUTOR = Executors.newSingleThreadExecutor();
    private static final int MAX_REDIRECTS = 6;
    private static final long MIN_APK_BYTES = 100 * 1024L;

    @Override
    public void load() {
        super.load();
        cleanupOldApkCache();
        MoneyMapExpenseWebhook.registerNetworkCallback(getContext());
        MoneyMapExpenseWebhook.flushPendingAsync(getContext());
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
        MoneyMapExpenseWebhook.flushPendingAsync(getContext());
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("isNative", true);
        ret.put("hasNotificationAccess", hasNotificationListenerAccess(getContext()));
        ret.put("hasSmsPermission", hasSmsPermission(getContext()));
        ret.put("hasUsageAccess", hasUsageStatsAccess(getContext()));
        ret.put("hasPostNotifications", hasPostNotificationPermission(getContext()));
        ret.put("canRequestPackageInstalls", canInstallPackages(getContext()));
        ret.put("autoTrackEnabled", MoneyMapPrefs.isAutoTrackEnabled(getContext()));
        ret.put("smsAutoTrackEnabled", MoneyMapPrefs.isSmsAutoTrackEnabled(getContext()));
        ret.put("appGuardEnabled", MoneyMapPrefs.isAppGuardEnabled(getContext()));
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    @PluginMethod
    public void installApkUpdate(PluginCall call) {
        String apkUrl = call.getString("apkUrl", "");
        if (apkUrl == null || !apkUrl.startsWith("https://")) {
            call.reject("Invalid APK download URL.");
            return;
        }

        Context ctx = getContext();
        if (!canInstallPackages(ctx)) {
            Intent permIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            permIntent.setData(Uri.parse("package:" + ctx.getPackageName()));
            permIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(permIntent);

            JSObject ret = new JSObject();
            ret.put("started", false);
            ret.put("needsPermission", true);
            call.resolve(ret);
            return;
        }

        APK_EXECUTOR.execute(() -> downloadAndLaunchInstaller(ctx, apkUrl, call));
    }

    private void downloadAndLaunchInstaller(Context ctx, String apkUrl, PluginCall call) {
        HttpURLConnection conn = null;
        File tempFile = null;
        try {
            File updatesDir = new File(ctx.getCacheDir(), "updates");
            if (!updatesDir.exists() && !updatesDir.mkdirs()) {
                call.reject("Could not create update cache folder.");
                return;
            }
            tempFile = new File(updatesDir, "MoneyMap-update.apk.tmp");
            File finalApk = new File(updatesDir, "MoneyMap-update.apk");

            conn = openWithRedirects(apkUrl);
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                call.reject("APK download returned HTTP " + code);
                return;
            }

            long totalBytes = conn.getContentLengthLong();
            long downloaded = 0L;
            int lastPct = -1;

            try (InputStream in = conn.getInputStream();
                 FileOutputStream out = new FileOutputStream(tempFile, false)) {
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                    downloaded += read;
                    if (totalBytes > 0) {
                        int pct = (int) Math.min(99, (downloaded * 100L) / totalBytes);
                        if (pct != lastPct) {
                            lastPct = pct;
                            emitDownloadProgress(pct);
                        }
                    }
                }
                out.flush();
            }

            if (downloaded < MIN_APK_BYTES) {
                if (tempFile.exists()) tempFile.delete();
                call.reject("Downloaded file is too small to be a valid APK.");
                return;
            }

            if (finalApk.exists()) finalApk.delete();
            if (!tempFile.renameTo(finalApk)) {
                call.reject("Failed to prepare APK file.");
                return;
            }

            emitDownloadProgress(100);

            Uri apkUri = FileProvider.getUriForFile(
                ctx,
                ctx.getPackageName() + ".fileprovider",
                finalApk
            );

            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(installIntent);

            JSObject ret = new JSObject();
            ret.put("started", true);
            ret.put("needsPermission", false);
            call.resolve(ret);
        } catch (Exception err) {
            if (tempFile != null && tempFile.exists()) tempFile.delete();
            call.reject("APK update failed: " + (err.getMessage() != null ? err.getMessage() : "unknown error"));
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static HttpURLConnection openWithRedirects(String rawUrl) throws Exception {
        String current = rawUrl;
        for (int i = 0; i < MAX_REDIRECTS; i++) {
            HttpURLConnection conn = (HttpURLConnection) new URL(current).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setRequestProperty("User-Agent", "MoneyMap-Android-Updater");
            int code = conn.getResponseCode();
            if (code == HttpURLConnection.HTTP_MOVED_PERM
                || code == HttpURLConnection.HTTP_MOVED_TEMP
                || code == HttpURLConnection.HTTP_SEE_OTHER
                || code == 307
                || code == 308) {
                String location = conn.getHeaderField("Location");
                conn.disconnect();
                if (location == null || !location.startsWith("https://")) {
                    throw new IllegalStateException("Invalid redirect target.");
                }
                current = location;
                continue;
            }
            return conn;
        }
        throw new IllegalStateException("Too many redirects while downloading APK.");
    }

    private void emitDownloadProgress(int percent) {
        JSObject data = new JSObject();
        data.put("percent", percent);
        notifyListeners("apkDownloadProgress", data);
    }

    private void cleanupOldApkCache() {
        try {
            File updatesDir = new File(getContext().getCacheDir(), "updates");
            if (!updatesDir.isDirectory()) return;
            File[] files = updatesDir.listFiles();
            if (files == null) return;
            long cutoff = System.currentTimeMillis() - (2 * 60 * 60 * 1000L);
            for (File f : files) {
                if (f.getName().endsWith(".tmp") || f.lastModified() < cutoff) {
                    f.delete();
                }
            }
        } catch (Exception ignored) {}
    }

    @PluginMethod
    public void setAutoTrackEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", true);
        MoneyMapPrefs.setAutoTrackEnabled(getContext(), enabled);
        call.resolve();
    }

    @PluginMethod
    public void setSmsAutoTrackEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", true);
        MoneyMapPrefs.setSmsAutoTrackEnabled(getContext(), enabled);
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

    @PluginMethod
    public void requestSmsPermission(PluginCall call) {
        if (hasSmsPermission(getContext())) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("sms", call, "smsPermCallback");
    }

    @PermissionCallback
    private void smsPermCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("sms") == PermissionState.GRANTED || hasSmsPermission(getContext()));
        call.resolve(ret);
    }

    private static boolean canInstallPackages(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return context.getPackageManager().canRequestPackageInstalls();
    }

    private static boolean hasSmsPermission(Context context) {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.RECEIVE_SMS)
            == PackageManager.PERMISSION_GRANTED;
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
