// Shared Firestore REST helpers for SMS Webhook & App-Open Budget Guard

export const FIREBASE_PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || 'moneymap-5c848';
export const FIREBASE_API_KEY =
  process.env.VITE_FIREBASE_API_KEY || 'AIzaSyC33XfyhiwYLeSEE5ERPhmBhtTxm_scSkg';

export const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

export const CATEGORY_LABELS = {
  'food-delivery': 'Food Delivery',
  groceries: 'Groceries',
  'drinks-beverages': 'Drinks & Beverages',
  transport: 'Transport',
  entertainment: 'Entertainment',
  'health-wellness': 'Health & Wellness',
  shopping: 'Shopping',
  subscriptions: 'Subscriptions',
  housing: 'Housing',
  education: 'Education',
  'gifts-social': 'Gifts & Social',
  'savings-investment': 'Savings',
  other: 'Other',
};

function readFirestoreNumber(field) {
  if (!field) return 0;
  if (field.doubleValue !== undefined) return Number(field.doubleValue) || 0;
  if (field.integerValue !== undefined) return Number(field.integerValue) || 0;
  return 0;
}

function readFirestoreValue(field) {
  if (!field) return null;
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.timestampValue !== undefined) return field.timestampValue;
  return readFirestoreNumber(field);
}

/**
 * Resolve a personal mm_* webhook token into a Firebase uid.
 */
export async function resolveTokenUid(token) {
  if (!token || typeof token !== 'string' || !token.startsWith('mm_')) {
    return { status: 401, error: 'Missing or invalid webhook token.' };
  }

  const tokenRes = await fetch(
    `${FIRESTORE_BASE}/webhookTokens/${encodeURIComponent(token)}?key=${FIREBASE_API_KEY}`
  );

  if (!tokenRes.ok) {
    const tokenErr = await tokenRes.json().catch(() => null);
    if (tokenRes.status === 403) {
      return {
        status: 403,
        error:
          tokenErr?.error?.message ||
          'Firestore permission denied or Cloud Firestore API is not enabled.',
      };
    }
    return { status: 401, error: 'Webhook token not found or revoked.' };
  }

  const tokenDoc = await tokenRes.json();
  const uid = tokenDoc?.fields?.uid?.stringValue;
  if (!uid) {
    return { status: 401, error: 'Invalid webhook token mapping.' };
  }

  return { status: 200, uid };
}

/**
 * Read the user's preferred currency symbol from Firestore (defaults to ₹).
 */
export async function getUserCurrency(uid) {
  try {
    const res = await fetch(
      `${FIRESTORE_BASE}/users/${encodeURIComponent(uid)}?key=${FIREBASE_API_KEY}`
    );
    if (!res.ok) return '₹';
    const docData = await res.json();
    return docData?.fields?.currency?.stringValue || '₹';
  } catch {
    return '₹';
  }
}

function formatAmt(val, currency = '₹') {
  return `${currency}${Math.round(Number(val) || 0).toLocaleString('en-IN')}`;
}

/**
 * Evaluate a category's monthly spending against the user's configured budget.
 * Fetches expenses without composite indexes so it works on any Firestore setup.
 */
export async function evaluateCategoryBudget(uid, category, month, year, currency = '₹') {
  const label = CATEGORY_LABELS[category] || category;
  const budgetId = `${category}_${month}_${year}`;

  const budgetRes = await fetch(
    `${FIRESTORE_BASE}/users/${encodeURIComponent(uid)}/budgets/${encodeURIComponent(budgetId)}?key=${FIREBASE_API_KEY}`
  );

  if (budgetRes.status === 404) {
    return {
      category,
      label,
      hasBudget: false,
      spent: 0,
      limit: 0,
      remaining: 0,
      overBy: 0,
      percentage: 0,
      status: 'none',
      overLimit: false,
      shouldAlert: false,
      title: '',
      message: '',
    };
  }

  if (!budgetRes.ok) {
    throw new Error('Failed to fetch category budget from Firestore.');
  }

  const budgetDoc = await budgetRes.json();
  const fields = budgetDoc?.fields || {};
  const limit = readFirestoreNumber(fields.limit);
  const alertAt = readFirestoreNumber(fields.alertAt) || 80;

  if (limit <= 0) {
    return {
      category,
      label,
      hasBudget: false,
      spent: 0,
      limit: 0,
      remaining: 0,
      overBy: 0,
      percentage: 0,
      status: 'none',
      overLimit: false,
      shouldAlert: false,
      title: '',
      message: '',
    };
  }

  // Sum category expenses for the target month/year (paginate if needed)
  let spent = 0;
  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const expRes = await fetch(
      `${FIRESTORE_BASE}/users/${encodeURIComponent(uid)}/expenses?pageSize=300${tokenParam}&key=${FIREBASE_API_KEY}`
    );
    if (!expRes.ok) break;
    const expData = await expRes.json();
    const docs = expData?.documents || [];

    for (const d of docs) {
      const f = d.fields || {};
      if (readFirestoreValue(f.type) === 'income') continue;
      const expCat = readFirestoreValue(f.category);
      if (expCat !== category) continue;

      const rawDate = readFirestoreValue(f.date);
      const parsedDate = rawDate ? new Date(rawDate) : null;
      if (!parsedDate || isNaN(parsedDate.getTime())) continue;

      if (parsedDate.getMonth() + 1 === Number(month) && parsedDate.getFullYear() === Number(year)) {
        spent += readFirestoreNumber(f.amount);
      }
    }

    if (!expData?.nextPageToken) break;
    pageToken = expData.nextPageToken;
  }

  spent = Math.round(spent * 100) / 100;
  const percentage = Math.round((spent / limit) * 100);
  const remaining = Math.max(0, Math.round((limit - spent) * 100) / 100);
  const overBy = Math.max(0, Math.round((spent - limit) * 100) / 100);

  let status = 'ok';
  let title = `✅ ${label} On Track`;
  let message = `${label}: ${formatAmt(spent, currency)} / ${formatAmt(limit, currency)} (${formatAmt(remaining, currency)} left this month).`;

  if (spent > limit) {
    status = 'over';
    title = `🚨 ${label} Budget Exceeded!`;
    message = `${label} is ${formatAmt(overBy, currency)} OVER your ${formatAmt(limit, currency)} budget (${percentage}% used). Pause before ordering!`;
  } else if (spent === limit || percentage >= 100) {
    status = 'reached';
    title = `⚠️ ${label} Budget Limit Reached`;
    message = `You've used 100% of your ${label} budget (${formatAmt(spent, currency)} / ${formatAmt(limit, currency)}). ${currency}0 left this month.`;
  } else if (percentage >= alertAt) {
    status = 'near';
    title = `⚠️ ${label} Budget at ${percentage}%`;
    message = `Heads up: ${formatAmt(spent, currency)} spent of ${formatAmt(limit, currency)} on ${label}. Only ${formatAmt(remaining, currency)} left!`;
  }

  const shouldAlert = percentage >= alertAt || spent >= limit;

  return {
    category,
    label,
    hasBudget: true,
    spent,
    limit,
    alertAt,
    remaining,
    overBy,
    percentage,
    status,
    overLimit: spent >= limit,
    shouldAlert,
    title,
    message,
  };
}
