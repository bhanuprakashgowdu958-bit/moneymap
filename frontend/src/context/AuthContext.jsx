import { createContext, useContext, useState, useEffect } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  signInWithPopup,
  getAdditionalUserInfo,
} from 'firebase/auth';
import { auth, googleProvider, isFirebaseConfigured } from '../lib/firebase';
import { upsertUserProfile, getUserProfile } from '../lib/firestore';

const AuthContext = createContext(null);

const STORAGE_KEY_REGISTERED = 'moneymap_registered_accounts';

/**
 * Checks whether an account was explicitly registered with phone number
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
 * Marks an account as registered upon successful registration
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

  // Initialize auth state
  useEffect(() => {
    if (isFirebaseConfigured && auth) {
      const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          let p = null;
          try {
            p = await getUserProfile(firebaseUser.uid);
          } catch {
            p = null;
          }

          const isRegistered = isAccountRegistered(firebaseUser.email, firebaseUser.uid) || Boolean(p && p.phoneNumber);

          // If session belongs to an unregistered user who never completed registration flow:
          if (!isRegistered) {
            await signOut(auth);
            setUser(null);
            setProfile(null);
            setLoading(false);
            return;
          }

          setUser(firebaseUser);
          setProfile(p);
        } else {
          setUser(null);
          setProfile(null);
        }
        setLoading(false);
      });
      return unsubscribe;
    } else {
      // Local / Demo Mode check
      const savedDemo = localStorage.getItem('moneymap_demo_session');
      if (savedDemo) {
        try {
          const parsed = JSON.parse(savedDemo);
          const isRegistered = isAccountRegistered(parsed.user?.email, parsed.user?.uid) || Boolean(localStorage.getItem('moneymap_demo_registered'));
          if (isRegistered) {
            setUser(parsed.user);
            setProfile(parsed.profile);
          } else {
            setUser(null);
            setProfile(null);
          }
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
      await upsertUserProfile(cred.user.uid, profileData);
      markAccountRegistered({
        email,
        uid: cred.user.uid,
        phoneNumber,
        name,
      });
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
      let p = null;
      try {
        p = await getUserProfile(cred.user.uid);
      } catch {
        p = null;
      }
      setUser(cred.user);
      setProfile(p);
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
   * Strictly checks if an account already exists. If not, signs out and throws NO_ACCOUNT_FOUND.
   */
  const signInWithGoogleLogin = async () => {
    if (isFirebaseConfigured && auth && googleProvider) {
      const cred = await signInWithPopup(auth, googleProvider);
      const additionalInfo = getAdditionalUserInfo(cred);

      let existing = null;
      try {
        existing = await getUserProfile(cred.user.uid);
      } catch (err) {
        console.warn('Profile fetch notice:', err);
      }

      const isRegisteredLocal = isAccountRegistered(cred.user.email, cred.user.uid);
      const isRegisteredFirestore = Boolean(existing && existing.phoneNumber);

      // If Firebase says brand new account OR account has never registered with phone number:
      if (additionalInfo?.isNewUser || (!isRegisteredLocal && !isRegisteredFirestore)) {
        await signOut(auth);
        setUser(null);
        setProfile(null);
        const err = new Error('No MoneyMap account found with this Google account. Please create an account first!');
        err.code = 'NO_ACCOUNT_FOUND';
        err.email = cred.user.email;
        throw err;
      }

      setUser(cred.user);
      setProfile(existing || { name: cred.user.displayName, email: cred.user.email });
      return { user: cred.user, profile: existing };
    }

    // Demo Mode Google Login Check
    const isDemoRegistered = isAccountRegistered('explorer@gmail.com', 'google-demo-uid') || Boolean(localStorage.getItem('moneymap_demo_registered'));
    if (!isDemoRegistered) {
      const err = new Error('No MoneyMap account found with this Google account. Please create an account first!');
      err.code = 'NO_ACCOUNT_FOUND';
      throw err;
    }

    const savedDemo = localStorage.getItem('moneymap_demo_session');
    const demoData = savedDemo ? JSON.parse(savedDemo) : null;
    const user = demoData?.user || { uid: 'google-demo-uid', displayName: 'Google Explorer', email: 'explorer@gmail.com', photoURL: '' };
    const profile = demoData?.profile || { name: 'Google Explorer', email: 'explorer@gmail.com', currency: '₹', monthlyIncome: 70000, phoneNumber: '+91 98765 43210' };
    setUser(user);
    setProfile(profile);
    return { user, profile };
  };

  /**
   * Google Sign-Up for New Users (Register Page)
   * Mandatory Phone Number is saved to their profile and marked registered
   */
  const signUpWithGoogleRegister = async (phoneNumber = '') => {
    if (isFirebaseConfigured && auth && googleProvider) {
      const cred = await signInWithPopup(auth, googleProvider);
      let existing = null;
      try {
        existing = await getUserProfile(cred.user.uid);
      } catch (err) {
        console.warn('Profile fetch notice:', err);
      }

      const profileData = {
        name: cred.user.displayName || existing?.name || 'User',
        email: cred.user.email,
        currency: existing?.currency || '₹',
        monthlyIncome: existing?.monthlyIncome || 0,
        photoURL: cred.user.photoURL || existing?.photoURL || '',
        phoneNumber: phoneNumber || existing?.phoneNumber || '',
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      try {
        await upsertUserProfile(cred.user.uid, profileData);
      } catch (err) {
        console.warn('Firestore profile save notice:', err);
      }

      // Mark account as officially registered!
      markAccountRegistered({
        email: cred.user.email,
        uid: cred.user.uid,
        phoneNumber,
        name: profileData.name,
      });

      setUser(cred.user);
      setProfile(profileData);
      return { user: cred.user, profile: profileData, isNew: !existing };
    }

    // Demo Mode Google Registration
    const demoUser = {
      uid: 'google-demo-uid',
      displayName: 'Google Explorer',
      email: 'explorer@gmail.com',
      photoURL: '',
      phoneNumber,
    };
    const demoProfile = {
      name: 'Google Explorer',
      email: 'explorer@gmail.com',
      currency: '₹',
      monthlyIncome: 70000,
      photoURL: '',
      phoneNumber,
    };
    localStorage.setItem('moneymap_demo_registered', 'true');
    markAccountRegistered({
      email: 'explorer@gmail.com',
      uid: 'google-demo-uid',
      phoneNumber,
      name: 'Google Explorer',
    });
    localStorage.setItem('moneymap_demo_session', JSON.stringify({ user: demoUser, profile: demoProfile }));
    setUser(demoUser);
    setProfile(demoProfile);
    return { user: demoUser, profile: demoProfile, isNew: true };
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
    await upsertUserProfile(user.uid, data);
    if (isFirebaseConfigured && auth?.currentUser) {
      if (data.name) await updateProfile(auth.currentUser, { displayName: data.name });
      if (data.photoURL) await updateProfile(auth.currentUser, { photoURL: data.photoURL });
    }
    const updated = { ...profile, ...data };
    setProfile(updated);
    if (!isFirebaseConfigured) {
      localStorage.setItem('moneymap_demo_session', JSON.stringify({ user: { ...user, displayName: data.name || user.displayName }, profile: updated }));
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
