/**
 * Native Google Sign-In for Android via @capgo/capacitor-social-login
 *
 * Uses Android's Credential Manager API for a native Google sign-in flow,
 * then authenticates with Firebase using the returned ID token.
 */
import { isNativeAndroid } from './nativeBridge';

const WEB_CLIENT_ID = '1020623021434-f5p592cerbbk58cbrh2eco9mfg5e22e9.apps.googleusercontent.com';

let SocialLogin = null;
let initialized = false;

/**
 * Lazily load and initialize the SocialLogin plugin.
 * Only runs on native Android — no-ops on web.
 */
export async function initNativeGoogleAuth() {
  if (!isNativeAndroid() || initialized) return;

  try {
    const mod = await import('@capgo/capacitor-social-login');
    SocialLogin = mod.SocialLogin;

    await SocialLogin.initialize({
      google: {
        webClientId: WEB_CLIENT_ID,
      },
    });
    initialized = true;
    console.log('[GoogleAuthNative] Initialized successfully');
  } catch (err) {
    console.warn('[GoogleAuthNative] Init failed:', err);
  }
}

/**
 * Trigger native Google Sign-In on Android.
 * Returns { idToken, email, displayName, photoUrl } on success.
 */
export async function nativeGoogleSignIn() {
  if (!SocialLogin) {
    await initNativeGoogleAuth();
  }
  if (!SocialLogin) {
    throw new Error('Native Google Sign-In is not available');
  }

  const result = await SocialLogin.login({
    provider: 'google',
    options: {},
  });

  const profile = result?.result?.profile || result?.result || {};
  const idToken = result?.result?.idToken ||
                  result?.result?.authentication?.idToken ||
                  result?.result?.credential?.idToken;

  if (!idToken) {
    throw new Error('No ID token received from Google Sign-In');
  }

  return {
    idToken,
    email: profile.email || '',
    displayName: profile.name || profile.displayName || '',
    photoUrl: profile.imageUrl || profile.picture || profile.photoUrl || '',
  };
}

/**
 * Sign out of native Google on Android.
 */
export async function nativeGoogleSignOut() {
  if (!SocialLogin) return;
  try {
    await SocialLogin.logout({ provider: 'google' });
  } catch {
    // Ignore sign-out errors
  }
}

export { WEB_CLIENT_ID };
