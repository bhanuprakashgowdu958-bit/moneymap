import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { isNativeAndroid } from '../lib/nativeBridge';
import {
  applyOtaUpdate,
  checkAndPrepareOtaUpdate,
  notifyOtaAppReady,
  OTA_READY_EVENT,
} from '../lib/otaUpdater';

const CHECK_COOLDOWN_MS = 60 * 1000;
const DEFAULT_APK_URL =
  'https://github.com/bhanuprakashgowdu958-bit/moneymap/releases/latest/download/MoneyMap.apk';

export default function AppUpdatePrompt() {
  const [updateInfo, setUpdateInfo] = useState(null);
  const [applying, setApplying] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState('');
  const lastCheckRef = useRef(0);
  const checkingRef = useRef(false);

  useEffect(() => {
    if (!isNativeAndroid()) return;

    // 1. Confirm current bundle booted cleanly BEFORE any network requests
    notifyOtaAppReady();

    const runCheck = async () => {
      const now = Date.now();
      if (checkingRef.current || now - lastCheckRef.current < CHECK_COOLDOWN_MS) return;
      checkingRef.current = true;
      lastCheckRef.current = now;
      try {
        const result = await checkAndPrepareOtaUpdate();
        if (result.status === 'ready' || result.status === 'native_required') {
          setUpdateInfo(result);
        }
      } catch {
        // Silent fail for automatic background checks (offline/poor network)
      } finally {
        checkingRef.current = false;
      }
    };

    // Initial check immediately on launch so critical fixes arrive before login
    runCheck();

    // Re-check when returning to app from background
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        runCheck();
      }
    };

    // Allow manual check from Settings to open this prompt immediately
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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
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
                : 'New Update Available'}
            </h3>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              {updateInfo.status === 'native_required'
                ? 'A major MoneyMap update is ready. Please install the latest APK to continue getting new features.'
                : updateInfo.remote?.notes ||
                  'A newer version of MoneyMap is ready with the latest improvements.'}
            </p>
          </div>
        </div>

        {updateInfo.status === 'ready' && (
          <div className="bg-blue-50/70 border border-blue-100 rounded-xl px-3 py-2 text-[11px] text-blue-800">
            Updates inside MoneyMap in ~1 second. Your data and login stay safe.
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
                  onClick={() => setDismissedVersion(remoteVersion)}
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
                className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm text-center"
              >
                Download Update
              </a>
              {!isForce && (
                <button
                  type="button"
                  onClick={() => setDismissedVersion(remoteVersion)}
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
