import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { isNativeAndroid } from '../lib/nativeBridge';
import {
  applyOtaUpdate,
  checkAndPrepareOtaUpdate,
  notifyOtaAppReady,
  OTA_READY_EVENT,
  stageOtaForNextRestart,
} from '../lib/otaUpdater';

const AUTO_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours between silent background checks
const SNOOZE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours after tapping "Later"
const LAST_CHECK_KEY = 'moneymap_ota_last_check';
const DISMISSED_KEY = 'moneymap_ota_dismissed';
const DEFAULT_APK_URL =
  'https://github.com/bhanuprakashgowdu958-bit/moneymap/releases/latest/download/MoneyMap.apk';

function isSnoozed(version) {
  if (!version) return false;
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== version) return false;
    return Date.now() - Number(parsed.dismissedAt || 0) < SNOOZE_DURATION_MS;
  } catch {
    return false;
  }
}

function saveSnooze(version) {
  if (!version) return;
  try {
    localStorage.setItem(
      DISMISSED_KEY,
      JSON.stringify({ version, dismissedAt: Date.now() })
    );
  } catch {
    // Ignore storage quota errors
  }
}

function readLastCheckTime() {
  try {
    return Number(localStorage.getItem(LAST_CHECK_KEY) || 0);
  } catch {
    return 0;
  }
}

function saveLastCheckTime(ts) {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(ts));
  } catch {
    // Ignore storage quota errors
  }
}

export default function AppUpdatePrompt() {
  const [updateInfo, setUpdateInfo] = useState(null);
  const [applying, setApplying] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState('');
  const checkingRef = useRef(false);

  useEffect(() => {
    if (!isNativeAndroid()) return;

    // 1. Confirm current bundle booted cleanly BEFORE any network requests
    notifyOtaAppReady();

    const runSilentCheck = async () => {
      const now = Date.now();
      const lastCheck = readLastCheckTime();
      if (checkingRef.current || now - lastCheck < AUTO_CHECK_INTERVAL_MS) return;

      checkingRef.current = true;
      try {
        const result = await checkAndPrepareOtaUpdate();
        saveLastCheckTime(now);

        if (result.status === 'ready') {
          const isForced = Boolean(result.remote?.forceUpdate);
          if (isForced) {
            setUpdateInfo(result);
          } else if (result.bundle?.id) {
            // Normal web updates install silently on the next app background/restart — 0 popups
            await stageOtaForNextRestart(result.bundle.id);
          }
        } else if (result.status === 'native_required') {
          const remoteVer = result.remote?.version || '';
          const isForced = Boolean(result.remote?.forceUpdate);
          if (isForced || !isSnoozed(remoteVer)) {
            setUpdateInfo(result);
          }
        }
      } catch {
        // Silent fail for automatic background checks (offline/poor network)
      } finally {
        checkingRef.current = false;
      }
    };

    // Check quietly on startup (respecting the 4-hour interval)
    runSilentCheck();

    // Re-check only if returning to foreground after the 4-hour interval
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        runSilentCheck();
      }
    };

    // Allow manual "Check for Updates" from Settings to show the prompt immediately
    const handleManualTrigger = (e) => {
      const result = e.detail;
      if (result && (result.status === 'ready' || result.status === 'native_required')) {
        setDismissedVersion('');
        setUpdateInfo(result);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener(OTA_READY_EVENT, handleManualTrigger);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener(OTA_READY_EVENT, handleManualTrigger);
    };
  }, []);

  if (!updateInfo) return null;

  const remoteVersion = updateInfo.remote?.version || '';
  const isForce = Boolean(updateInfo.remote?.forceUpdate);
  if (!isForce && dismissedVersion && dismissedVersion === remoteVersion) {
    return null;
  }

  const handleDismiss = () => {
    saveSnooze(remoteVersion);
    setDismissedVersion(remoteVersion);
    setUpdateInfo(null);
  };

  const handleApply = async () => {
    if (updateInfo.status !== 'ready' || !updateInfo.bundle?.id) return;
    setApplying(true);
    try {
      await applyOtaUpdate(updateInfo.bundle.id);
    } catch (err) {
      setApplying(false);
      toast.error(err?.message || 'Could not apply update. Please try again.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ota-update-title"
    >
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-gray-100 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center text-2xl flex-shrink-0">
            {updateInfo.status === 'native_required' ? '📲' : '🚀'}
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="ota-update-title" className="text-base font-bold text-gray-900">
              {updateInfo.status === 'native_required'
                ? 'New App Version Required'
                : 'New Update Ready'}
            </h3>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              {updateInfo.status === 'native_required'
                ? 'A major MoneyMap update is ready. Install the latest APK once to get all new features and improvements.'
                : updateInfo.remote?.notes ||
                  'All latest improvements are downloaded and ready to apply in one tap.'}
            </p>
          </div>
        </div>

        {updateInfo.status === 'ready' && (
          <div className="bg-blue-50/70 border border-blue-100 rounded-xl px-3 py-2 text-[11px] text-blue-800">
            Applies all latest updates in ~1 second. Your data and login stay safe.
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          {updateInfo.status === 'ready' ? (
            <>
              <button
                type="button"
                onClick={handleApply}
                disabled={applying}
                className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm"
              >
                {applying ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Update Now'
                )}
              </button>
              {!isForce && (
                <button
                  type="button"
                  onClick={handleDismiss}
                  disabled={applying}
                  className="btn-secondary text-sm"
                >
                  Later
                </button>
              )}
            </>
          ) : (
            <>
              <a
                href={updateInfo.remote?.apkUrl || DEFAULT_APK_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => saveSnooze(remoteVersion)}
                className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm text-center"
              >
                Download Update
              </a>
              {!isForce && (
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="btn-secondary text-sm"
                >
                  Later
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
