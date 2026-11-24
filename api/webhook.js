// Vercel Serverless Function: Real-Time Phone SMS / UPI Webhook
// Receives bank debit SMS or UPI notification text from iOS Shortcuts / Android MacroDroid,
// validates the user's personal webhook token, parses the expense, and saves it to Cloud Firestore.

const FIREBASE_PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || 'moneymap-5c848';
const FIREBASE_API_KEY =
  process.env.VITE_FIREBASE_API_KEY || 'AIzaSyC33XfyhiwYLeSEE5ERPhmBhtTxm_scSkg';

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

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
    'bookmyshow', 'pvr', 'inox', 'cinepolis', 'movie', 'hotstar', 'disney', 'gaming', 'steam',
  ],
  subscriptions: [
    'netflix', 'spotify', 'prime', 'youtube premium', 'apple', 'google one', 'gym',
    'cult.fit', 'cultfit', 'subscription', 'membership',
  ],
  'health-wellness': [
    'apollo', 'pharmeasy', '1mg', 'tata 1mg', 'netmeds', 'medplus', 'pharmacy', 'chemist',
    'hospital', 'clinic', 'doctor', 'diagnostic', 'lenskart',
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

function parseSmsExpense(rawText) {
  const text = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  // Ignore pure credit / salary / OTP messages
  if (/\b(?:otp|one time password|verification code)\b/i.test(text)) {
    return { ignored: true, reason: 'OTP message ignored' };
  }
  if (/\b(?:credited to|has been credited|received rs|deposited)\b/i.test(text) && !/\bdebited\b/i.test(text)) {
    return { ignored: true, reason: 'Credit message ignored' };
  }

  // Extract amount
  let amount = null;
  const amountPatterns = [
    /(?:rs\.?|inr|₹)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /(?:debited(?:\s+by|\s+with)?|spent|paid|sent)\s*(?:rs\.?|inr|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
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

  // Extract merchant
  let title = 'Bank Debit Expense';
  const merchantPatterns = [
    /\bfv\.?\s*([A-Za-z0-9&.\- ]{2,30}?)(?:,|\s+bal|\s+on|$)/i,
    /(?:transfer\s+to|transferred\s+to|paid\s+to|sent\s+to|to|at)\s+([A-Za-z0-9&.\- ]{2,30}?)(?:\s+on|\s+via|\s+ref|\s+using|\.|$)/i,
    /info:\s*(?:upi\/)?([A-Za-z0-9&.\- ]{2,25}?)(?:\/|\.|$)/i,
    /(?:vpa|upi)\s*[:/]\s*([A-Za-z0-9&.\- ]{2,25}?)(?:\/|\.|$)/i,
  ];
  for (const regex of merchantPatterns) {
    const m = text.match(regex);
    if (m && m[1]) {
      const candidate = m[1].trim();
      if (
        !/^\d+$/.test(candidate) &&
        !['a/c', 'account', 'card', 'upi', 'your', 'my', 'the'].includes(candidate.toLowerCase())
      ) {
        title = capitalizeWords(candidate);
        break;
      }
    }
  }

  // Category detection
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

  // Payment method
  let paymentMethod = 'upi';
  if (lower.includes('card') || lower.includes('pos') || lower.includes('ending')) paymentMethod = 'card';
  else if (lower.includes('neft') || lower.includes('imps') || lower.includes('rtgs')) paymentMethod = 'netbanking';

  return {
    ignored: false,
    amount,
    title,
    category,
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
  if (!token || typeof token !== 'string' || !token.startsWith('mm_')) {
    return res.status(401).json({ error: 'Missing or invalid webhook token.' });
  }

  // Extract SMS/notification text from JSON body or plain string body
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
    // 1. Resolve token -> uid from Firestore
    const tokenRes = await fetch(
      `${FIRESTORE_BASE}/webhookTokens/${encodeURIComponent(token)}?key=${FIREBASE_API_KEY}`
    );
    if (!tokenRes.ok) {
      const tokenErr = await tokenRes.json().catch(() => null);
      if (tokenRes.status === 403) {
        return res.status(403).json({
          error:
            tokenErr?.error?.message ||
            'Firestore permission denied or Cloud Firestore API is not enabled.',
        });
      }
      return res.status(401).json({ error: 'Webhook token not found or revoked.' });
    }
    const tokenDoc = await tokenRes.json();
    const uid = tokenDoc?.fields?.uid?.stringValue;
    if (!uid) {
      return res.status(401).json({ error: 'Invalid webhook token mapping.' });
    }

    // 2. Parse the SMS/UPI text
    const parsed = parseSmsExpense(smsText);
    if (!parsed) {
      return res.status(422).json({ error: 'Could not extract a valid debit amount from text.' });
    }
    if (parsed.ignored) {
      return res.status(200).json({ success: true, ignored: true, reason: parsed.reason });
    }

    // 3. Write expense directly into users/{uid}/expenses via Firestore REST API
    const nowIso = new Date().toISOString();
    const firestorePayload = {
      fields: {
        title: { stringValue: parsed.title },
        amount: { doubleValue: Number(parsed.amount) },
        category: { stringValue: parsed.category },
        date: { timestampValue: parsed.dateIso },
        paymentMethod: { stringValue: parsed.paymentMethod },
        note: { stringValue: '📱 Auto-logged via Phone SMS Webhook' },
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
      return res.status(500).json({ error: 'Failed to save expense to Firestore.', details: errBody });
    }

    return res.status(200).json({
      success: true,
      expense: {
        title: parsed.title,
        amount: parsed.amount,
        category: parsed.category,
        paymentMethod: parsed.paymentMethod,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
