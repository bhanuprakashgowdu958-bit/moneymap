// Firestore service layer — High Performance with Instant Local-First Caching
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
//  DEMO / LOCAL STORAGE FALLBACK HELPERS
// ─────────────────────────────────────────
const DEMO_STORAGE_KEY_EXPENSES = 'moneymap_demo_expenses';
const DEMO_STORAGE_KEY_BUDGETS  = 'moneymap_demo_budgets';
const DEMO_STORAGE_KEY_USER     = 'moneymap_demo_user';

/**
 * Fast network wrapper with strict timeout so UI never hangs
 */
export async function withTimeout(promise, ms = 1200, fallback = null) {
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
  // Always update local cache instantly for 0ms access
  const current = loadLocal(DEMO_STORAGE_KEY_USER, {});
  saveLocal(DEMO_STORAGE_KEY_USER, { ...current, ...data, uid });

  if (isFirebaseConfigured && db) {
    try {
      const ref = doc(db, 'users', uid);
      await withTimeout(setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true }), 1500);
    } catch (err) {
      console.warn('Firestore upsertUserProfile notice:', err.message);
    }
  }
}

export async function getUserProfile(uid) {
  // Check local stored profile first (0ms instantaneous!)
  const local = loadLocal(DEMO_STORAGE_KEY_USER, null);
  if (local && (local.uid === uid || local.id === uid)) {
    return local;
  }

  if (isFirebaseConfigured && db) {
    try {
      const snap = await withTimeout(getDoc(doc(db, 'users', uid)), 1200, null);
      if (snap && snap.exists && snap.exists()) {
        const data = { id: snap.id, ...snap.data() };
        saveLocal(DEMO_STORAGE_KEY_USER, data);
        return data;
      }
    } catch (err) {
      console.warn('Firestore getUserProfile notice:', err.message);
    }
  }

  return null;
}

// ─────────────────────────────────────────
//  EXPENSES
// ─────────────────────────────────────────

export async function addExpense(uid, data) {
  const localId = `exp-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const newExpense = {
    id: localId,
    ...data,
    amount: Number(data.amount),
    date: new Date(data.date).toISOString(),
    createdAt: new Date().toISOString(),
  };

  // 1. Save to local storage instantly (0ms UI update!)
  const expenses = loadLocal(DEMO_STORAGE_KEY_EXPENSES, getInitialDemoExpenses());
  saveLocal(DEMO_STORAGE_KEY_EXPENSES, [newExpense, ...expenses]);

  // 2. Sync to Firestore in background
  if (isFirebaseConfigured && db) {
    try {
      const ref = collection(db, 'users', uid, 'expenses');
      await withTimeout(
        addDoc(ref, {
          ...data,
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
  // 1. Update local storage instantly
  const expenses = loadLocal(DEMO_STORAGE_KEY_EXPENSES, getInitialDemoExpenses());
  const updated = expenses.map((e) =>
    e.id === expenseId
      ? { ...e, ...data, amount: Number(data.amount), date: new Date(data.date).toISOString() }
      : e
  );
  saveLocal(DEMO_STORAGE_KEY_EXPENSES, updated);

  // 2. Sync to Firestore in background
  if (isFirebaseConfigured && db) {
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
  // 1. Update local storage instantly
  const expenses = loadLocal(DEMO_STORAGE_KEY_EXPENSES, getInitialDemoExpenses());
  saveLocal(DEMO_STORAGE_KEY_EXPENSES, expenses.filter((e) => e.id !== expenseId));

  // 2. Sync to Firestore in background
  if (isFirebaseConfigured && db) {
    try {
      await withTimeout(deleteDoc(doc(db, 'users', uid, 'expenses', expenseId)), 1500);
    } catch (err) {
      console.warn('Firestore deleteExpense notice:', err.message);
    }
  }
}

export async function getExpenses(uid, { month, year, category } = {}) {
  let expenses = [];
  let fetchedFromFirestore = false;

  if (isFirebaseConfigured && db) {
    try {
      const ref = collection(db, 'users', uid, 'expenses');
      const q = query(ref, orderBy('date', 'desc'));
      const snap = await withTimeout(getDocs(q), 1200, null);
      if (snap && snap.docs && snap.docs.length > 0) {
        expenses = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
          date: d.data().date?.toDate?.() ?? new Date(d.data().date),
        }));
        fetchedFromFirestore = true;
      }
    } catch (err) {
      console.warn('Firestore getExpenses notice:', err.message);
    }
  }

  if (!fetchedFromFirestore) {
    expenses = loadLocal(DEMO_STORAGE_KEY_EXPENSES, getInitialDemoExpenses()).map((e) => ({
      ...e,
      date: new Date(e.date),
    }));
  }

  if (month && year) {
    expenses = expenses.filter((e) => {
      const d = new Date(e.date);
      return d.getMonth() + 1 === Number(month) && d.getFullYear() === Number(year);
    });
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
  const curExpenses = all.filter((e) => {
    const d = new Date(e.date);
    return d.getMonth() + 1 === Number(month) && d.getFullYear() === Number(year);
  });
  const total = curExpenses.reduce((s, e) => s + e.amount, 0);

  const byCategory = {};
  curExpenses.forEach((e) => {
    if (!byCategory[e.category]) byCategory[e.category] = { total: 0, count: 0 };
    byCategory[e.category].total += e.amount;
    byCategory[e.category].count += 1;
  });

  const stats = Object.entries(byCategory)
    .map(([category, v]) => ({ _id: category, ...v }))
    .sort((a, b) => b.total - a.total);

  return { total, stats, expenses: curExpenses, allExpenses: all };
}

export async function getWeeklyData(uid, preloadedExpenses = null) {
  const all = preloadedExpenses || await getExpenses(uid);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const dayMap = {};
  all.forEach((e) => {
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
  const budgets = loadLocal(DEMO_STORAGE_KEY_BUDGETS, getInitialDemoBudgets());
  const existingIdx = budgets.findIndex((b) => b.category === category && b.month === month && b.year === year);
  const entry = { id: docId, category, limit: Number(limit), month, year, alertAt };
  if (existingIdx >= 0) {
    budgets[existingIdx] = entry;
  } else {
    budgets.push(entry);
  }
  saveLocal(DEMO_STORAGE_KEY_BUDGETS, budgets);

  if (isFirebaseConfigured && db) {
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
  if (isFirebaseConfigured && db) {
    try {
      const ref = collection(db, 'users', uid, 'budgets');
      const q = query(ref, where('month', '==', month), where('year', '==', year));
      const snap = await withTimeout(getDocs(q), 1200, null);
      if (snap && snap.docs && snap.docs.length > 0) {
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }
    } catch (err) {
      console.warn('Firestore getBudgets notice:', err.message);
    }
  }
  const all = loadLocal(DEMO_STORAGE_KEY_BUDGETS, getInitialDemoBudgets());
  return all.filter((b) => b.month === month && b.year === year);
}

export async function deleteBudget(uid, budgetId) {
  const all = loadLocal(DEMO_STORAGE_KEY_BUDGETS, getInitialDemoBudgets());
  saveLocal(DEMO_STORAGE_KEY_BUDGETS, all.filter((b) => b.id !== budgetId));

  if (isFirebaseConfigured && db) {
    try {
      await withTimeout(deleteDoc(doc(db, 'users', uid, 'budgets', budgetId)), 1500);
    } catch (err) {
      console.warn('Firestore deleteBudget notice:', err.message);
    }
  }
}
