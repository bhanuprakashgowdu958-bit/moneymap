// Vercel Serverless Function: Real-Time Phone SMS / UPI Webhook
// Receives bank SMS or UPI notification text from the MoneyMap Android app or iOS Shortcuts,
// classifies income (credits) vs expense (debits), extracts counterparty name, account hint & category,
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
    'cult.fit', 'cultfit', 'jio', 'airtel', 'vodafone', 'vi prepaid', 'vi postpaid',
    'vi recharge', 'bsnl', 'tata play', 'tatasky', 'dish tv', 'sun direct', 'd2h',
    'dth', 'recharge', 'recharged', 'prepaid', 'postpaid', 'subscription', 'membership', 'cloud',
  ],
  'health-wellness': [
    'apollo', 'pharmeasy', '1mg', 'netmeds', 'medplus', 'pharmacy', 'chemist',
    'hospital', 'clinic', 'doctor', 'diagnostic', 'lenskart', 'dentist',
  ],
  housing: [
    'bescom', 'tata power', 'adani power', 'tsspdcl', 'apspdcl', 'msedcl', 'mseb', 'bses',
    'tneb', 'kseb', 'uppcl', 'cesc', 'nbpdcl', 'sbpdcl', 'dgvcl', 'mgvcl', 'ugvcl', 'pgvcl',
    'torrent power', 'electricity', 'power bill', 'powerbill', 'eb bill', 'light bill',
    'water bill', 'piped gas', 'indane', 'hp gas', 'bharat gas', 'wifi', 'broadband',
    'act fibernet', 'bbps', 'bharat billpay', 'billdesk', 'rent', 'maintenance',
  ],
  education: ['coursera', 'udemy', 'unacademy', 'byju', 'school', 'college', 'tuition', 'books'],
};

const INVALID_PARTY_EXACT = new Set([
  'a/c', 'acct', 'account', 'card', 'upi', 'vpa', 'your', 'you', 'yours', 'yourself',
  'my', 'me', 'myself', 'self', 'the', 'bank', 'user', 'customer', 'dear', 'rs', 'inr',
  'rupees', 'money', 'payment', 'amount', 'google pay', 'gpay', 'phonepe', 'paytm',
  'bhim', 'amazon pay', 'cred', 'whatsapp pay', 'messages', 'sms', 'alert', 'info',
  'ref', 'reference', 'na', 'null', 'unknown', 'received', 'credited', 'debited',
  'paid', 'sent', 'transferred', 'transaction', 'successful', 'money received',
  'payment received', 'payment successful',
]);

const LEADING_NOTIFICATION_NOISE_RE =
  /^(?:google\s+pay|gpay|phonepe|paytm|bhim|amazon\s+pay|cred|whatsapp\s+pay|money\s+received|payment\s+received|received\s+money|payment\s+successful|upi\s+alert|transaction\s+alert|alert|update|dear\s+(?:sbi\s+)?(?:customer|user))\b[\s:!\-,]*/i;

const HARD_NOISE_REASON_PATTERNS = [
  { re: /\b(?:is\s+your\s+otp|otp\s+(?:is|for)|use\s+otp|enter\s+otp|one\s*time\s*password|verification\s*code)\b/i, reason: 'OTP / security message ignored' },
  { re: /\b(?:requested\s+(?:rs|inr|₹|money)|payment\s+request|has\s+requested|collect\s+request|approve\s+to\s+pay|mandate\s+(?:created|approved)|autopay\s+(?:created|registered)|bill\s+due|minimum\s+due|pre-?approved\s+loan)\b/i, reason: 'Payment request / reminder ignored' },
  { re: /\b(?:transaction\s+failed|payment\s+failed|failed|declined|unsuccessful|could\s+not\s+be\s+processed|cancelled|canceled|reversed\s+failure|will\s+be\s+credited|to\s+be\s+credited)\b/i, reason: 'Failed or declined transaction ignored' },
];

