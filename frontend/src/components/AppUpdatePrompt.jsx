import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { getNativeStatus, installNativeApkUpdate, isNativeAndroid } from '../lib/nativeBridge';
import {
  applyOtaUpdate,
  checkOtaAvailability,
  downloadOtaBundle,
  notifyOtaAppReady,
  OTA_READY_EVENT,
  stageOtaForNextRestart,
} from '../lib/otaUpdater';

const RESUME_CHECK_COOLDOWN_MS = 60 * 1000; // 1 minute cooldown when switching apps
const LAST_CHECK_KEY = 'moneymap_ota_last_check';
const LEGACY_DISMISSED_KEY = 'moneymap_ota_dismissed';
const DEFAULT_APK_URL =
  'https://github.com/bhanuprakashgowdu958-bit/moneymap/releases/latest/download/MoneyMap.apk';

function clearLegacySnooze() {
  try {
    localStorage.removeItem(LEGACY_DISMISSED_KEY);
  } catch {
    // Ignore storage errors
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
        setApplying(false);
        setDownloadProgress(null);
      }
    } catch (err) {
      setApplying(false);
      setDownloadProgress(null);
      const msg = err?.message || '';
      if (msg.toLowerCase().includes('not implemented') || msg.toLowerCase().includes('unimplemented')) {
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
    clearLegacySnooze();

    let cancelled = false;
    let retryTimer = null;
    let retryAttempt = 0;
    const RETRY_DELAYS_MS = [3000, 8000];

    const runUpdateCheck = async (forceImmediate = false, clearDismissed = false) => {
      const now = Date.now();
      const lastCheck = readLastCheckTime();
      if (checkingRef.current) return;
      if (!forceImmediate && now - lastCheck < RESUME_CHECK_COOLDOWN_MS) return;

      checkingRef.current = true;
      try {
        const result = await checkOtaAvailability();
        if (cancelled) return;
        retryAttempt = 0;
        saveLastCheckTime(now);

        if (result.status === 'ready' || result.status === 'native_required') {
          const remoteVer = result.remote?.version || '';
          const isForced = Boolean(result.remote?.forceUpdate);

          if (clearDismissed || isForced) {
            setDismissedVersion('');
          }

          // Show the update prompt IMMEDIATELY when opening the app
          setUpdateInfo((prev) =>
            prev?.remote?.version === remoteVer && prev?.bundle
              ? { ...result, bundle: prev.bundle }
              : result
          );

          // Pre-download OTA zip quietly in the background so "Update Now" is instant
          if (result.status === 'ready' && result.remote) {
            downloadOtaBundle(result.remote)
              .then((bundle) => {
                if (!cancelled && bundle?.id) {
                  setUpdateInfo((prev) =>
                    prev && prev.remote?.version === remoteVer ? { ...prev, bundle } : prev
                  );
                }
              })
              .catch(() => {});
          }
        }
      } catch {
        // Retry briefly if device just unlocked or network is still connecting
        if (!cancelled && retryAttempt < RETRY_DELAYS_MS.length) {
          const delay = RETRY_DELAYS_MS[retryAttempt++];
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => {
            if (!cancelled) runUpdateCheck(true, clearDismissed);
          }, delay);
        }
      } finally {
        checkingRef.current = false;
      }
    };

    // Always check immediately when the user opens the app
    runUpdateCheck(true, true);

    const handleResumeCheck = async () => {
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

      const elapsed = Date.now() - readLastCheckTime();
      runUpdateCheck(false, elapsed >= RESUME_CHECK_COOLDOWN_MS);
    };

    // Auto-resume APK install if returning from "Allow unknown apps" settings,
    // otherwise check again on reopen after RESUME_CHECK_COOLDOWN_MS.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        handleResumeCheck();
      }
    };

    const handleOnline = () => {
      if (!updateInfoRef.current) {
        runUpdateCheck(true, true);
      }
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
    document.addEventListener('resume', handleResumeCheck);
    window.addEventListener('online', handleOnline);
    window.addEventListener(OTA_READY_EVENT, handleManualTrigger);

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('resume', handleResumeCheck);
      window.removeEventListener('online', handleOnline);
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
    if (updateInfo?.status === 'ready' && updateInfo.bundle?.id) {
      stageOtaForNextRestart(updateInfo.bundle.id);
    }
    setDismissedVersion(remoteVersion);
    setUpdateInfo(null);
  };

  const handleApplyOta = async () => {
    if (updateInfo.status !== 'ready' || !updateInfo.remote) return;
    setApplying(true);
    try {
      const bundle = updateInfo.bundle?.id
        ? updateInfo.bundle
        : await downloadOtaBundle(updateInfo.remote);
      if (!bundle?.id) {
        throw new Error('Update package could not be prepared.');
      }
      await applyOtaUpdate(bundle.id);
    } catch (err) {
      setApplying(false);
      toast.error(err?.message || 'Could not apply update. Please try again.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
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
