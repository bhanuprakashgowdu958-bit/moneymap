package com.moneymap.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;

public final class MoneyMapNotifier {
    public static final String CHANNEL_ALERTS = "moneymap_budget_alerts";
    public static final String CHANNEL_GUARD_SERVICE = "moneymap_guard_service";

    private MoneyMapNotifier() {}

    public static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        NotificationChannel alertChannel = new NotificationChannel(
            CHANNEL_ALERTS,
            "Budget & Spend Alerts",
            NotificationManager.IMPORTANCE_HIGH
        );
        alertChannel.setDescription("Alerts when a category nears or exceeds its monthly budget limit");
        alertChannel.enableVibration(true);
        nm.createNotificationChannel(alertChannel);

        NotificationChannel serviceChannel = new NotificationChannel(
            CHANNEL_GUARD_SERVICE,
            "Food App Budget Guard",
            NotificationManager.IMPORTANCE_LOW
        );
        serviceChannel.setDescription("Monitors food and shopping app launches to warn before overspending");
        nm.createNotificationChannel(serviceChannel);
    }

    public static void showBudgetAlert(Context context, String title, String message, int notificationId) {
        if (message == null || message.trim().isEmpty()) return;
        ensureChannels(context);

        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getActivity(context, 0, intent, flags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ALERTS)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(title != null && !title.isEmpty() ? title : "MoneyMap Budget Alert")
            .setContentText(message)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent);

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(notificationId, builder.build());
        }
    }
}
