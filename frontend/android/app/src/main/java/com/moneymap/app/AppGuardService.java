package com.moneymap.app;

import android.app.Notification;
import android.app.Service;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class AppGuardService extends Service {
    private static final int FOREGROUND_ID = 7001;
    private static final long POLL_INTERVAL_MS = 2500L;
    private static final long ALERT_COOLDOWN_MS = 3 * 60 * 1000L;

    private static final Map<String, String> MONITORED_APPS = new HashMap<>();
    static {
        MONITORED_APPS.put("in.swiggy.android", "food-delivery");
        MONITORED_APPS.put("com.application.zomato", "food-delivery");
        MONITORED_APPS.put("com.grofers.customerapp", "groceries");
        MONITORED_APPS.put("com.zeptonow.app", "groceries");
    }

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private long lastCheckTs = 0L;
    private String lastForegroundPkg = "";

    private final Runnable pollTask = new Runnable() {
        @Override
        public void run() {
            if (!MoneyMapPrefs.isAppGuardEnabled(AppGuardService.this)) {
                stopSelf();
                return;
            }
            checkForegroundApp();
            handler.postDelayed(this, POLL_INTERVAL_MS);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        MoneyMapNotifier.ensureChannels(this);
        lastCheckTs = System.currentTimeMillis() - 3000L;

        Notification ongoing = new NotificationCompat.Builder(this, MoneyMapNotifier.CHANNEL_GUARD_SERVICE)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("MoneyMap Food Guard Active")
            .setContentText("Watching food & delivery apps for budget limits")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build();

        startForeground(FOREGROUND_ID, ongoing);
        handler.post(pollTask);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!MoneyMapPrefs.isAppGuardEnabled(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    private void checkForegroundApp() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null && !pm.isInteractive()) return;

        UsageStatsManager usm = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
        if (usm == null) return;

        long now = System.currentTimeMillis();
        long begin = Math.max(lastCheckTs, now - 5000L);
        UsageEvents events = usm.queryEvents(begin, now);
        lastCheckTs = now;

        if (events == null) return;

        UsageEvents.Event event = new UsageEvents.Event();
        String resumedPkg = null;
        while (events.hasNextEvent()) {
            events.getNextEvent(event);
            int type = event.getEventType();
            if (type == UsageEvents.Event.MOVE_TO_FOREGROUND ||
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && type == UsageEvents.Event.ACTIVITY_RESUMED)) {
                resumedPkg = event.getPackageName();
            }
        }

        if (resumedPkg == null || resumedPkg.equals(lastForegroundPkg)) return;
        lastForegroundPkg = resumedPkg;

        String category = MONITORED_APPS.get(resumedPkg);
        if (category == null) return;

        long lastAlert = MoneyMapPrefs.getLastGuardAlertTime(this, resumedPkg);
        if ((now - lastAlert) < ALERT_COOLDOWN_MS) return;

        String checkBase = MoneyMapPrefs.getBudgetCheckBase(this);
        if (checkBase == null || checkBase.isEmpty()) return;

        final String targetPkg = resumedPkg;
        MoneyMapPrefs.setLastGuardAlertTime(this, targetPkg, now);
        final String url = checkBase + "&category=" + category + "&format=text";
        executor.execute(() -> fetchAndAlert(url, targetPkg));
    }

    private void fetchAndAlert(String urlStr, String pkg) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(8000);

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
                String msg = sb.toString().trim();
                if (!msg.isEmpty()) {
                    MoneyMapNotifier.showBudgetAlert(
                        this,
                        "Pause Before Ordering",
                        msg,
                        pkg.hashCode()
                    );
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(pollTask);
        executor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
