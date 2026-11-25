// Vercel Serverless Function: Real-Time Phone SMS / UPI Webhook
// Receives bank SMS or UPI notification text from the MoneyMap Android app or iOS Shortcuts,
// classifies income (credits) vs expense (debits), extracts merchant/sender & category,
// saves it to Cloud Firestore, and triggers budgetAlert for expenses when over threshold.

import {
  FIREBASE_API_KEY,
  FIRESTORE_BASE,
  evaluateCategoryBudget,
  getUserCurrency,
  resolveTokenUid,
} from './_budgetHelper.js';

const CATEGORY_KEYWORDS = {
  'food-delivery': [
    'zomato', 'swiggy', 'mcdonald', 'domino', 'pizza', 'biryani', 'kfc', 'burger king',
    'haldiram', 'subway', 'eatclub', 'box8', 'behrouz', 'faasos', 'restaurant', 'cafe',
    'bistro', 'diner', 'dhaba', 'food', 'lunch', 'dinner', 'breakfast', 'snack',
  ],
  groceries: [
    'blinkit', 'zepto', 'instamart', 'bigbasket', 'bb daily', 'dmart', 'd-mart', 'supermarket',
    'grocery', 'kirana', 'nature basket', 'reliance fresh', 'more retail', 'spencer',
  ],
  'drinks-beverages': [
    'starbucks', 'chai point', 'chaayos', 'barista', 'cafe coffee day', 'third wave',
    'blue tokai', 'coffee', 'tea', 'chai', 'beer', 'wine', 'liquor', 'pub', 'brewery',
  ],
  transport: [
    'uber', 'ola', 'rapido', 'namma yatri', 'metro', 'irctc', 'railway', 'train', 'flight',
    'indigo', 'air india', 'petrol', 'diesel', 'fuel', 'hpcl', 'bpcl', 'iocl', 'shell',
    'fastag', 'toll', 'parking', 'cab', 'auto',
  ],
  shopping: [
    'amazon', 'flipkart', 'myntra', 'ajio', 'nykaa', 'zara', 'h&m', 'meesho', 'tata cliq',
    'croma', 'reliance digital', 'ikea', 'decathlon', 'uniqlo',
  ],
  entertainment: [
    'bookmyshow', 'pvr', 'inox', 'cinepolis', 'movie', 'netflix', 'spotify', 'prime video',
    'hotstar', 'disney', 'youtube', 'gaming', 'steam', 'playstation',
  ],
  subscriptions: [
    'netflix', 'spotify', 'prime', 'youtube premium', 'apple', 'google one', 'gym',
    'cult.fit', 'cultfit', 'subscription', 'membership', 'cloud',
  ],
  'health-wellness': [
    'apollo', 'pharmeasy', '1mg', 'netmeds', 'medplus', 'pharmacy', 'chemist',
    'hospital', 'clinic', 'doctor', 'diagnostic', 'lenskart', 'dentist',
  ],
  housing: [
    'rent', 'maintenance', 'electricity', 'bescom', 'tata power', 'adani power', 'water bill',
    'piped gas', 'indane', 'hp gas', 'bharat gas', 'wifi', 'broadband', 'act fibernet',
  ],
  education: ['coursera', 'udemy', 'unacademy', 'byju', 'school', 'college', 'tuition', 'books'],
};