const PROMO_NOISE_PATTERNS = [
  { re: /\b(?:otp|mpin|cvv)\b/i, reason: 'OTP / security message ignored' },
  {
    re: /\b(?:get|win|earn|avail|enjoy|unlock|grab|claim(?:\s+your|\s+now)?|chance\s+to\s+win|assured\s+(?:cashback|reward)|up\s*to\s+(?:rs\.?|inr|₹)|upto\s+(?:rs\.?|inr|₹)|flat\s+(?:rs\.?|inr|₹)?\s*[0-9,.]+\s*(?:off|cashback|discount)|scratch\s+card|voucher|coupon|promo(?:\s*code)?|use\s+code|apply\s+code|valid\s+(?:till|until)|limited\s+period|t&c\s+apply|terms\s+apply|congratulations|you(?:'ve|\s+have)\s+won|lucky\s+draw|pre-?approved|loan\s+offer|credit\s+limit|upgrade\s+your\s+card|apply\s+now|shop\s+(?:for|worth)|min(?:imum)?\s+(?:spend|order)|cashback\s+offer|special\s+offer)\b/i,
    reason: 'Promotional / offer message ignored',
  },
];

const CONFIRMED_TXN_RE =
  /\b(?:(?:debited|credited|deposited|withdrawn|deducted|charged|spent)\b[\s\S]*(?:\b(?:a\/c|ac\.?|acct|account|card|upi|vpa|mob\s*bk|neft|imps|rtgs|trf|ref|rs\.?|inr)\b|₹)|(?:paid|sent|transferred)\s+(?:rs\.?|inr|₹)?\s*[0-9,]+(?:\.[0-9]{1,2})?\s+(?:to|via)\b|received\s+(?:rs\.?|inr|₹)?\s*[0-9,]+(?:\.[0-9]{1,2})?\s+from)\b/i;

const STRONG_DEBIT_RE =
  /\b(?:debited|debit\s+(?:of|from|in|for)|withdrawn|spent|deducted|charged|recharged?|bill\s+(?:paid|payment)|payment\s+of\s+(?:rs\.?|inr|₹)?\s*[0-9,.]+\s+(?:to|for|successful|completed)|purchase\s+(?:of|at|on)|dr\.?\s*(?:from|by|to|for|in|of|at|rs|inr|₹)|[0-9,.]+\s*dr\.?\b|you\s+(?:have\s+)?(?:paid|sent|transferred)|(?:transfer|txn)\s+(?:of|to|from)\s+(?:rs\.?|inr|₹)?\s*[0-9,.]+|(?:paid|sent|transferred|trf)\s+(?:rs\.?|inr|₹)?\s*[0-9,.]*(?:\s+(?:to|via)\s+(?!you\b|your\b))?|amt\s+sent)\b/i;

const STRONG_INCOME_RE =
  /\b(?:(?:paid|sent|transferred)\s+(?:(?:rs\.?|inr|₹)\s*[0-9,.]+\s+)?to\s+you\b|(?:paid|sent)\s+you\b|you\s+(?:have\s+)?received\b|received\s+(?:rs\.?|inr|₹|money|payment|from)\b|(?:payment|amount)\s+(?:of\s+(?:rs\.?|inr|₹)\s*[0-9,.]+\s+)?received\b|money\s+received\b|credited\s+(?:to|in|into|with|by|for|rs\.?|inr|₹)|(?:has\s+been|is)\s+credited\b|credit\s+(?:of|to|in)\b|deposited\s+(?:in|to|into)\b|\bcr\.?\s*(?:to|by|in)\b|(?:cashback|refund|salary|dividend|reimbursement)\s+(?:of\s+)?(?:(?:rs\.?|inr|₹)\s*[0-9,.]+\s+)?(?:credited|received|deposited|processed|issued)|(?:credited|received|deposited)\s+(?:rs\.?|inr|₹)?\s*[0-9,.]*\s*(?:as\s+)?(?:cashback|refund|salary|dividend|reimbursement))\b/i;

const GENERIC_TXN_VERB_RE =
  /\b(?:debited|credited|paid|sent|received|spent|withdrawn|deposited|transferred|trf|deducted|charged|recharged?|bill\s+payment|purchase|refund|cashback|salary)\b/i;

function collapseRepeatedPhrase(words) {
  if (words.length >= 2 && words.length % 2 === 0) {
    const half = words.length / 2;
    const first = words.slice(0, half).join(' ');
    const second = words.slice(half).join(' ');
    if (first.toLowerCase() === second.toLowerCase()) {
      return first;
    }
  }
  return words.join(' ');
}

function formatPartyName(str) {
  const words = String(str || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const hasUpper = /[A-Z]/.test(w);
      const hasLower = /[a-z]/.test(w);
      if (hasUpper && hasLower) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    });
  return collapseRepeatedPhrase(words);
}

function stripLeadingNoise(raw) {
  let out = String(raw || '').trim();
  for (let i = 0; i < 3; i++) {
    const next = out.replace(LEADING_NOTIFICATION_NOISE_RE, '').trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

function cleanPartyCandidate(raw) {
  if (!raw) return '';
  let cleaned = stripLeadingNoise(raw)
    .replace(/\b(?:via|using|through|on|in\s+your|in\s+a\/c|into|to\s+your|to\s+a\/c|ref(?:\s+no)?|upi\s+ref|utr|avl\.?\s*bal|bal(?:ance)?)\b.*$/i, '')
    .replace(/\b(?:at|from|to)\s+(?=\d|your\b|a\/c\b|acct\b|account\b|vpa\b|upi\b).*$/i, '')
    .replace(/^(?:mr|mrs|ms|miss|shri|dr)\.?\s+/i, '')
    .replace(/[^\w\s&.'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^['.\-]+|['.\-]+$/g, '')
    .trim();
  return stripLeadingNoise(cleaned);
}

function isInvalidPartyName(candidate) {
  if (!candidate) return true;
  const trimmed = candidate.trim();
  const lower = trimmed.toLowerCase();
  if (trimmed.length < 2) return true;
  if (/^[*xX\d\s\-/.+]+$/.test(trimmed)) return true;
  if (/^(?:x+|\*+)\d{2,}$/i.test(trimmed)) return true;
  if (/^[A-Z]{2}-[A-Z0-9]{3,10}$/i.test(trimmed)) return true;
  if (INVALID_PARTY_EXACT.has(lower)) return true;
  if (/\b(?:debited|credited|received|paid|sent|transferred|deposited|withdrawn|upi\s*ref|available|balance)\b/i.test(trimmed)) return true;
  if (/[₹]/.test(trimmed)) return true;
  return false;
}

function extractNameFromVpa(vpa) {
  if (!vpa) return '';
  const local = String(vpa).split('@')[0] || '';
  if (!local || /^\d+$/.test(local)) return '';
  const spaced = local
    .replace(/[._-]+/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cleaned = cleanPartyCandidate(spaced);
  return isInvalidPartyName(cleaned) ? '' : formatPartyName(cleaned);
}

function matchPartyFromPatterns(text, patterns) {
  for (const entry of patterns) {
    const m = text.match(entry.re);
    if (!m || !m[1]) continue;
    const candidate = entry.isVpa ? extractNameFromVpa(m[1]) : cleanPartyCandidate(m[1]);
    if (!isInvalidPartyName(candidate)) {
      return formatPartyName(candidate);
    }
  }
  return '';
}

const INCOME_SENDER_PATTERNS = [
  // "Rahul Sharma paid ₹100 to you", "Leelu Bro has sent ₹1,000 to you"
  {
    re: /(?:^|[:\-!]\s*)([A-Za-z][A-Za-z0-9&.'\- ]{1,40}?)\s+(?:has\s+)?(?:paid|sent|transferred)\s+(?:(?:rs\.?|inr|₹)\s*[0-9,.]+\s+)?(?:to\s+you|you)\b/i,
  },
  // "from VPA rahul99@okicici (Rahul Sharma)" -> prefer name inside parentheses
  {
    re: /\b(?:from|by)\s+(?:vpa\s+)?[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\s*\(\s*(?!upi\b|ref\b)([A-Za-z][A-Za-z0-9&.'\- ]{1,35}?)\s*\)/i,
  },
  // "Received ₹100 from Rahul Sharma (rahul@okaxis)", "transfer from RAHUL SHARMA"
  {
    re: /\b(?:received(?:\s+(?:of\s+)?(?:rs\.?|inr|₹)\s*[0-9,.]+)?\s+from|transfer\s+from|transferred\s+from)\s+(?!(?:rs\.?|inr|vpa)\b)([A-Za-z][A-Za-z0-9&.'\- ]{1,40}?)(?:\s*\(|\s+on|\s+via|\s+ref|\s+using|\s+through|\s+in\s+your|\s+in\s+a\/c|\s+to\s+your|\s+into|[,.;/]|$)/i,
  },
  // "credited by RAHUL", "deposited by RAHUL", "from RAHUL"
  {
    re: /\b(?:credited\s+(?:by|from)|deposited\s+by|from)\s+(?!(?:rs\.?|inr|vpa|your|a\/c|acct|account)\b)([A-Za-z][A-Za-z0-9&.'\- ]{1,40}?)(?:\s*\(|\s+on|\s+via|\s+ref|\s+using|\s+through|\s+in\s+your|\s+in\s+a\/c|\s+to\s+your|\s+into|[,.;/]|$)/i,
  },
  // ICICI style: "Acct XX123 credited with Rs 100 on ...; RAHUL SHARMA credited."
  {
    re: /;\s*([A-Za-z][A-Za-z0-9&.'\- ]{1,35}?)\s+credited\b/i,
  },
  // Info: UPI/RAHUL SHARMA or Info- UPI/P2A/123456/RAHUL SHARMA
  {
    re: /\binfo\s*[:-]\s*(?:upi\/(?:(?:cr|dr|p2a|p2m)\/)?(?:\d+\/)?)?([A-Za-z][A-Za-z0-9&.'\- ]{1,35}?)(?:[/,.;(]|$)/i,
  },
  // Slash-delimited UPI narration: UPI/CR/123456/RAHUL SHARMA or UPI/123456/RAHUL SHARMA
  {
    re: /\bupi\/(?:(?:cr|dr|p2a|p2m)\/)?\d+\/([A-Za-z][A-Za-z0-9&.'\- ]{1,35}?)(?:[/,.;(]|$)/i,
  },
  // VPA handle fallback: "from VPA rahul.sharma@okicici" or "VPA: rahul@ybl"
  {
    re: /\b(?:from\s+(?:vpa\s+)?|vpa\s*[:/\s]\s*)([A-Za-z0-9._-]+@[A-Za-z0-9.-]+)/i,
    isVpa: true,
  },
  {
    re: /\bvpa\s*[:/]\s*([A-Za-z0-9&.'\- ]{2,25}?)(?:[/,.;(]|$)/i,
  },
];

const EXPENSE_RECIPIENT_PATTERNS = [
  {
    re: /\bfv\.?\s*([A-Za-z0-9&.'\- ]{2,35}?)(?:,|\s+bal|\s+on|\(|$)/i,
  },
  // "to VPA rahul99@okicici (Rahul Sharma)" -> prefer name inside parentheses
  {
    re: /\b(?:to|towards)\s+(?:vpa\s+)?[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\s*\(\s*(?!upi\b|ref\b)([A-Za-z][A-Za-z0-9&.'\- ]{1,35}?)\s*\)/i,
  },
  // "Paid ₹200 to Dhanush Capgemini", "transfer to PALLA GANESH", "towards Swiggy", "bill payment ... for BESCOM"
  {
    re: /\b(?:transfer\s+to|transferred\s+to|trf\s+to|paid\s+to|sent\s+to|towards|to|at)\s+(?!(?:you|your|yours|a\/c|acct|account|self|vpa|rs\.?|inr)\b)([A-Za-z][A-Za-z0-9&.'\- ]{1,40}?)(?:\s*\(|\s+on|\s+via|\s+ref|\s+using|\s+through|[,.;/]|$)/i,
  },
  {
    re: /\b(?:bill\s+(?:paid|payment)|recharged?)\b.*?\bfor\s+(?!(?:rs\.?|inr|your|a\/c|acct|account)\b)([A-Za-z][A-Za-z0-9&.'\- ]{1,35}?)(?:\s*\(|\s+on|\s+via|\s+ref|\s+successful|\s+completed|[,.;/]|$)/i,
  },
  {
    re: /\binfo\s*[:-]\s*(?:upi\/(?:(?:cr|dr|p2a|p2m)\/)?(?:\d+\/)?)?([A-Za-z][A-Za-z0-9&.'\- ]{1,35}?)(?:[/,.;(]|$)/i,
  },
  {
    re: /\bupi\/(?:(?:cr|dr|p2a|p2m)\/)?\d+\/([A-Za-z][A-Za-z0-9&.'\- ]{1,35}?)(?:[/,.;(]|$)/i,
  },
  {
    re: /\b(?:to\s+(?:vpa\s+)?|vpa\s*[:/\s]\s*|upi\s*[:/]\s*)([A-Za-z0-9._-]+@[A-Za-z0-9.-]+)/i,
    isVpa: true,
  },
  {
    re: /\b(?:vpa|upi)\s*[:/]\s*([A-Za-z0-9&.'\- ]{2,25}?)(?:[/,.;(]|$)/i,
  },
];

function extractPartyWithMeta(text, patterns, meta = {}) {
  const body = String(meta.notificationText || '').replace(/\s+/g, ' ').trim();
  const notifTitle = String(meta.notificationTitle || '').replace(/\s+/g, ' ').trim();

  if (body) {
    const fromBody = matchPartyFromPatterns(body, patterns);
    if (fromBody) return fromBody;
  }

  if (notifTitle && !/[0-9₹]/.test(notifTitle)) {
    const cleanedTitle = cleanPartyCandidate(notifTitle);
    if (!isInvalidPartyName(cleanedTitle)) {
      return formatPartyName(cleanedTitle);
    }
  }

  return matchPartyFromPatterns(text, patterns);
}

function classifyTransaction(text) {
  for (const item of HARD_NOISE_REASON_PATTERNS) {
    if (item.re.test(text)) {
      return { action: 'ignore', reason: item.reason };
    }
  }

  const isConfirmedTxn = CONFIRMED_TXN_RE.test(text);
  if (!isConfirmedTxn) {
    for (const item of PROMO_NOISE_PATTERNS) {
      if (item.re.test(text)) {
        return { action: 'ignore', reason: item.reason };
      }
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

  // If explicit credit signal is present without account debit, it's income.
  if (
    hasIncomeSignal &&
    !/\b(?:(?:your\s+)?(?:[A-Za-z]+\s+){0,3}(?:a\/c|ac\.?|acct|account|card)\s*(?:no\.?)?\s*(?:[*xX]+\d+|\d+)?\s*(?:is|has\s+been)?\s*debited|debited\s+(?:(?:from|by|for|with)\s+(?:(?:[A-Za-z]+\s+){0,3}(?:your|a\/c|ac\.?|acct|account|card)|(?:rs\.?|inr|₹)?\s*[0-9,.]+)|(?:rs\.?|inr|₹)\s*[0-9,.]+))\b/i.test(text)
  ) {
    return { action: 'income' };
  }

  if (hasDebitSignal || /\b(?:debited|spent|paid|sent|transferred|trf|charged|withdrawn)\b/i.test(text)) {
    return { action: 'expense' };
  }

  return { action: 'ignore', reason: 'Non-transaction message ignored' };
}

function extractAccountHint(text) {
  const cardMatch = text.match(/\bcard(?:\s+ending)?(?:\s+with)?\s*(?:no\.?|xx+|x+|\*)?\s*(\d{4})\b/i);
  if (cardMatch && cardMatch[1]) {
    return `Card ••${cardMatch[1]}`;
  }
  const acctMatch = text.match(/\b(?:a\/c|acct|account)(?:\s+no\.?)?(?:\s+ending)?\s*(?:xx+|x+|\*+)?(\d{4})\b/i);
  if (acctMatch && acctMatch[1]) {
    return `A/c ••${acctMatch[1]}`;
  }
  return '';
}

function extractIncomeDetails(text, meta = {}) {
  const lower = text.toLowerCase();
  const counterparty = extractPartyWithMeta(text, INCOME_SENDER_PATTERNS, meta);
  let title = counterparty;

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

  return { title, counterparty, category };
}

function extractExpenseDetails(text, meta = {}) {
  const counterparty = extractPartyWithMeta(text, EXPENSE_RECIPIENT_PATTERNS, meta);
  let title = counterparty || 'Bank Debit Expense';

  const lower = `${text} ${title}`.toLowerCase();
  let category = 'other';
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      if (title === 'Bank Debit Expense') {
        const matchedKw = keywords.find((kw) => lower.includes(kw));
        if (matchedKw) title = formatPartyName(matchedKw);
      }
      category = cat;
      break;
    }
  }

  return {
    title,
    counterparty: counterparty || (title !== 'Bank Debit Expense' ? title : ''),
    category,
  };
}

function resolveOccurredAtIso(occurredAt) {
  if (occurredAt !== undefined && occurredAt !== null && occurredAt !== '') {
    const parsed = new Date(typeof occurredAt === 'number' || /^\d+$/.test(String(occurredAt))
      ? Number(occurredAt)
      : String(occurredAt));
    const ms = parsed.getTime();
    const minValidMs = Date.UTC(2020, 0, 1);
    const maxValidMs = Date.now() + 24 * 60 * 60 * 1000;
    if (!Number.isNaN(ms) && ms >= minValidMs && ms <= maxValidMs) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

export function parseTransactionSms(rawText, meta = {}) {
  const text = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const classification = classifyTransaction(text);
  if (classification.action === 'ignore') {
    return { ignored: true, reason: classification.reason };
  }

  // Extract amount
  let amount = null;
  const amountPatterns = [
    /(?:rs\.?|inr|₹)\s*[:\-]?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /\b(?:debited|credited|paid|sent|spent|withdrawn|deducted|charged|transferred|received|deposited|recharged?)(?:\s+(?:by|for|of|with|amount|amt))?\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /\b([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:rs\.?|rupees|inr)\b/i,
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
  const details = isIncome ? extractIncomeDetails(text, meta) : extractExpenseDetails(text, meta);

  const lower = text.toLowerCase();
  let paymentMethod = 'upi';
  if (/\b(?:card|pos|ending)\b/.test(lower)) paymentMethod = 'card';
  else if (/\b(?:neft|imps|rtgs)\b/.test(lower)) paymentMethod = 'netbanking';

  const accountHint = extractAccountHint(text);

  return {
    ignored: false,
    type: isIncome ? 'income' : 'expense',
    amount,
    title: details.title,
    counterparty: details.counterparty || '',
    accountHint,
    category: details.category,
    paymentMethod,
    dateIso: resolveOccurredAtIso(meta.occurredAt),
  };
}

const GENERIC_PARTY_NAMES = new Set([
  '',
  'bank credit',
  'bank debit expense',
  'upi money received',
  'upi transfer',
  'other',
  'expense',
  'income',
  'cashback received',
  'refund received',
]);

function isGenericParty(name) {
  return GENERIC_PARTY_NAMES.has(String(name || '').trim().toLowerCase());
}

/**
 * Checks recent Firestore expenses for an identical transaction logged by another channel
 * (e.g. Bank SMS + PhonePe notification for the same payment) within 3 minutes, merging
 * missing sender name or accountHint instead of creating a duplicate entry.
 */
async function findAndMergeDuplicateTransaction(uid, parsed, nowIso) {
  try {
    let listRes = await fetch(
      `${FIRESTORE_BASE}/users/${encodeURIComponent(uid)}/expenses?pageSize=25&orderBy=${encodeURIComponent('createdAt desc')}&key=${FIREBASE_API_KEY}`
    );
    if (!listRes.ok) {
      listRes = await fetch(
        `${FIRESTORE_BASE}/users/${encodeURIComponent(uid)}/expenses?pageSize=100&key=${FIREBASE_API_KEY}`
      );
    }
    if (!listRes.ok) return { duplicate: false };

    const data = await listRes.json();
    const docs = data?.documents || [];
    const targetMs = new Date(parsed.dateIso).getTime();
    const incomingAmount = Number(parsed.amount);
    const incomingName = String(parsed.counterparty || parsed.title || '').trim().toLowerCase();

    for (const d of docs) {
      const f = d.fields || {};
      const existingType = f.type?.stringValue === 'income' ? 'income' : 'expense';
      if (existingType !== parsed.type) continue;

      const existingAmt = Number(f.amount?.doubleValue ?? f.amount?.integerValue ?? 0);
      if (Math.abs(existingAmt - incomingAmount) >= 0.01) continue;

      const rawExistingDate = f.date?.timestampValue || f.createdAt?.timestampValue;
      const existingMs = rawExistingDate ? new Date(rawExistingDate).getTime() : NaN;
      if (Number.isNaN(existingMs) || Math.abs(targetMs - existingMs) > 180_000) continue;

      const existingTitle = String(f.title?.stringValue || '').trim();
      const existingCounterparty = String(f.counterparty?.stringValue || '').trim();
      const existingName = (existingCounterparty || existingTitle).toLowerCase();

      const bothNamedAndDistinct =
        !isGenericParty(existingName) &&
        !isGenericParty(incomingName) &&
        !existingName.includes(incomingName) &&
        !incomingName.includes(existingName);
      if (bothNamedAndDistinct) continue;

      const patchFields = {};
      const fieldPaths = [];
      if (isGenericParty(existingTitle) && parsed.title && !isGenericParty(parsed.title)) {
        patchFields.title = { stringValue: parsed.title };
        fieldPaths.push('title');
      }
      if (isGenericParty(existingCounterparty) && parsed.counterparty && !isGenericParty(parsed.counterparty)) {
        patchFields.counterparty = { stringValue: parsed.counterparty };
        fieldPaths.push('counterparty');
      }
      const existingAcc = String(f.accountHint?.stringValue || '').trim();
      if (!existingAcc && parsed.accountHint) {
        patchFields.accountHint = { stringValue: parsed.accountHint };
        fieldPaths.push('accountHint');
      }

      if (fieldPaths.length > 0 && d.name) {
        patchFields.updatedAt = { timestampValue: nowIso };
        fieldPaths.push('updatedAt');
        const maskParams = fieldPaths
          .map((p) => `updateMask.fieldPaths=${encodeURIComponent(p)}`)
          .join('&');
        await fetch(
          `https://firestore.googleapis.com/v1/${d.name}?${maskParams}&key=${FIREBASE_API_KEY}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: patchFields }),
          }
        ).catch(() => {});
      }

      return { duplicate: true, merged: fieldPaths.length > 0 };
    }
  } catch {
    // Non-blocking fallback: continue writing if lookup fails
  }
  return { duplicate: false };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-webhook-token');

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
  let notificationTitle = '';
  let notificationText = '';
  let sourcePackage = '';
  let occurredAt = null;
  if (typeof req.body === 'string') {
    smsText = req.body;
  } else if (req.body && typeof req.body === 'object') {
    smsText = req.body.text || req.body.message || req.body.sms || req.body.body || '';
    notificationTitle = req.body.notificationTitle || '';
    notificationText = req.body.notificationText || '';
    sourcePackage = req.body.sourcePackage || '';
    occurredAt = req.body.occurredAt ?? null;
    if (!smsText && (notificationTitle || notificationText)) {
      smsText = `${notificationTitle} ${notificationText}`.trim();
    }
  }

  if (!smsText.trim()) {
    return res.status(400).json({ error: 'Empty SMS/notification text.' });
  }

  try {
    const parsed = parseTransactionSms(smsText, {
      notificationTitle,
      notificationText,
      sourcePackage,
      occurredAt,
    });
    if (!parsed) {
      return res.status(422).json({ error: 'Could not extract a valid transaction amount from text.' });
    }
    if (parsed.ignored) {
      return res.status(200).json({ success: true, ignored: true, reason: parsed.reason });
    }

    const nowIso = new Date().toISOString();
    const dedupeCheck = await findAndMergeDuplicateTransaction(uid, parsed, nowIso);
    if (dedupeCheck.duplicate) {
      return res.status(200).json({
        success: true,
        ignored: true,
        deduplicated: true,
        merged: Boolean(dedupeCheck.merged),
        reason: dedupeCheck.merged
          ? 'Merged duplicate SMS/UPI alert into existing transaction'
          : 'Duplicate transaction within 3 minutes ignored',
      });
    }

    const noteText = parsed.type === 'income'
      ? '💰 Auto-logged Income via Phone SMS / UPI'
      : '📱 Auto-logged Expense via Phone SMS / UPI';

    const firestorePayload = {
      fields: {
        type: { stringValue: parsed.type },
        title: { stringValue: parsed.title },
        counterparty: { stringValue: parsed.counterparty || '' },
        accountHint: { stringValue: parsed.accountHint || '' },
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
        counterparty: parsed.counterparty,
        accountHint: parsed.accountHint,
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
