import { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  signInWithPopup,
  signInWithCredential,
  GoogleAuthProvider,
  getAdditionalUserInfo,
} from 'firebase/auth';
import { auth, googleProvider, isFirebaseConfigured } from '../lib/firebase';
import { upsertUserProfile, getUserProfile, getUserProfileKey, loadLocal, saveLocal } from '../lib/firestore';
import { isNativeAndroid } from '../lib/nativeBridge';
import { nativeGoogleSignIn, initNativeGoogleAuth, nativeGoogleSignOut } from '../lib/googleAuthNative';

const AuthContext = createContext(null);

const STORAGE_KEY_REGISTERED = 'moneymap_registered_accounts';

/**
 * Checks whether an account was explicitly registered with phone number (instant 0ms)
 */
export function isAccountRegistered(email, uid) {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY_REGISTERED) || '[]');
    return list.some((acc) => {
      const matchEmail = email && acc.email && acc.email.toLowerCase() === email.toLowerCase();
      const matchUid = uid && acc.uid && acc.uid === uid;
      return Boolean(matchEmail || matchUid);
    });
  } catch {
    return false;
  }
}

/**
 * Marks an account as registered upon successful registration (instant 0ms)
 */
export function markAccountRegistered(account) {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY_REGISTERED) || '[]');
    const exists = list.some((acc) => {
      const matchEmail = account.email && acc.email && acc.email.toLowerCase() === account.email.toLowerCase();
      const matchUid = account.uid && acc.uid && acc.uid === account.uid;
      return Boolean(matchEmail || matchUid);
    });
    if (!exists) {
      list.push({ ...account, registeredAt: new Date().toISOString() });
      localStorage.setItem(STORAGE_KEY_REGISTERED, JSON.stringify(list));
    }
  } catch (err) {
    console.error('Error marking account registered:', err);
  }
}

