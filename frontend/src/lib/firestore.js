// Firestore service layer — supports Live Firestore with automatic Local Demo fallback
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

function loadLocal(key, defaultVal) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : defaultVal;
  } catch {
    return defaultVal;
  }
}

function saveLocal(key, val) {
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
  if (isFirebaseConfigured && db) {
    const ref = doc(db, 'users', uid);
    await setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true });
    return;
  }
  const current = loadLocal(DEMO_STORAGE_KEY_USER, {});
  saveLocal(DEMO_STORAGE_KEY_USER, { ...current, ...data });
}

export async function getUserProfile(uid) {
  if (isFirebaseConfigured && db) {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }
  return loadLocal(DEMO_STORAGE_KEY_USER, {
    name: 'Rahul Sharma',
    email: 'demo@moneymap.app',
    currency: '₹',
    monthlyIncome: 65000,
    photoURL: '',
  });
}

// ─────────────────────────────────────────
//  EXPENSES
// ─────────────────────────────────────────

export async function addExpense(uid, data) {
  if (isFirebaseConfigured && db) {
    const ref = collection(db, 'users', uid, 'expenses');
    const docRef = await addDoc(ref, {
      ...data,
      amount: Number(data.amount),
      date: Timestamp.fromDate(new Date(data.date)),
      createdAt: serverTimestamp(),
    });
    return docRef.id;
  }

  const expenses = loadLocal(DEMO_STORAGE_KEY_EXPENSES, getInitialDemoExpenses());
  const newExp = {
    id: `local-${Date.now()}`,
    ...data,
    amount: Number(data.amount),
    date: new Date(data.date).toISOString(),
    createdAt: new Date().toISOString(),
  };
  expenses.unshift(newExp);
  saveLocal(DEMO_STORAGE_KEY_EXPENSES, expenses);
  return newExp.id;
}

export async function updateExpense(uid, expenseId, data) {
  if (isFirebaseConfigured && db) {
    const ref = doc(db, 'users', uid, 'expenses', expenseId);
    await updateDoc(ref, {
      ...data,
      amount: Number(data.amount),
      date: Timestamp.fromDate(new Date(data.date)),
      updatedAt: serverTimestamp(),
    });
    return;
  }

  const expenses = loadLocal(DEMO_STORAGE_KEY_EXPENSES, getInitialDemoExpenses());
  const updated = expenses.map((e) =>
    e.id === expenseId
      ? { ...e, ...data, amount: Number(data.amount), date: new Date(data.date).toISOString() }
      : e
  );
  saveLocal(DEMO_STORAGE_KEY_EXPENSES, updated);
}

export async function deleteExpense(uid, expenseId) {
  if (isFirebaseConfigured && db) {
    await deleteDoc(doc(db, 'users', uid, 'expenses', expenseId));
    return;
  }
  const expenses = loadLocal(DEMO_STORAGE_KEY_EXPENSES, getInitialDemoExpenses());
  saveLocal(DEMO_STORAGE_KEY_EXPENSES, expenses.filter((e) => e.id !== expenseId));
}

export async function getExpenses(uid, { month, year, category } = {}) {
  let expenses = [];
  if (isFirebaseConfigured && db) {
    const ref = collection(db, 'users', uid, 'expenses');
    const q = query(ref, orderBy('date', 'desc'));
    const snap = await getDocs(q);
    expenses = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      date: d.data().date?.toDate?.() ?? new Date(d.data().date),
    }));
  } else {
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

export async function getRecentExpenses(uid, count = 5) {
  if (isFirebaseConfigured && db) {
    const ref = collection(db, 'users', uid, 'expenses');
    const q = query(ref, orderBy('date', 'desc'), limit(count));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
      date: d.data().date?.toDate?.() ?? new Date(d.data().date),
    }));
  }
  const all = await getExpenses(uid);
  return all.slice(0, count);
}

export async function getMonthlyStats(uid, month, year) {
  const all = await getExpenses(uid, { month, year });
  const total = all.reduce((s, e) => s + e.amount, 0);

  const byCategory = {};
  all.forEach((e) => {
    if (!byCategory[e.category]) byCategory[e.category] = { total: 0, count: 0 };
    byCategory[e.category].total += e.amount;
    byCategory[e.category].count += 1;
  });

  const stats = Object.entries(byCategory)
    .map(([category, v]) => ({ _id: category, ...v }))
    .sort((a, b) => b.total - a.total);

  return { total, stats, expenses: all };
}

export async function getWeeklyData(uid) {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  if (isFirebaseConfigured && db) {
    const ref = collection(db, 'users', uid, 'expenses');
    const q = query(ref, where('date', '>=', Timestamp.fromDate(sevenDaysAgo)), orderBy('date', 'asc'));
    const snap = await getDocs(q);

    const dayMap = {};
    snap.docs.forEach((d) => {
      const data = d.data();
      const date = data.date?.toDate?.() ?? new Date(data.date);
      const key = date.toISOString().split('T')[0];
      dayMap[key] = (dayMap[key] || 0) + data.amount;
    });

    return Object.entries(dayMap).map(([_id, total]) => ({ _id, total }));
  }

  const all = await getExpenses(uid);
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
  if (isFirebaseConfigured && db) {
    const ref = doc(db, 'users', uid, 'budgets', docId);
    await setDoc(ref, { category, limit: Number(limit), month, year, alertAt, updatedAt: serverTimestamp() });
    return docId;
  }

  const budgets = loadLocal(DEMO_STORAGE_KEY_BUDGETS, getInitialDemoBudgets());
  const existingIdx = budgets.findIndex((b) => b.category === category && b.month === month && b.year === year);
  const entry = { id: docId, category, limit: Number(limit), month, year, alertAt };
  if (existingIdx >= 0) {
    budgets[existingIdx] = entry;
  } else {
    budgets.push(entry);
  }
  saveLocal(DEMO_STORAGE_KEY_BUDGETS, budgets);
  return docId;
}

export async function getBudgets(uid, month, year) {
  if (isFirebaseConfigured && db) {
    const ref = collection(db, 'users', uid, 'budgets');
    const q = query(ref, where('month', '==', month), where('year', '==', year));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  const all = loadLocal(DEMO_STORAGE_KEY_BUDGETS, getInitialDemoBudgets());
  return all.filter((b) => b.month === month && b.year === year);
}

export async function deleteBudget(uid, budgetId) {
  if (isFirebaseConfigured && db) {
    await deleteDoc(doc(db, 'users', uid, 'budgets', budgetId));
    return;
  }
  const all = loadLocal(DEMO_STORAGE_KEY_BUDGETS, getInitialDemoBudgets());
  saveLocal(DEMO_STORAGE_KEY_BUDGETS, all.filter((b) => b.id !== budgetId));
}
