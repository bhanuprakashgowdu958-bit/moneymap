package com.moneymap.app;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MoneyMapNativePlugin.class);
        super.onCreate(savedInstanceState);

        View decorView = getWindow().getDecorView();
        decorView.setBackgroundColor(Color.WHITE);

        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), decorView);
        if (controller != null) {
            controller.setAppearanceLightStatusBars(true);
            controller.setAppearanceLightNavigationBars(true);
        }

        MoneyMapExpenseWebhook.registerNetworkCallback(this);
    }

    @Override
    public void onResume() {
        super.onResume();
        MoneyMapExpenseWebhook.flushPendingAsync(this);
    }
}
