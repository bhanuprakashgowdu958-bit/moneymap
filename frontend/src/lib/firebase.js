// Firebase configuration and initialization
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, initializeFirestore } from 'firebase/firestore';

const apiKey = import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyC33XfyhiwYLeSEE5ERPhmBhtTxm_scSkg';

const firebaseConfig = {
  apiKey:            apiKey,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'moneymap-5c848.firebaseapp.com',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID || 'moneymap-5c848',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'moneymap-5c848.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '1020623021434',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID || '1:1020623021434:web:8c46f227f5563607bda2c3',
};

export const isFirebaseConfigured = Boolean(
  apiKey &&
  apiKey !== 'your_firebase_api_key' &&
  !apiKey.includes('your_')
);

let app = null;
let auth = null;
let googleProvider = null;
let db = null;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
  try {
    // Auto-detect long polling prevents WebChannel stalls on Capacitor Android WebView and mobile networks
    db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  } catch {
    db = getFirestore(app);
  }
} catch (err) {
  console.warn('Firebase initialization notice:', err);
}

export { app, auth, googleProvider, db };
export default app;
