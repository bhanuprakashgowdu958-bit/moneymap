import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { isNativeAndroid, LIVE_API_ORIGIN } from './nativeBridge';

export const NATIVE_APP_SCHEMA = 3;
export const OTA_READY_EVENT = 'moneymap:ota-ready';

export function getCurrentWebVersion() {
  return import.meta.env.VITE_MONEYMAP_WEB_VERSION || '1.0.dev';
}

export function getCurrentBuildTime() {
  const parsed = Number(import.meta.env.VITE_MONEYMAP_BUILD_TIME || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Must be called immediately on app startup so @capgo/capacitor-updater knows
 * the active bundle booted cleanly and will not roll back.
 */
export async function notifyOtaAppReady() {
  if (!isNativeAndroid()) return;
  try {
    await CapacitorUpdater.notifyAppReady();
  } catch (err) {
    console.warn('OTA notifyAppReady notice:', err);
  }
}

/**
 * Checks Vercel's ota-version.json and pre-downloads the web bundle in the
 * background if a newer compatible version exists.
 */
export async function checkAndPrepareOtaUpdate() {
  if (!isNativeAndroid()) {
    return { status: 'web', currentVersion: getCurrentWebVersion() };
  }

  const currentVersion = getCurrentWebVersion();
  const currentBuildTime = getCurrentBuildTime();

  const res = await fetch(`${LIVE_API_ORIGIN}/ota-version.json?t=${Date.now()}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Update check returned HTTP ${res.status}`);
  }

  const remote = await res.json();
  if (!remote || !remote.version || !remote.url) {
    return { status: 'up_to_date', currentVersion };
  }

  if (remote.version === currentVersion) {
    return { status: 'up_to_date', currentVersion };
  }

  // Prevent downgrading if an APK was built from a newer commit than Vercel's current deploy
  if (remote.buildTime && currentBuildTime && Number(remote.buildTime) < currentBuildTime) {
    return { status: 'up_to_date', currentVersion };
  }

  const minNative = Number(remote.minNativeVersion || 1);
  if (minNative > NATIVE_APP_SCHEMA || !remote.checksum) {
    return { status: 'native_required', remote, currentVersion };
  }

  // Reuse an already-downloaded bundle for this version if present
  const existing = await CapacitorUpdater.list().catch(() => ({ bundles: [] }));
  const cachedBundle = (existing?.bundles || []).find(
    (b) => b.version === remote.version && (b.status === 'success' || b.status === 'pending')
  );

  try {
    const bundle =
      cachedBundle ||
      (await CapacitorUpdater.download({
        url: remote.url,
        version: remote.version,
        checksum: remote.checksum,
      }));

    return {
      status: 'ready',
      bundle,
      remote,
      currentVersion,
    };
  } catch (err) {
    console.warn('OTA bundle download failed, falling back to APK prompt:', err);
    return { status: 'native_required', remote, currentVersion };
  }
}

/**
 * Switches the WebView immediately to the downloaded bundle and reloads the app.
 */
export async function applyOtaUpdate(bundleId) {
  if (!isNativeAndroid() || !bundleId) return;
  await CapacitorUpdater.set({ id: bundleId });
}

export function triggerOtaPrompt(result) {
  window.dispatchEvent(new CustomEvent(OTA_READY_EVENT, { detail: result }));
}
