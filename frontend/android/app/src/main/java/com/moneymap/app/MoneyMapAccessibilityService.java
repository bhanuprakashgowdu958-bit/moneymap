package com.moneymap.app;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Strictly scoped AccessibilityService that reads completed UPI payment confirmation
 * screens inside major payment apps when the user's bank does not send an SMS alert.
 */
public class MoneyMapAccessibilityService extends AccessibilityService {
    private static final Set<String> SUPPORTED_APPS = new HashSet<>(Arrays.asList(
        "com.phonepe.app",
        "com.google.android.apps.nbu.paisa.user",
        "net.one97.paytm",
        "in.org.npci.upiapp",
        "in.amazon.mShop.android.shopping",
        "com.dreamplug.androidapp"
    ));

    private static final Pattern COMPLETED_PAYMENT_RE = Pattern.compile(
        "(?:\\b(?:transaction\\s+successful|payment\\s+successful|transferred\\s+successfully|paid\\s+successfully|sent\\s+successfully|money\\s+sent|transfer\\s+successful|payment\\s+completed)\\b|\\bdebited\\s+from\\b.*\\bcredited\\s+to\\b|(?:\\b(?:paid\\s+to|sent\\s+to|self\\s+transfer|paid\\s+(?:rs\\.?|inr|₹))\\b.*\\b(?:utr|transaction\\s+id|upi\\s+ref|debited\\s+from|credited\\s+to|done|share\\s+receipt)\\b))",
        Pattern.CASE_INSENSITIVE | Pattern.DOTALL
    );

    private static final Pattern HISTORY_OR_IN_PROGRESS_RE = Pattern.compile(
        "\\b(?:hours?\\s+ago|days?\\s+ago|weeks?\\s+ago|months?\\s+ago|yesterday|download\\s+statement|search\\s+by\\s+name|proceed\\s+to\\s+pay|enter\\s+upi\\s+pin|enter\\s+amount|request\\s+money|pending|processing|failed|declined|unsuccessful)\\b",
        Pattern.CASE_INSENSITIVE
    );

    private static final long SAME_SCREEN_DEBOUNCE_MS = 10_000L;
    private static final int MAX_DEPTH = 18;
    private static final int MAX_NODES = 120;

    private String lastSignature = "";
    private long lastCapturedAt = 0L;

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) return;
        if (!MoneyMapPrefs.isScreenCaptureEnabled(this)) return;

        CharSequence pkgSeq = event.getPackageName();
        String pkg = pkgSeq == null ? "" : pkgSeq.toString().toLowerCase(Locale.ROOT);
        if (!SUPPORTED_APPS.contains(pkg)) return;

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;

        List<String> parts = new ArrayList<>();
        int[] visited = new int[] { 0 };
        collectVisibleText(root, parts, 0, visited);
        if (parts.isEmpty()) return;

        StringBuilder sb = new StringBuilder();
        for (String p : parts) {
            if (sb.length() > 0) sb.append(' ');
            sb.append(p);
        }
        String screenText = sb.toString().replaceAll("\\s+", " ").trim();
        if (screenText.length() < 12) return;

        if (HISTORY_OR_IN_PROGRESS_RE.matcher(screenText).find()) return;
        if (!COMPLETED_PAYMENT_RE.matcher(screenText).find()) return;
        if (!MoneyMapExpenseWebhook.looksLikeDebitExpense(screenText)) {
            MoneyMapExpenseWebhook.recordFilteredEvent(this, "SCREEN", pkg, screenText);
            return;
        }

        long now = System.currentTimeMillis();
        String sig = pkg + ":" + Math.min(screenText.length(), 180) + ":" + screenText.hashCode();
        if (sig.equals(lastSignature) && (now - lastCapturedAt) < SAME_SCREEN_DEBOUNCE_MS) {
            return;
        }
        lastSignature = sig;
        lastCapturedAt = now;

        MoneyMapExpenseWebhook.submitNotificationAsync(this, "", screenText, pkg, null);
    }

    private void collectVisibleText(AccessibilityNodeInfo node, List<String> parts, int depth, int[] visited) {
        if (node == null || depth > MAX_DEPTH || visited[0] >= MAX_NODES) return;
        visited[0]++;

        if (!node.isVisibleToUser() || node.isPassword() || node.isEditable()) return;

        CharSequence textSeq = node.getText();
        if (textSeq != null) {
            String t = textSeq.toString().replaceAll("\\s+", " ").trim();
            if (!t.isEmpty() && t.length() <= 160 && !parts.contains(t)) {
                parts.add(t);
            }
        }

        int childCount = node.getChildCount();
        for (int i = 0; i < childCount && visited[0] < MAX_NODES; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                collectVisibleText(child, parts, depth + 1, visited);
            }
        }
    }

    @Override
    public void onInterrupt() {}
}