const DEMO_USER = {
  uid: 'demo-user-123',
  displayName: 'Rahul Sharma',
  email: 'rahul@example.com',
  photoURL: '',
};

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const authFlowInProgressRef = useRef(false);

  // Initialize auth state (instant non-blocking)
  useEffect(() => {
    // Initialize native Google Auth on Android (non-blocking)
    if (isNativeAndroid()) {
      initNativeGoogleAuth().catch(() => {});
    }

    if (isFirebaseConfigured && auth) {
      const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        // Avoid racing with an active sign-in / sign-up call before local/remote profile sync finishes
        if (authFlowInProgressRef.current) return;

        if (firebaseUser) {
          const isRegistered = isAccountRegistered(firebaseUser.email, firebaseUser.uid);
          const cachedLocal = loadLocal(getUserProfileKey(firebaseUser.uid), null);
          let resolvedLocal = cachedLocal;

          // On a fresh device/cleared localStorage, verify Firestore before rejecting session
          if (!isRegistered && (!cachedLocal || !cachedLocal.phoneNumber)) {
            const remote = await getUserProfile(firebaseUser.uid, { skipLocal: true });
            if (!remote) {
              await signOut(auth).catch(() => {});
              setUser(null);
              setProfile(null);
              setLoading(false);
              return;
            }
            resolvedLocal = remote;
            markAccountRegistered({
              email: firebaseUser.email,
              uid: firebaseUser.uid,
              phoneNumber: remote.phoneNumber || '',
              name: remote.name || firebaseUser.displayName || 'User',
            });
          }

          // 1. Immediately set user and instant profile (0ms!)
          const instantProfile = resolvedLocal || {
            name: firebaseUser.displayName || 'User',
            email: firebaseUser.email,
            photoURL: firebaseUser.photoURL || '',
            currency: '₹',
            monthlyIncome: 0,
            phoneNumber: resolvedLocal?.phoneNumber || '',
          };

          setUser(firebaseUser);
          setProfile(instantProfile);
          setLoading(false);

          // 2. Fetch fresh Firestore updates in the background without blocking the UI
          getUserProfile(firebaseUser.uid, { skipLocal: true })
            .then((fresh) => {
              if (fresh) setProfile((prev) => ({ ...prev, ...fresh }));
            })
            .catch(() => {});
        } else {
          setUser(null);
          setProfile(null);
          setLoading(false);
        }
      });
      return unsubscribe;
    } else {
      // Local / Demo Mode check
      const savedDemo = localStorage.getItem('moneymap_demo_session');
      if (savedDemo) {
        try {
          const parsed = JSON.parse(savedDemo);
          setUser(parsed.user);
          setProfile(parsed.profile);
        } catch {
          setUser(null);
        }
      }
      setLoading(false);
    }
  }, []);

  /** Register with email & password */
  const register = async (name, email, password, monthlyIncome = 0, phoneNumber = '') => {
    const resolvedName = (name || '').trim() || email.split('@')[0] || 'User';
    if (isFirebaseConfigured && auth) {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: resolvedName });
      const profileData = {
        name: resolvedName,
        email,
        currency: '₹',
        monthlyIncome: Number(monthlyIncome) || 0,
        photoURL: '',
        phoneNumber: phoneNumber || '',
        createdAt: new Date().toISOString(),
      };
      markAccountRegistered({
        email,
        uid: cred.user.uid,
        phoneNumber,
        name: resolvedName,
      });
      upsertUserProfile(cred.user.uid, profileData).catch(() => {});
      setUser(cred.user);
      setProfile(profileData);
      return cred.user;
    }

    // Demo Mode Registration
    const demoUser = { uid: `local-${Date.now()}`, displayName: resolvedName, email, photoURL: '', phoneNumber: phoneNumber || '' };
    const demoProfile = { name: resolvedName, email, currency: '₹', monthlyIncome: Number(monthlyIncome) || 0, photoURL: '', phoneNumber: phoneNumber || '' };
    markAccountRegistered({
      email,
      uid: demoUser.uid,
      phoneNumber,
      name: resolvedName,
    });
    localStorage.setItem('moneymap_demo_registered', 'true');
    localStorage.setItem('moneymap_demo_session', JSON.stringify({ user: demoUser, profile: demoProfile }));
    setUser(demoUser);
    setProfile(demoProfile);
    return demoUser;
  };

  /** Login with email & password */
  const login = async (email, password) => {
    if (isFirebaseConfigured && auth) {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const instantProfile = loadLocal(DEMO_STORAGE_KEY_USER, {
        name: cred.user.displayName || email.split('@')[0],
        email: cred.user.email,
        currency: '₹',
        monthlyIncome: 0,
      });
      setUser(cred.user);
      setProfile(instantProfile);
      getUserProfile(cred.user.uid).then((p) => { if (p) setProfile(p); }).catch(() => {});
      return cred.user;
    }

    // Demo Mode Login
    const demoUser = { uid: 'demo-user-123', displayName: email.split('@')[0], email, photoURL: '', phoneNumber: '9876543210' };
    const demoProfile = { name: email.split('@')[0], email, currency: '₹', monthlyIncome: 65000, photoURL: '', phoneNumber: '9876543210' };
    localStorage.setItem('moneymap_demo_registered', 'true');
    localStorage.setItem('moneymap_demo_session', JSON.stringify({ user: demoUser, profile: demoProfile }));
    setUser(demoUser);
    setProfile(demoProfile);
    return demoUser;
  };

  /**
   * Google Sign-In for Existing Users (Login Page)
   * Uses native Credential Manager on Android, popup on web
   */
  const signInWithGoogleLogin = async (phoneNumber = '') => {
    if (!auth) {
      throw new Error('Google Authentication service is not initialized');
    }

    authFlowInProgressRef.current = true;
    try {
      let cred;
      let additionalInfo;

      if (isNativeAndroid()) {
        // Native Android: get ID token from Credential Manager, then sign in with Firebase
        const nativeResult = await nativeGoogleSignIn();
        const credential = GoogleAuthProvider.credential(nativeResult.idToken);
        cred = await signInWithCredential(auth, credential);
        additionalInfo = getAdditionalUserInfo(cred);
      } else {
        // Web: use popup
        if (!googleProvider) {
          throw new Error('Google Authentication service is not initialized');
        }
        cred = await signInWithPopup(auth, googleProvider);
        additionalInfo = getAdditionalUserInfo(cred);
      }

      const isRegisteredLocal = isAccountRegistered(cred.user.email, cred.user.uid);
      const cachedProfile = loadLocal(getUserProfileKey(cred.user.uid), null);
      let existingProfile = cachedProfile;

      // Always fetch Firestore profile on a new device / missing phone cache
      if (!existingProfile || !existingProfile.phoneNumber) {
        const remote = await getUserProfile(cred.user.uid, { skipLocal: true });
        if (remote) {
          existingProfile = remote;
        }
      }

      // Only reject if Firebase Auth itself says this Google account is brand new
      // and no MoneyMap profile exists locally or in Firestore.
      if (additionalInfo?.isNewUser && !isRegisteredLocal && !existingProfile) {
        await cred.user.delete().catch(() => signOut(auth));
        setUser(null);
        setProfile(null);
        const err = new Error('No MoneyMap account found with this Google account. Please create an account first!');
        err.code = 'NO_ACCOUNT_FOUND';
        err.email = cred.user.email;
        throw err;
      }

      const resolvedPhone = phoneNumber || existingProfile?.phoneNumber || '';
      const profileData = {
        name: cred.user.displayName || 'User',
        email: cred.user.email,
        photoURL: cred.user.photoURL || '',
        currency: '₹',
        monthlyIncome: 0,
        ...(existingProfile || {}),
        phoneNumber: resolvedPhone,
      };

      markAccountRegistered({
        email: cred.user.email,
        uid: cred.user.uid,
        phoneNumber: resolvedPhone,
        name: profileData.name,
      });
      saveLocal(getUserProfileKey(cred.user.uid), { ...profileData, uid: cred.user.uid });

      setUser(cred.user);
      setProfile(profileData);

      // Persist/repair Firestore profile so future cross-device logins always find it
      if (!existingProfile || (phoneNumber && phoneNumber !== existingProfile.phoneNumber)) {
        upsertUserProfile(cred.user.uid, profileData).catch(() => {});
      }

      return { user: cred.user, profile: profileData };
    } finally {
      authFlowInProgressRef.current = false;
    }
  };

  /**
   * Google Sign-Up for New Users (Register Page)
   * Uses native Credential Manager on Android, popup on web
   */
  const signUpWithGoogleRegister = async (phoneNumber = '') => {
    if (!auth) {
      throw new Error('Google Authentication service is not initialized');
    }

    authFlowInProgressRef.current = true;
    try {
      let cred;

      if (isNativeAndroid()) {
        // Native Android: get ID token from Credential Manager, then sign in with Firebase
        const nativeResult = await nativeGoogleSignIn();
        const credential = GoogleAuthProvider.credential(nativeResult.idToken);
        cred = await signInWithCredential(auth, credential);
      } else {
        // Web: use popup
        if (!googleProvider) {
          throw new Error('Google Authentication service is not initialized');
        }
        cred = await signInWithPopup(auth, googleProvider);
      }

      const existingRemote = await getUserProfile(cred.user.uid, { skipLocal: true }).catch(() => null);
      const profileData = {
        name: cred.user.displayName || 'User',
        email: cred.user.email,
        currency: '₹',
        monthlyIncome: 0,
        photoURL: cred.user.photoURL || '',
        ...(existingRemote || {}),
        phoneNumber: phoneNumber || existingRemote?.phoneNumber || '',
        createdAt: existingRemote?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // 1. Mark account registered and save local profile INSTANTLY (0ms!)
      markAccountRegistered({
        email: cred.user.email,
        uid: cred.user.uid,
        phoneNumber: profileData.phoneNumber,
        name: profileData.name,
      });
      saveLocal(getUserProfileKey(cred.user.uid), { ...profileData, uid: cred.user.uid });

      // 2. Set user immediately so UI unblocks instantly
      setUser(cred.user);
      setProfile(profileData);

      // 3. Save to Firestore reliably so other devices (mobile/laptop) see this account
      await upsertUserProfile(cred.user.uid, profileData).catch(() => {});

      return { user: cred.user, profile: profileData, isNew: !existingRemote };
    } finally {
      authFlowInProgressRef.current = false;
    }
  };

  /** Legacy / alias for loginWithGoogle */
  const loginWithGoogle = signInWithGoogleLogin;

  /** Instant 1-Click Demo Explore */
  const loginDemo = () => {
    const demoProf = { name: 'Rahul Sharma', email: 'rahul@example.com', currency: '₹', monthlyIncome: 65000, photoURL: '', phoneNumber: '+91 98765 43210' };
    localStorage.setItem('moneymap_demo_registered', 'true');
    markAccountRegistered({
      email: 'rahul@example.com',
      uid: DEMO_USER.uid,
      phoneNumber: '+91 98765 43210',
      name: 'Rahul Sharma',
    });
    localStorage.setItem('moneymap_demo_session', JSON.stringify({ user: DEMO_USER, profile: demoProf }));
    setUser(DEMO_USER);
    setProfile(demoProf);
  };

  /** Logout */
  const logout = async () => {
    if (isNativeAndroid()) {
      await nativeGoogleSignOut();
    }
    if (isFirebaseConfigured && auth) {
      await signOut(auth);
    }
    localStorage.removeItem('moneymap_demo_session');
    setUser(null);
    setProfile(null);
  };

  /** Update Profile */
  const updateUserProfile = async (data) => {
    if (!user) return;
    const updated = { ...profile, ...data };
    setProfile(updated);
    saveLocal(getUserProfileKey(user.uid), { ...updated, uid: user.uid });
    upsertUserProfile(user.uid, data).catch(() => {});
    if (isFirebaseConfigured && auth?.currentUser) {
      if (data.name) updateProfile(auth.currentUser, { displayName: data.name }).catch(() => {});
      if (data.photoURL) updateProfile(auth.currentUser, { photoURL: data.photoURL }).catch(() => {});
    }
  };

  const value = {
    user,
    profile,
    loading,
    isFirebaseConfigured,
    login,
    loginWithGoogle,
    signInWithGoogleLogin,
    signUpWithGoogleRegister,
    loginDemo,
    register,
    logout,
    updateUserProfile,
    displayName: profile?.name || user?.displayName || 'User',
    currency:    profile?.currency || '₹',
    monthlyIncome: profile?.monthlyIncome ?? 0,
    photoURL:    profile?.photoURL || user?.photoURL || '',
    phoneNumber: profile?.phoneNumber || user?.phoneNumber || '',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
