import { createContext, useContext, useState, useEffect } from 'react';
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

  // Initialize auth state (instant non-blocking)
  useEffect(() => {
    // Initialize native Google Auth on Android (non-blocking)
    if (isNativeAndroid()) {
      initNativeGoogleAuth().catch(() => {});
    }

    if (isFirebaseConfigured && auth) {
      const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
        if (firebaseUser) {
          const isRegistered = isAccountRegistered(firebaseUser.email, firebaseUser.uid);
          const cachedLocal = loadLocal(getUserProfileKey(firebaseUser.uid), null);

          // If session belongs to an unregistered user who never completed registration flow:
          if (!isRegistered && (!cachedLocal || !cachedLocal.phoneNumber)) {
            signOut(auth).catch(() => {});
            setUser(null);
            setProfile(null);
            setLoading(false);
            return;
          }

          // 1. Immediately set user and instant profile (0ms!)
          const instantProfile = cachedLocal || {
            name: firebaseUser.displayName || 'User',
            email: firebaseUser.email,
            photoURL: firebaseUser.photoURL || '',
            currency: '₹',
            monthlyIncome: 0,
            phoneNumber: cachedLocal?.phoneNumber || '',
          };

          setUser(firebaseUser);
          setProfile(instantProfile);
          setLoading(false);

          // 2. Fetch fresh Firestore updates in the background without blocking the UI
          getUserProfile(firebaseUser.uid)
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
    if (isFirebaseConfigured && auth) {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      const profileData = {
        name,
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
        name,
      });
      upsertUserProfile(cred.user.uid, profileData).catch(() => {});
      setUser(cred.user);
      setProfile(profileData);
      return cred.user;
    }

    // Demo Mode Registration
    const demoUser = { uid: `local-${Date.now()}`, displayName: name, email, photoURL: '', phoneNumber: phoneNumber || '' };
    const demoProfile = { name, email, currency: '₹', monthlyIncome: Number(monthlyIncome) || 0, photoURL: '', phoneNumber: phoneNumber || '' };
    markAccountRegistered({
      email,
      uid: demoUser.uid,
      phoneNumber,
      name,
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
  const signInWithGoogleLogin = async () => {
    if (!auth) {
      throw new Error('Google Authentication service is not initialized');
    }

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

    // Instant local check first (0ms)
    const isRegisteredLocal = isAccountRegistered(cred.user.email, cred.user.uid);
    const cachedProfile = loadLocal(getUserProfileKey(cred.user.uid), null);
    const hasPhoneCached = Boolean(cachedProfile && cachedProfile.phoneNumber);

    if (additionalInfo?.isNewUser || (!isRegisteredLocal && !hasPhoneCached)) {
      // Check remote Firestore as last resort
      const existing = await getUserProfile(cred.user.uid);
      if (!existing || !existing.phoneNumber) {
        await signOut(auth);
        setUser(null);
        setProfile(null);
        const err = new Error('No MoneyMap account found with this Google account. Please create an account first!');
        err.code = 'NO_ACCOUNT_FOUND';
        err.email = cred.user.email;
        throw err;
      }
    }

    const profileData = cachedProfile || {
      name: cred.user.displayName || 'User',
      email: cred.user.email,
      photoURL: cred.user.photoURL || '',
      currency: '₹',
      monthlyIncome: 0,
      phoneNumber: '',
    };

    setUser(cred.user);
    setProfile(profileData);

    // Sync Firestore in background
    getUserProfile(cred.user.uid).then((fresh) => {
      if (fresh) setProfile((prev) => ({ ...prev, ...fresh }));
    }).catch(() => {});

    return { user: cred.user, profile: profileData };
  };

  /**
   * Google Sign-Up for New Users (Register Page)
   * Uses native Credential Manager on Android, popup on web
   */
  const signUpWithGoogleRegister = async (phoneNumber = '') => {
    if (!auth) {
      throw new Error('Google Authentication service is not initialized');
    }

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

    const profileData = {
      name: cred.user.displayName || 'User',
      email: cred.user.email,
      currency: '₹',
      monthlyIncome: 0,
      photoURL: cred.user.photoURL || '',
      phoneNumber: phoneNumber || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 1. Mark account registered and save local profile INSTANTLY (0ms!)
    markAccountRegistered({
      email: cred.user.email,
      uid: cred.user.uid,
      phoneNumber,
      name: profileData.name,
    });
    saveLocal(getUserProfileKey(cred.user.uid), { ...profileData, uid: cred.user.uid });

    // 2. Set user immediately so UI unblocks instantly
    setUser(cred.user);
    setProfile(profileData);

    // 3. Save to Firestore in background without delaying user
    upsertUserProfile(cred.user.uid, profileData).catch(() => {});

    return { user: cred.user, profile: profileData, isNew: true };
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
