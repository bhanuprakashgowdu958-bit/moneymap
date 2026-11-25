// Firestore service layer — High Performance with Strict User Account Isolation
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  doc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebase';

// ─────────────────────────────────────────
//  ISOLATED STORAGE HELPERS
// ─────────────────────────────────────────
const DEMO_STORAGE_KEY_EXPENSES = 'moneymap_demo_expenses';
const DEMO_STORAGE_KEY_BUDGETS  = 'moneymap_demo_budgets';
const DEMO_STORAGE_KEY_USER     = 'moneymap_demo_user';

export function isDemoUser(uid) {
  return !uid || uid === 'demo-user-123';
}

export function getExpenseStorageKey(uid) {
  return isDemoUser(uid) ? DEMO_STORAGE_KEY_EXPENSES : `moneymap_user_expenses_${uid}`;
}

export function getBudgetStorageKey(uid) {
  return isDemoUser(uid) ? DEMO_STORAGE_KEY_BUDGETS : `moneymap_user_budgets_${uid}`;
}

export function getUserProfileKey(uid) {
  return isDemoUser(uid) ? DEMO_STORAGE_KEY_USER : `moneymap_user_profile_${uid}`;
}

const FIRESTORE_READ_TIMEOUT_MS = 6000;
const FIRESTORE_WRITE_TIMEOUT_MS = 6000;

/**
 * Fast network wrapper with timeout so UI never hangs indefinitely
 */
export async function withTimeout(promise, ms = FIRESTORE_READ_TIMEOUT_MS, fallback = null) {
  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

function getInitialDemoExpenses() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  return [
    {
      id: 'demo-1',
      title: 'Zomato Biryani & Starters',
      amount: 680,
      category: 'food-delivery',
      date: new Date(year, month, day, 20, 15).toISOString(),
      paymentMethod: 'upi',
      note: 'Dinner with friends',
      isRecurring: false,
    },
    {
      id: 'demo-2',
      title: 'Swiggy Instamart Groceries',
      amount: 920,
      category: 'groceries',
      date: new Date(year, month, Math.max(1, day - 1), 11, 30).toISOString(),
      paymentMethod: 'upi',
      note: 'Milk, vegetables, fruits & oats',
      isRecurring: false,
    },
    {
      id: 'demo-3',
      title: 'Starbucks Cold Brew Coffee',
      amount: 320,
      category: 'drinks-beverages',
      date: new Date(year, month, Math.max(1, day - 2), 16, 0).toISOString(),
      paymentMethod: 'card',
      note: 'Work catchup',
      isRecurring: false,
    },
    {
      id: 'demo-4',
      title: 'Uber Ride to Office',
      amount: 280,
      category: 'transport',
      date: new Date(year, month, Math.max(1, day - 3), 9, 45).toISOString(),
      paymentMethod: 'upi',
      note: 'Peak hour cab',
      isRecurring: false,
    },
    {
      id: 'demo-5',
      title: 'Netflix & Spotify Subs',
      amount: 799,
      category: 'subscriptions',
      date: new Date(year, month, 1, 10, 0).toISOString(),
      paymentMethod: 'card',
      note: 'Monthly auto-debit',
      isRecurring: true,
    },
    {
      id: 'demo-6',
      title: 'Weekend Movie Tickets (PVR)',
      amount: 550,
      category: 'entertainment',
      date: new Date(year, month, Math.max(1, day - 4), 18, 30).toISOString(),
      paymentMethod: 'upi',
      note: 'Evening show',
      isRecurring: false,
    },
  ];
}

function getInitialDemoBudgets() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  return [
    { id: `food-delivery_${month}_${year}`, category: 'food-delivery', limit: 4000, month, year, alertAt: 80 },
    { id: `groceries_${month}_${year}`, category: 'groceries', limit: 8000, month, year, alertAt: 80 },
    { id: `drinks-beverages_${month}_${year}`, category: 'drinks-beverages', limit: 2000, month, year, alertAt: 80 },
    { id: `transport_${month}_${year}`, category: 'transport', limit: 3000, month, year, alertAt: 80 },
    { id: `subscriptions_${month}_${year}`, category: 'subscriptions', limit: 1500, month, year, alertAt: 80 },
  ];
}

