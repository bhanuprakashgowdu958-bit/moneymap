import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { getNativeStatus, installNativeApkUpdate, isNativeAndroid } from '../lib/nativeBridge';
import {
  applyOtaUpdate,
  checkAndPrepareOtaUpdate,
  notifyOtaAppReady,
  OTA_READY_EVENT,
  stageOtaForNextRestart,
} from '../lib/otaUpdater';

const AUTO_CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes between background update checks
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
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [dismissedVersion, setDismissedVersion] = useState('');
  const checkingRef = useRef(false);
  const awaitingInstallPermRef = useRef(false);

  const startApkInstall = useCallback(async (info) => {
    if (!info) return;
    const apkUrl = info.remote?.apkUrl || DEFAULT_APK_URL;
    const remoteVer = info.remote?.version || '';
    setApplying(true);
    setDownloadProgress(0);
    try {
      const res = await installNativeApkUpdate(apkUrl, (pct) => {
        setDownloadProgress(pct);
      });
      if (res?.needsPermission) {
        awaitingInstallPermRef.current = true;
        setApplying(false);
        setDownloadProgress(null);
        toast('Allow "Install unknown apps" once — update will start automatically when you return!', {
          icon: '🔓',
          duration: 5000,
        });
        return;
      }
      if (res?.started) {
        saveSnooze(remoteVer);
        setApplying(false);
        setDownloadProgress(null);
      }
    } catch (err) {
      setApplying(false);
      setDownloadProgress(null);
      const msg = err?.message || '';
      if (msg.toLowerCase().includes('not implemented') || msg.toLowerCase().includes('unimplemented')) {
        saveSnooze(remoteVer);
        window.open(apkUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      toast.error(msg || 'Download failed. Opening browser fallback...');
      window.open(apkUrl, '_blank', 'noopener,noreferrer');
    }
  }, []);

  const updateInfoRef = useRef(null);
  useEffect(() => {
    updateInfoRef.current = updateInfo;
  }, [updateInfo]);

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

        if (result.status === 'ready' || result.status === 'native_required') {
          const remoteVer = result.remote?.version || '';
          const isForced = Boolean(result.remote?.forceUpdate);

          if (result.status === 'ready' && result.bundle?.id) {
            // Also stage for next restart in case the user taps "Later"
            await stageOtaForNextRestart(result.bundle.id);
          }

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

    // Auto-resume APK install if returning from "Allow unknown apps" settings,
    // otherwise check quietly only when the 4-hour interval has elapsed.
    const handleVisibility = async () => {
      if (document.visibilityState !== 'visible') return;

      if (awaitingInstallPermRef.current && updateInfoRef.current) {
        try {
          const st = await getNativeStatus();
          if (st?.canRequestPackageInstalls) {
            awaitingInstallPermRef.current = false;
            startApkInstall(updateInfoRef.current);
            return;
          }
        } catch {
          // User can tap Update Now manually
        }
      }

      runSilentCheck();
    };

    // Allow manual "Check for Updates" from Settings to show the prompt immediately
    const handleManualTrigger = (e) => {
      const result = e.detail;
      if (result && (result.status === 'ready' || result.status === 'native_required')) {
        setDismissedVersion('');
        setDownloadProgress(null);
        setUpdateInfo(result);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener(OTA_READY_EVENT, handleManualTrigger);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener(OTA_READY_EVENT, handleManualTrigger);
    };
  }, [startApkInstall]);

  if (!updateInfo) {
    return null;
  }

  const remoteVersion = updateInfo.remote?.version || '';
  const isForce = Boolean(updateInfo.remote?.forceUpdate);
  if (!isForce && dismissedVersion && dismissedVersion === remoteVersion) {
    return null;
  }

  const handleDismiss = () => {
    awaitingInstallPermRef.current = false;
    saveSnooze(remoteVersion);
    setDismissedVersion(remoteVersion);
    setUpdateInfo(null);
  };

  const handleApplyOta = async () => {
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
                ? 'A major MoneyMap update is ready. Tap Update Now to download and install right inside the app.'
                : updateInfo.remote?.notes ||
                  'All latest improvements are downloaded and ready to apply in one tap.'}
            </p>
          </div>
        </div>

        {updateInfo.status === 'native_required' && downloadProgress !== null && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-blue-700 font-semibold">
              <span>Downloading update...</span>
              <span className="tabular-nums">{downloadProgress}%</span>
            </div>
            <div className="w-full h-2 bg-blue-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-200 rounded-full"
                style={{ width: `${Math.max(5, downloadProgress)}%` }}
              />
            </div>
          </div>
        )}

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
                onClick={handleApplyOta}
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
              <button
                type="button"
                onClick={() => startApkInstall(updateInfo)}
                disabled={applying}
                className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm"
              >
                {applying ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Downloading {downloadProgress ?? 0}%
                  </>
                ) : (
                  'Update Now'
                )}
              </button>
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