function capitalizeWords(str) {
  return str
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

const NOISE_REASON_PATTERNS = [
  { re: /\b(?:otp|one\s*time\s*password|verification\s*code|mpin|cvv)\b/i, reason: 'OTP / security message ignored' },
  { re: /\b(?:requested\s+(?:rs|inr|₹|money)|payment\s+request|has\s+requested|collect\s+request|approve\s+to\s+pay|mandate\s+(?:created|approved)|autopay\s+(?:created|registered)|bill\s+due|minimum\s+due|pre-?approved\s+loan)\b/i, reason: 'Payment request / reminder ignored' },
  { re: /\b(?:failed|declined|unsuccessful|could\s+not\s+be\s+processed|cancelled|canceled|reversed\s+failure)\b/i, reason: 'Failed or declined transaction ignored' },
];

const STRONG_DEBIT_RE =
  /\b(?:debited|withdrawn|spent|deducted|purchase\s+(?:of|at|on)|dr\.?\s+(?:rs|inr|₹)|you\s+(?:paid|sent|transferred)|(?:paid|sent|transferred)\s+(?:rs\.?|inr|₹)?\s*[0-9,.]+\s+to\s+(?!you\b|your\b)|amt\s+sent)\b/i;

const STRONG_INCOME_RE =
  /\b(?:(?:paid|sent|transferred)\s+(?:(?:rs\.?|inr|₹)\s*[0-9,.]+\s+)?to\s+you\b|(?:paid|sent)\s+you\b|you\s+received\b|received\s+(?:rs\.?|inr|₹|money|payment|from)\b|money\s+received\b|payment\s+received\b|credited\s+(?:to\s+(?:your|a\/c|acct|x+\d+)|with|by|in|for|rs\.?|inr|₹)|(?:has\s+been|is)\s+credited\b|deposited\s+(?:in|to|into)\b|\bcr\.?\s+(?:to|by)\b|\b(?:salary|cashback|refund|dividend|reimbursement)\b)/i;

const GENERIC_TXN_VERB_RE =
  /\b(?:debited|credited|paid|sent|received|spent|withdrawn|deposited|transferred|deducted|purchase|refund|cashback|salary)\b/i;

function classifyTransaction(text) {
  for (const item of NOISE_REASON_PATTERNS) {
    if (item.re.test(text)) {
      return { action: 'ignore', reason: item.reason };
    }
  }

  // Standalone balance alerts without any actual debit/credit verb
  if (
    /\b(?:avl\.?\s*bal|available\s+balance|clear\s+bal|current\s+balance)\b/i.test(text) &&
    !GENERIC_TXN_VERB_RE.test(text)
  ) {
    return { action: 'ignore', reason: 'Balance summary without transaction ignored' };
  }

  const hasIncomeSignal = STRONG_INCOME_RE.test(text);
  const hasDebitSignal = STRONG_DEBIT_RE.test(text);

  // If explicit credit signal is present without "your account debited", it's income.
  if (hasIncomeSignal && !/\b(?:your\s+(?:a\/c|acct|account|card)\s+.*debited|debited\s+(?:from|by)\s+(?:your|a\/c|acct|[0-9,.]+))\b/i.test(text)) {
    return { action: 'income' };
  }

  if (hasDebitSignal || /\b(?:debited|spent|paid|sent)\b/i.test(text)) {
    return { action: 'expense' };
  }

  return { action: 'ignore', reason: 'Non-transaction message ignored' };
}

function cleanPartyCandidate(raw) {
  if (!raw) return '';
  return raw
    .replace(/\b(?:via|using|through|from|to|on|at)\b.*$/i, '')
    .replace(/^(?:mr|mrs|ms|miss|shri)\.?\s+/i, '')
    .replace(/[^\w\s&.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isInvalidPartyName(candidate) {
  const lower = (candidate || '').toLowerCase();
  return (
    !candidate ||
    candidate.length < 2 ||
    /^\d+$/.test(candidate) ||
    ['a/c', 'acct', 'account', 'card', 'upi', 'your', 'you', 'my', 'the', 'bank', 'user', 'customer', 'dear', 'rs', 'inr', 'rupees'].includes(lower)
  );
}

function extractIncomeDetails(text) {
  const lower = text.toLowerCase();
  let title = '';

  const senderPatterns = [
    // "Rahul Sharma paid ₹100 to you", "Rahul paid you ₹100", "Rahul sent ₹100 to you"
    /(?:^|[:-]\s*)([A-Za-z][A-Za-z0-9&.\- ]{1,30}?)\s+(?:paid|sent|transferred)\s+(?:(?:rs\.?|inr|₹)\s*[0-9,.]+\s+)?(?:to\s+you|you)\b/i,
    // "Received ₹100 from Rahul", "transfer from RAHUL"
    /\b(?:received(?:\s+(?:rs\.?|inr|₹)\s*[0-9,.]+)?\s+from|transfer\s+from|transferred\s+from)\s+([A-Za-z][A-Za-z0-9&.\- ]{1,30}?)(?:\s+on|\s+via|\s+ref|\s+using|\s+to\s+your|\s+into|\.|$)/i,
    // "credited by RAHUL", "deposited by RAHUL", "from RAHUL"
    /\b(?:credited\s+(?:by|from)|deposited\s+by|from)\s+(?!(?:rs\.?|inr)\b)([A-Za-z][A-Za-z0-9&.\- ]{1,30}?)(?:\s+on|\s+via|\s+ref|\s+using|\s+to\s+your|\s+into|\.|$)/i,
    /\binfo:\s*(?:upi\/)?([A-Za-z0-9&.\- ]{2,25}?)(?:\/|\.|$)/i,
    /\bvpa\s*[:/]\s*([A-Za-z0-9&.\- ]{2,25}?)(?:\/|\.|$)/i,
  ];

  for (const regex of senderPatterns) {
    const m = text.match(regex);
    if (m && m[1]) {
      const candidate = cleanPartyCandidate(m[1]);
      if (!isInvalidPartyName(candidate)) {
        title = `From ${capitalizeWords(candidate)}`;
        break;
      }
    }
  }

  let category = 'upi-received';
  if (/\b(?:salary|payroll|stipend|wages)\b/i.test(lower)) {
    category = 'salary';
    if (!title) title = 'Monthly Salary';
  } else if (/\b(?:refund|cashback|reward|reversal)\b/i.test(lower)) {
    category = 'refund-cashback';
    if (!title) title = /\bcashback\b/i.test(lower) ? 'Cashback Received' : 'Refund Received';
  } else if (/\b(?:interest|dividend|mutual\s*fund)\b/i.test(lower)) {
    category = 'investment-returns';
    if (!title) title = 'Interest / Returns';
  } else if (!title) {
    title = lower.includes('upi') || lower.includes('gpay') || lower.includes('phonepe') || lower.includes('paytm')
      ? 'UPI Money Received'
      : 'Bank Credit';
  }

  return { title, category };
}

function extractExpenseDetails(text) {
  let title = 'Bank Debit Expense';
  const merchantPatterns = [
    /\bfv\.?\s*([A-Za-z0-9&.\- ]{2,30}?)(?:,|\s+bal|\s+on|$)/i,
    /\b(?:transfer\s+to|transferred\s+to|trf\s+to|paid\s+to|sent\s+to|to|at)\s+(?!you\b|your\b)([A-Za-z0-9&.\- ]{2,30}?)(?:\s+on|\s+via|\s+ref|\s+using|\.|$)/i,
    /\binfo:\s*(?:upi\/)?([A-Za-z0-9&.\- ]{2,25}?)(?:\/|\.|$)/i,
    /\b(?:vpa|upi)\s*[:/]\s*([A-Za-z0-9&.\- ]{2,25}?)(?:\/|\.|$)/i,
  ];

  for (const regex of merchantPatterns) {
    const m = text.match(regex);
    if (m && m[1]) {
      const candidate = cleanPartyCandidate(m[1]);
      if (!isInvalidPartyName(candidate)) {
        title = capitalizeWords(candidate);
        break;
      }
    }
  }

  const lower = `${text} ${title}`.toLowerCase();
  let category = 'other';
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      if (title === 'Bank Debit Expense') {
        const matchedKw = keywords.find((kw) => lower.includes(kw));
        if (matchedKw) title = capitalizeWords(matchedKw);
      }
      category = cat;
      break;
    }
  }

  return { title, category };
}

export function parseTransactionSms(rawText) {
  const text = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const classification = classifyTransaction(text);
  if (classification.action === 'ignore') {
    return { ignored: true, reason: classification.reason };
  }

  // Extract amount
  let amount = null;
  const amountPatterns = [
    /(?:rs\.?|inr|₹)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /(?:debited(?:\s+by|\s+with)?|credited(?:\s+by|\s+with)?|received|deposited|spent|paid|sent)\s*(?:rs\.?|inr|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:rs|rupees|inr)/i,
  ];
  for (const regex of amountPatterns) {
    const m = text.match(regex);
    if (m && m[1]) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(val) && val > 0) {
        amount = val;
        break;
      }
    }
  }
  if (!amount) return null;

  const isIncome = classification.action === 'income';
  const details = isIncome ? extractIncomeDetails(text) : extractExpenseDetails(text);

  const lower = text.toLowerCase();
  let paymentMethod = 'upi';
  if (lower.includes('card') || lower.includes('pos') || lower.includes('ending')) paymentMethod = 'card';
  else if (lower.includes('neft') || lower.includes('imps') || lower.includes('rtgs')) paymentMethod = 'netbanking';

  return {
    ignored: false,
    type: isIncome ? 'income' : 'expense',
    amount,
    title: details.title,
    category: details.category,
    paymentMethod,
    dateIso: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const token = req.query?.token || req.headers['x-webhook-token'];
  const tokenCheck = await resolveTokenUid(token);
  if (tokenCheck.error) {
    return res.status(tokenCheck.status).json({ error: tokenCheck.error });
  }
  const uid = tokenCheck.uid;

  let smsText = '';
  if (typeof req.body === 'string') {
    smsText = req.body;
  } else if (req.body && typeof req.body === 'object') {
    smsText = req.body.text || req.body.message || req.body.sms || req.body.body || '';
  }

  if (!smsText.trim()) {
    return res.status(400).json({ error: 'Empty SMS/notification text.' });
  }

  try {
    const parsed = parseTransactionSms(smsText);
    if (!parsed) {
      return res.status(422).json({ error: 'Could not extract a valid transaction amount from text.' });
    }
    if (parsed.ignored) {
      return res.status(200).json({ success: true, ignored: true, reason: parsed.reason });
    }

    const nowIso = new Date().toISOString();
    const noteText = parsed.type === 'income'
      ? '💰 Auto-logged Income via Phone SMS / UPI'
      : '📱 Auto-logged Expense via Phone SMS / UPI';

    const firestorePayload = {
      fields: {
        type: { stringValue: parsed.type },
        title: { stringValue: parsed.title },
        amount: { doubleValue: Number(parsed.amount) },
        category: { stringValue: parsed.category },
        date: { timestampValue: parsed.dateIso },
        paymentMethod: { stringValue: parsed.paymentMethod },
        note: { stringValue: noteText },
        isRecurring: { booleanValue: false },
        source: { stringValue: 'webhook' },
        createdAt: { timestampValue: nowIso },
        updatedAt: { timestampValue: nowIso },
      },
    };

    const writeRes = await fetch(
      `${FIRESTORE_BASE}/users/${encodeURIComponent(uid)}/expenses?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(firestorePayload),
      }
    );

    if (!writeRes.ok) {
      const errBody = await writeRes.text();
      return res.status(500).json({ error: 'Failed to save transaction to Firestore.', details: errBody });
    }

    // Only check category spending budgets for expenses (never for incoming credits)
    let budget = null;
    if (parsed.type === 'expense') {
      try {
        const now = new Date();
        const currency = await getUserCurrency(uid);
        budget = await evaluateCategoryBudget(
          uid,
          parsed.category,
          now.getMonth() + 1,
          now.getFullYear(),
          currency
        );
      } catch {
        budget = null;
      }
    }

    return res.status(200).json({
      success: true,
      expense: {
        type: parsed.type,
        title: parsed.title,
        amount: parsed.amount,
        category: parsed.category,
        paymentMethod: parsed.paymentMethod,
      },
      budget,
      budgetAlert: budget?.shouldAlert ? budget.message : null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