export function loadLocal(key, defaultVal) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : defaultVal;
  } catch {
    return defaultVal;
  }
}

export function saveLocal(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (err) {
    console.error('Local storage save error:', err);
  }
}

// ─────────────────────────────────────────
//  USERS
// ─────────────────────────────────────────

export async function upsertUserProfile(uid, data) {
  const key = getUserProfileKey(uid);
  const current = loadLocal(key, {});
  saveLocal(key, { ...current, ...data, uid });

  if (isFirebaseConfigured && db && !isDemoUser(uid)) {
    try {
      const ref = doc(db, 'users', uid);
      let timedOut = false;
      await Promise.race([
        setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true }),
        new Promise((resolve) => setTimeout(() => { timedOut = true; resolve(); }, FIRESTORE_WRITE_TIMEOUT_MS)),
      ]);
      return !timedOut;
    } catch (err) {
      console.warn('Firestore upsertUserProfile notice:', err.message);
      return false;
    }
  }
  return false;
}

/**
 * Fetches user profile while distinguishing missing document vs network/timeout error.
 * Returns { status: 'found' | 'missing' | 'unreachable', profile: object | null }
 */
export async function getUserProfileStatus(uid, { skipLocal = false } = {}) {
  const key = getUserProfileKey(uid);
  if (!skipLocal) {
    const local = loadLocal(key, null);
    if (local && (local.uid === uid || local.id === uid)) {
      return { status: 'found', profile: local };
    }
  }

  if (isFirebaseConfigured && db && !isDemoUser(uid)) {
    try {
      const result = await withTimeout(
        getDoc(doc(db, 'users', uid)).then((snap) => ({ ok: true, snap })),
        FIRESTORE_READ_TIMEOUT_MS,
        { ok: false, snap: null }
      );
      if (!result || !result.ok || !result.snap) {
        return { status: 'unreachable', profile: null };
      }
      if (result.snap.exists && result.snap.exists()) {
        const data = { id: result.snap.id, ...result.snap.data() };
        saveLocal(key, data);
        return { status: 'found', profile: data };
      }
      return { status: 'missing', profile: null };
    } catch (err) {
      console.warn('Firestore getUserProfile notice:', err.message);
      return { status: 'unreachable', profile: null };
    }
  }

  if (isDemoUser(uid)) {
    const demo = loadLocal(DEMO_STORAGE_KEY_USER, null);
    return { status: demo ? 'found' : 'missing', profile: demo };
  }
  return { status: 'unreachable', profile: null };
}

export async function getUserProfile(uid, { skipLocal = false } = {}) {
  const { profile } = await getUserProfileStatus(uid, { skipLocal });
  return profile;
}

/**
 * Fallback lookup for users whose profile was saved under a prior auth method/UID with the same email.
 */
export async function findUserProfileByEmail(email) {
  if (!email || !isFirebaseConfigured || !db) return null;
  const candidates = Array.from(new Set([email.trim(), email.trim().toLowerCase()].filter(Boolean)));
  for (const candidate of candidates) {
    try {
      const q = query(collection(db, 'users'), where('email', '==', candidate), limit(1));
      const snap = await withTimeout(getDocs(q), FIRESTORE_READ_TIMEOUT_MS, null);
      if (snap && snap.docs && snap.docs.length > 0) {
        const d = snap.docs[0];
        return { id: d.id, ...d.data() };
      }
    } catch {
      // Firestore rules may disallow querying /users by email; fail gracefully
      return null;
    }
  }
  return null;
}

/**
 * Checks whether the user already has any expenses or budgets stored in Firestore.
 */
