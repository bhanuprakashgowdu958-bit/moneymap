import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { isNativeAndroid, LIVE_API_ORIGIN } from './nativeBridge';

export const NATIVE_APP_SCHEMA = 11;
export const OTA_READY_EVENT = 'moneymap:ota-ready';

const inFlightDownloads = new Map();

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

function buildCacheBustedBundleUrl(rawUrl, version) {
  if (!rawUrl || !version) return rawUrl;
  const sep = rawUrl.includes('?') ? '&' : '?';
  return rawUrl.includes('v=') ? rawUrl : `${rawUrl}${sep}v=${encodeURIComponent(version)}`;
}

/**
 * Fast manifest check (~300 bytes) against Vercel's ota-version.json.
 * Returns { status: 'web' | 'up_to_date' | 'native_required' | 'ready', remote, currentVersion }
 * without waiting for the full bundle zip download.
 */
export async function checkOtaAvailability() {
  if (!isNativeAndroid()) {
    return { status: 'web', currentVersion: getCurrentWebVersion() };
  }

  const currentVersion = getCurrentWebVersion();
  const currentBuildTime = getCurrentBuildTime();

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), 8000) : null;

  let res;
  try {
    res = await fetch(`${LIVE_API_ORIGIN}/ota-version.json?t=${Date.now()}`, {
      cache: 'no-store',
      signal: controller ? controller.signal : undefined,
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
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

  // Only skip if Vercel explicitly serves an older buildTime than this APK
  if (remote.buildTime && currentBuildTime && Number(remote.buildTime) + 60 < currentBuildTime) {
    return { status: 'up_to_date', currentVersion };
  }

  const minNative = Number(remote.minNativeVersion || 1);
  if (minNative > NATIVE_APP_SCHEMA || !remote.checksum) {
    return { status: 'native_required', remote, currentVersion };
  }

  return { status: 'ready', remote, currentVersion, bundle: null };
}

/**
 * Downloads (or reuses cached) OTA zip bundle for the given remote manifest.
 * Deduplicates concurrent download requests for the same version.
 */
export async function downloadOtaBundle(remote) {
  if (!isNativeAndroid() || !remote?.version || !remote?.url) return null;

  const existing = await CapacitorUpdater.list().catch(() => ({ bundles: [] }));
  const cachedBundle = (existing?.bundles || []).find(
    (b) => b.version === remote.version && (b.status === 'success' || b.status === 'pending')
  );
  if (cachedBundle) return cachedBundle;

  const key = remote.version;
  if (inFlightDownloads.has(key)) {
    return inFlightDownloads.get(key);
  }

  const downloadPromise = CapacitorUpdater.download({
    url: buildCacheBustedBundleUrl(remote.url, remote.version),
    version: remote.version,
    checksum: remote.checksum,
  }).finally(() => {
    inFlightDownloads.delete(key);
  });

  inFlightDownloads.set(key, downloadPromise);
  return downloadPromise;
}

/**
 * Checks Vercel's ota-version.json and prepares/downloads the web bundle if available.
 */
export async function checkAndPrepareOtaUpdate() {
  const availability = await checkOtaAvailability();
  if (availability.status !== 'ready') {
    return availability;
  }

  const bundle = await downloadOtaBundle(availability.remote);
  return {
    ...availability,
    bundle,
  };
}

/**
 * Stages a downloaded bundle to activate automatically on the next
 * app background or restart without interrupting the user.
 */
export async function stageOtaForNextRestart(bundleId) {
  if (!isNativeAndroid() || !bundleId) return;
  try {
    await CapacitorUpdater.next({ id: bundleId });
  } catch (err) {
    console.warn('OTA next() stage notice:', err);
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
