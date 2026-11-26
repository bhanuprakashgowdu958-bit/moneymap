import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { getOrCreateWebhookToken, isDemoUser } from '../lib/firestore';
import {
  getNativeStatus,
  isNativeAndroid,
  openAccessibilitySettings,
  openAppInfoSettings,
  openNotificationAccessSettings,
  requestNativeNotifications,
  requestNativeSmsPermission,
  setNativeAutoTrack,
  setNativeScreenCapture,
  setNativeSmsAutoTrack,
  syncNativeConfig,
} from '../lib/nativeBridge';

/**
 * Surfaces 1-tap SMS and Notification permission controls right inside the main
 * layout on Android so users don't miss outgoing payments when they haven't
 * opened Settings to grant Direct Bank SMS or Notification Access.
 */
export default function AutoTrackSetupPrompt() {
  const { user } = useAuth();
  const [status, setStatus] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!isNativeAndroid()) return;
    try {
      const next = await getNativeStatus();
      setStatus(next);
    } catch {
      // Ignore bridge lookup errors
    }
  }, []);

  useEffect(() => {
    if (!isNativeAndroid() || !user?.uid || isDemoUser(user.uid)) return undefined;
    refreshStatus();

    const handleVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshStatus();
      }
    };
    document.addEventListener('visibilitychange', handleVisible);
    document.addEventListener('resume', refreshStatus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisible);
      document.removeEventListener('resume', refreshStatus);
    };
  }, [user?.uid, refreshStatus]);

  if (!isNativeAndroid() || !user?.uid || isDemoUser(user.uid) || !status || dismissed) {
    return null;
  }

  const smsReady = Boolean(status.hasSmsPermission && status.smsAutoTrackEnabled);
  const notifReady = Boolean(status.hasNotificationAccess && status.autoTrackEnabled);
  const screenReady = Boolean(status.hasAccessibilityAccess && status.screenCaptureEnabled);
  if (smsReady && notifReady && screenReady) {
    return null;
  }

  const syncToken = async () => {
    try {
      const tok = await getOrCreateWebhookToken(user.uid);
      if (tok) await syncNativeConfig(tok);
    } catch {
      // Config sync will retry via Layout
    }
  };

  const handleEnableSms = async () => {
    await requestNativeNotifications();
    if (!status.hasSmsPermission) {
      const perm = await requestNativeSmsPermission();
      if (!perm?.granted) {
        refreshStatus();
        toast.error('Please allow SMS permission so MoneyMap captures bank debits automatically.');
        return;
      }
    }
    await setNativeSmsAutoTrack(true);
    await syncToken();
    await refreshStatus();
    toast.success('Bank SMS Auto-Track enabled! 📩');
  };

  const handleEnableNotifications = async () => {
    await requestNativeNotifications();
    await setNativeAutoTrack(true);
    await syncToken();
    if (!status.hasNotificationAccess) {
      openNotificationAccessSettings();
    } else {
      await refreshStatus();
      toast.success('Notification Auto-Track enabled! ⚡');
    }
  };

  const handleEnableScreenCapture = async () => {
    await setNativeScreenCapture(true);
    await syncToken();
    if (!status.hasAccessibilityAccess) {
      toast('Enable "MoneyMap Payment Screen Reader". If greyed out, tap App Info -> Allow restricted settings.', {
        icon: '📲',
        duration: 5000,
      });
      openAccessibilitySettings();
    } else {
      await refreshStatus();
      toast.success('UPI Screen Capture enabled! 📲');
    }
  };

  return (
    <div className="mb-4 p-3.5 bg-amber-50/90 border border-amber-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs sm:text-sm font-semibold text-amber-950">
          {!smsReady && !notifReady
            ? 'Turn on Auto-Track to capture every payment automatically'
            : !screenReady
              ? 'Enable UPI Screen Capture so 0-SMS PhonePe / GPay payments are detected'
              : !smsReady
                ? 'Allow Bank SMS so payments sent via PhonePe / GPay are never missed'
                : 'Enable Notification Access to also capture instant UPI app alerts'}
        </p>
        <p className="text-[11px] text-amber-800 mt-0.5 leading-snug">
          Reads completed payment confirmation screens even when your bank skips sending an SMS.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
        {!screenReady && (
          <button
            type="button"
            onClick={handleEnableScreenCapture}
            className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-colors"
          >
            Allow Screen Capture
          </button>
        )}
        {!smsReady && (
          <button
            type="button"
            onClick={handleEnableSms}
            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors"
          >
            Allow SMS Auto-Track
          </button>
        )}
        {!notifReady && (
          <button
            type="button"
            onClick={handleEnableNotifications}
            className="px-3 py-1.5 rounded-xl bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-semibold transition-colors"
          >
            Allow Notifications
          </button>
        )}
        {!screenReady && status.sdkInt >= 33 && (
          <button
            type="button"
            onClick={openAppInfoSettings}
            className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-medium"
          >
            App Info
          </button>
        )}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss auto-track reminder"
          className="px-2 py-1.5 text-xs text-amber-700 hover:text-amber-950 font-medium"
        >
          Later
        </button>
      </div>
    </div>
  );
}