export async function hasAnyUserActivity(uid) {
  if (!uid || isDemoUser(uid) || !isFirebaseConfigured || !db) return false;
  try {
    const [expSnap, budSnap] = await withTimeout(
      Promise.all([
        getDocs(query(collection(db, 'users', uid, 'expenses'), limit(1))),
        getDocs(query(collection(db, 'users', uid, 'budgets'), limit(1))),
      ]),
      FIRESTORE_READ_TIMEOUT_MS,
      [null, null]
    );
    return Boolean((expSnap && !expSnap.empty) || (budSnap && !budSnap.empty));
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────
//  EXPENSES
// ─────────────────────────────────────────

export async function addExpense(uid, data) {
  const localId = `exp-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const txType = data.type === 'income' ? 'income' : 'expense';
  const newExpense = {
    id: localId,
    ...data,
    type: txType,
    amount: Number(data.amount),
    date: new Date(data.date).toISOString(),
    createdAt: new Date().toISOString(),
  };

  // 1. Save to user's isolated local storage (0ms UI update!)
  const storageKey = getExpenseStorageKey(uid);
  const currentExpenses = loadLocal(storageKey, isDemoUser(uid) ? getInitialDemoExpenses() : []);
  saveLocal(storageKey, [newExpense, ...currentExpenses]);

  // 2. Sync to Firestore in background
  if (isFirebaseConfigured && db && !isDemoUser(uid)) {
    try {
      const ref = collection(db, 'users', uid, 'expenses');
      await withTimeout(
        addDoc(ref, {
          ...data,
          type: txType,
          amount: Number(data.amount),
          date: Timestamp.fromDate(new Date(data.date)),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
        1500
      );
    } catch (err) {
      console.warn('Firestore addExpense background sync notice:', err.message);
    }
  }

  return localId;
}

export async function updateExpense(uid, expenseId, data) {
  const storageKey = getExpenseStorageKey(uid);
  const expenses = loadLocal(storageKey, isDemoUser(uid) ? getInitialDemoExpenses() : []);
  const updated = expenses.map((e) =>
    e.id === expenseId
      ? { ...e, ...data, amount: Number(data.amount), date: new Date(data.date).toISOString() }
      : e
  );
  saveLocal(storageKey, updated);

  if (isFirebaseConfigured && db && !isDemoUser(uid)) {
    try {
      const ref = doc(db, 'users', uid, 'expenses', expenseId);
      await withTimeout(
        updateDoc(ref, {
          ...data,
          amount: Number(data.amount),
          date: Timestamp.fromDate(new Date(data.date)),
          updatedAt: serverTimestamp(),
        }),
        1500
      );
    } catch (err) {
      console.warn('Firestore updateExpense notice:', err.message);
    }
  }
}

export async function deleteExpense(uid, expenseId) {
  const storageKey = getExpenseStorageKey(uid);
  const expenses = loadLocal(storageKey, isDemoUser(uid) ? getInitialDemoExpenses() : []);
  saveLocal(storageKey, expenses.filter((e) => e.id !== expenseId));

  if (isFirebaseConfigured && db && !isDemoUser(uid)) {
    try {
      await withTimeout(deleteDoc(doc(db, 'users', uid, 'expenses', expenseId)), 1500);
    } catch (err) {
      console.warn('Firestore deleteExpense notice:', err.message);
    }
  }
}

export async function getExpenses(uid, { month, year, category, type } = {}) {
  let expenses = [];
  let fetchedFromFirestore = false;

  // Real users: try Firestore first
  if (isFirebaseConfigured && db && !isDemoUser(uid)) {
    try {
      const ref = collection(db, 'users', uid, 'expenses');
      const q = query(ref, orderBy('date', 'desc'));
      const snap = await withTimeout(getDocs(q), FIRESTORE_READ_TIMEOUT_MS, null);
      if (snap && snap.docs) {
        expenses = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
          type: d.data().type === 'income' ? 'income' : 'expense',
          date: d.data().date?.toDate?.() ?? new Date(d.data().date),
        }));
        fetchedFromFirestore = true;
        // Keep user's isolated local cache in sync
        saveLocal(getExpenseStorageKey(uid), expenses);
      }
    } catch (err) {
      console.warn('Firestore getExpenses notice:', err.message);
    }
  }

  // If not fetched from Firestore, load from user's isolated storage
  // Real users start with [] (EMPTY), demo users start with sample data
  if (!fetchedFromFirestore) {
    const defaultData = isDemoUser(uid) ? getInitialDemoExpenses() : [];
    expenses = loadLocal(getExpenseStorageKey(uid), defaultData).map((e) => ({
      ...e,
      type: e.type === 'income' ? 'income' : 'expense',
      date: new Date(e.date),
    }));
  }

  if (month && year) {
    expenses = expenses.filter((e) => {
      const d = new Date(e.date);
      return d.getMonth() + 1 === Number(month) && d.getFullYear() === Number(year);
    });
  }

  if (type && type !== 'all') {
    expenses = expenses.filter((e) => e.type === type);
  }

  if (category && category !== 'all') {
    expenses = expenses.filter((e) => e.category === category);
  }

  return expenses;
}

export async function getRecentExpenses(uid, count = 5, preloadedExpenses = null) {
  const all = preloadedExpenses || await getExpenses(uid);
  return all.slice(0, count);
}

export async function getMonthlyStats(uid, month, year, preloadedExpenses = null) {
  const all = preloadedExpenses || await getExpenses(uid);
  const curTransactions = all.filter((e) => {
    const d = new Date(e.date);
    return d.getMonth() + 1 === Number(month) && d.getFullYear() === Number(year);
  });

  const curExpenses = curTransactions.filter((e) => e.type !== 'income');
  const curIncomes = curTransactions.filter((e) => e.type === 'income');

  const total = curExpenses.reduce((s, e) => s + e.amount, 0);
  const incomeTotal = curIncomes.reduce((s, e) => s + e.amount, 0);

  const byCategory = {};
  curExpenses.forEach((e) => {
    if (!byCategory[e.category]) byCategory[e.category] = { total: 0, count: 0 };
    byCategory[e.category].total += e.amount;
    byCategory[e.category].count += 1;
  });

  const stats = Object.entries(byCategory)
    .map(([category, v]) => ({ _id: category, ...v }))
    .sort((a, b) => b.total - a.total);

  return {
    total,
    incomeTotal,
    netBalance: incomeTotal - total,
    stats,
    expenses: curExpenses,
    incomes: curIncomes,
    allExpenses: all,
  };
}

export async function getWeeklyData(uid, preloadedExpenses = null) {
  const all = preloadedExpenses || await getExpenses(uid);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const dayMap = {};
  all.forEach((e) => {
    if (e.type === 'income') return;
    const d = new Date(e.date);
    if (d >= sevenDaysAgo) {
      const key = d.toISOString().split('T')[0];
      dayMap[key] = (dayMap[key] || 0) + e.amount;
    }
  });

  return Object.entries(dayMap).map(([_id, total]) => ({ _id, total }));
}

// ─────────────────────────────────────────
//  BUDGETS
// ─────────────────────────────────────────

export async function setBudget(uid, { category, limit, month, year, alertAt = 80 }) {
  const docId = `${category}_${month}_${year}`;
  const storageKey = getBudgetStorageKey(uid);
  const budgets = loadLocal(storageKey, isDemoUser(uid) ? getInitialDemoBudgets() : []);
  const existingIdx = budgets.findIndex((b) => b.category === category && b.month === month && b.year === year);
  const entry = { id: docId, category, limit: Number(limit), month, year, alertAt };
  if (existingIdx >= 0) {
    budgets[existingIdx] = entry;
  } else {
    budgets.push(entry);
  }
  saveLocal(storageKey, budgets);

  if (isFirebaseConfigured && db && !isDemoUser(uid)) {
    try {
      const ref = doc(db, 'users', uid, 'budgets', docId);
      await withTimeout(setDoc(ref, { category, limit: Number(limit), month, year, alertAt, updatedAt: serverTimestamp() }), 1500);
    } catch (err) {
      console.warn('Firestore setBudget notice:', err.message);
    }
  }

  return docId;
}

export async function getBudgets(uid, month, year) {
  const storageKey = getBudgetStorageKey(uid);

  if (isFirebaseConfigured && db && !isDemoUser(uid)) {
    try {
      const ref = collection(db, 'users', uid, 'budgets');
      const q = query(ref, where('month', '==', month), where('year', '==', year));
      const snap = await withTimeout(getDocs(q), FIRESTORE_READ_TIMEOUT_MS, null);
      if (snap && snap.docs) {
        const budgets = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        saveLocal(storageKey, budgets);
        return budgets;
      }
    } catch (err) {
      console.warn('Firestore getBudgets notice:', err.message);
    }
  }

  // Real users start with [] (EMPTY), demo user gets sample budgets
  const defaultBudgets = isDemoUser(uid) ? getInitialDemoBudgets() : [];
  const all = loadLocal(storageKey, defaultBudgets);
  return all.filter((b) => b.month === month && b.year === year);
}

export async function deleteBudget(uid, budgetId) {
  const storageKey = getBudgetStorageKey(uid);
  const all = loadLocal(storageKey, isDemoUser(uid) ? getInitialDemoBudgets() : []);
  saveLocal(storageKey, all.filter((b) => b.id !== budgetId));

  if (isFirebaseConfigured && db && !isDemoUser(uid)) {
    try {
      await withTimeout(deleteDoc(doc(db, 'users', uid, 'budgets', budgetId)), 1500);
    } catch (err) {
      console.warn('Firestore deleteBudget notice:', err.message);
    }
  }
}

// ─────────────────────────────────────────
//  PHONE SMS WEBHOOK TOKENS
// ─────────────────────────────────────────

function generateWebhookToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let rand = '';
  for (let i = 0; i < 24; i++) {
    rand += chars[Math.floor(Math.random() * chars.length)];
  }
  return `mm_${rand}`;
}

export async function getOrCreateWebhookToken(uid) {
  if (!uid || isDemoUser(uid)) return null;

  const profileKey = getUserProfileKey(uid);
  const localProfile = loadLocal(profileKey, {});
  if (localProfile.webhookToken) {
    return localProfile.webhookToken;
  }

  const remoteProfile = await getUserProfile(uid);
  if (remoteProfile?.webhookToken) {
    saveLocal(profileKey, { ...localProfile, webhookToken: remoteProfile.webhookToken });
    return remoteProfile.webhookToken;
  }

  return regenerateWebhookToken(uid, null);
}

export async function regenerateWebhookToken(uid, oldToken = null) {
  if (!uid || isDemoUser(uid)) return null;

  const newToken = generateWebhookToken();
  const profileKey = getUserProfileKey(uid);
  const localProfile = loadLocal(profileKey, {});
  saveLocal(profileKey, { ...localProfile, webhookToken: newToken });

  if (isFirebaseConfigured && db) {
    try {
      if (oldToken) {
        await withTimeout(deleteDoc(doc(db, 'webhookTokens', oldToken)), 1200);
      }
      await withTimeout(
        setDoc(doc(db, 'webhookTokens', newToken), {
          uid,
          createdAt: serverTimestamp(),
        }),
        1500
      );
      await withTimeout(
        setDoc(doc(db, 'users', uid), { webhookToken: newToken, updatedAt: serverTimestamp() }, { merge: true }),
        1500
      );
    } catch (err) {
      console.warn('Firestore webhook token sync notice:', err.message);
    }
  }

  return newToken;
}
