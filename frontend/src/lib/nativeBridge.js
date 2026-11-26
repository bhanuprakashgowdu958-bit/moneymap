import { Capacitor, registerPlugin } from '@capacitor/core';

const MoneyMapNative = registerPlugin('MoneyMapNative');

export const LIVE_API_ORIGIN =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE_URL) ||
  'https://moneymap-pl9w.vercel.app';

export function isNativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function syncNativeConfig(webhookToken) {
  if (!isNativeAndroid() || !webhookToken) return;
  try {
    await MoneyMapNative.syncConfig({
      webhookUrl: `${LIVE_API_ORIGIN}/api/webhook?token=${webhookToken}`,
      budgetCheckBase: `${LIVE_API_ORIGIN}/api/budget-check?token=${webhookToken}`,
    });
  } catch (err) {
    console.warn('Native config sync notice:', err);
  }
}

export async function getNativeStatus() {
  if (!isNativeAndroid()) {
    return {
      isNative: false,
      hasNotificationAccess: false,
      hasSmsPermission: false,
      hasUsageAccess: false,
      hasPostNotifications: true,
      autoTrackEnabled: false,
      smsAutoTrackEnabled: false,
      appGuardEnabled: false,
      sdkInt: 0,
    };
  }
  return MoneyMapNative.getStatus();
}

export async function setNativeAutoTrack(enabled) {
  if (!isNativeAndroid()) return;
  return MoneyMapNative.setAutoTrackEnabled({ enabled });
}

export async function setNativeSmsAutoTrack(enabled) {
  if (!isNativeAndroid()) return;
  return MoneyMapNative.setSmsAutoTrackEnabled({ enabled });
}

export async function requestNativeSmsPermission() {
  if (!isNativeAndroid()) return { granted: false };
  return MoneyMapNative.requestSmsPermission();
}

export async function setNativeAppGuard(enabled) {
  if (!isNativeAndroid()) return;
  return MoneyMapNative.setAppGuardEnabled({ enabled });
}

export async function openNotificationAccessSettings() {
  if (!isNativeAndroid()) return;
  return MoneyMapNative.openNotificationAccessSettings();
}

export async function openUsageAccessSettings() {
  if (!isNativeAndroid()) return;
  return MoneyMapNative.openUsageAccessSettings();
}

export async function openAppInfoSettings() {
  if (!isNativeAndroid()) return;
  return MoneyMapNative.openAppInfoSettings();
}

export async function requestNativeNotifications() {
  if (!isNativeAndroid()) return { granted: true };
  return MoneyMapNative.requestNotificationPermission();
}

export async function getNativeDiagnostics() {
  if (!isNativeAndroid()) {
    return {
      hasWebhookUrl: false,
      hasSmsPermission: false,
      hasReadSmsPermission: false,
      hasNotificationAccess: false,
      autoTrackEnabled: false,
      smsAutoTrackEnabled: false,
      pendingQueueCount: 0,
      logs: [],
    };
  }
  const res = await MoneyMapNative.getDiagnostics();
  let logs = [];
  try {
    logs = JSON.parse(res?.logsJson || '[]');
  } catch {
    logs = [];
  }
  return { ...res, logs: Array.isArray(logs) ? logs : [] };
}

export async function syncNativeSmsInboxNow() {
  if (!isNativeAndroid()) return { synced: 0 };
  return MoneyMapNative.syncSmsInboxNow();
}

export async function installNativeApkUpdate(apkUrl, onProgress) {
  if (!isNativeAndroid()) return { started: false };
  let listener = null;
  if (typeof onProgress === 'function') {
    listener = await MoneyMapNative.addListener('apkDownloadProgress', (data) => {
      if (typeof data?.percent === 'number') onProgress(data.percent);
    });
  }
  try {
    return await MoneyMapNative.installApkUpdate({ apkUrl });
  } finally {
    if (listener && typeof listener.remove === 'function') {
      listener.remove().catch(() => {});
    }
  }
}
