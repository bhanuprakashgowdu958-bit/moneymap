import { createContext, useContext, useState, useEffect } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  signInWithPopup,
} from 'firebase/auth';
import { auth, googleProvider, isFirebaseConfigured } from '../lib/firebase';
import { upsertUserProfile, getUserProfile } from '../lib/firestore';

const AuthContext = createContext(null);

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
          setUser(firebaseUser);
          try {
            const p = await getUserProfile(firebaseUser.uid);
            setProfile(p);
          } catch {
            setProfile(null);
          }
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
          setUser(parsed.user);
          setProfile(parsed.profile);
        } catch {
          setUser(null);
        }
      }
      setLoading(false);
    }
  }, []);

  /** Register */
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
      setProfile(profileData);
      return cred.user;
    }

    // Demo Mode Registration
    const demoUser = { uid: `local-${Date.now()}`, displayName: name, email, photoURL: '', phoneNumber: phoneNumber || '' };
    const demoProfile = { name, email, currency: '₹', monthlyIncome: Number(monthlyIncome) || 0, photoURL: '', phoneNumber: phoneNumber || '' };
    localStorage.setItem('moneymap_demo_session', JSON.stringify({ user: demoUser, profile: demoProfile }));
    setUser(demoUser);
    setProfile(demoProfile);
    return demoUser;
  };

  /** Login */
  const login = async (email, password) => {
    if (isFirebaseConfigured && auth) {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const p = await getUserProfile(cred.user.uid);
      setProfile(p);
      return cred.user;
    }

    // Demo Mode Login
    const demoUser = { uid: 'demo-user-123', displayName: email.split('@')[0], email, photoURL: '', phoneNumber: '9876543210' };
    const demoProfile = { name: email.split('@')[0], email, currency: '₹', monthlyIncome: 65000, photoURL: '', phoneNumber: '9876543210' };
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
      let existing = null;
      try {
        existing = await getUserProfile(cred.user.uid);
      } catch (err) {
        console.warn('Profile fetch notice:', err);
      }

      if (!existing) {
        // Not registered yet! Sign out from Firebase session
        await signOut(auth);
        setUser(null);
        setProfile(null);
        const err = new Error('No MoneyMap account found with this Google account. Please create an account first!');
        err.code = 'NO_ACCOUNT_FOUND';
        err.email = cred.user.email;
        throw err;
      }

      setUser(cred.user);
      setProfile(existing);
      return { user: cred.user, profile: existing };
    }

    // Demo Mode Google Login Check
    const isDemoRegistered = localStorage.getItem('moneymap_demo_registered');
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
   * Mandatory Phone Number is saved to their profile
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
