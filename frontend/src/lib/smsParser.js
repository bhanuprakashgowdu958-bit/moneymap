// Magic SMS & Bank Alert Parser for Indian Banks & UPI transactions
// Supports HDFC, ICICI, SBI, Axis, Kotak, PNB, Bank of Baroda, Paytm, PhonePe, Google Pay, CRED, and freeform text.

const CATEGORY_KEYWORDS = {
  'food-delivery': [
    'zomato', 'swiggy', 'mcdonald', 'domino', 'pizza', 'biryani', 'kfc', 'burger king',
    'haldiram', 'subway', 'eatclub', 'box8', 'behrouz', 'faasos', 'restaurant', 'cafe',
    'bistro', 'diner', 'dhaba', 'food', 'lunch', 'dinner', 'breakfast', 'snack',
  ],
  groceries: [
    'blinkit', 'zepto', 'instamart', 'bigbasket', 'bb daily', 'dmart', 'd-mart', 'supermarket',
    'grocery', 'kirana', 'nature basket', 'reliance fresh', 'more retail', 'spencer',
    'milk', 'vegetables', 'fruits', 'ration',
  ],
  'drinks-beverages': [
    'starbucks', 'chai point', 'chaayos', 'barista', 'cafe coffee day', 'third wave',
    'blue tokai', 'coffee', 'tea', 'chai', 'beer', 'wine', 'liquor', 'alcohol', 'pub', 'brewery',
  ],
  transport: [
    'uber', 'ola', 'rapido', 'namma yatri', 'metro', 'irctc', 'railway', 'train', 'flight',
    'indigo', 'air india', 'petrol', 'diesel', 'fuel', 'hpcl', 'bpcl', 'iocl', 'shell',
    'fastag', 'toll', 'parking', 'cab', 'auto',
  ],
  shopping: [
    'amazon', 'flipkart', 'myntra', 'ajio', 'nykaa', 'zara', 'h&m', 'meesho', 'tata cliq',
    'croma', 'reliance digital', 'ikea', 'decathlon', 'uniqlo', 'clothes', 'shoes',
  ],
  entertainment: [
    'bookmyshow', 'pvr', 'inox', 'cinepolis', 'movie', 'netflix', 'spotify', 'prime video',
    'hotstar', 'disney', 'youtube', 'gaming', 'steam', 'playstation',
  ],
  subscriptions: [
    'netflix', 'spotify', 'prime', 'youtube premium', 'apple', 'google one', 'gym',
    'cult.fit', 'cultfit', 'gold gym', 'jio', 'airtel', 'vodafone', 'vi prepaid', 'vi postpaid',
    'vi recharge', 'bsnl', 'tata play', 'tatasky', 'dish tv', 'sun direct', 'd2h',
    'dth', 'recharge', 'recharged', 'prepaid', 'postpaid', 'subscription', 'membership', 'cloud',
  ],
  'health-wellness': [
    'apollo', 'pharmeasy', '1mg', 'tata 1mg', 'netmeds', 'medplus', 'pharmacy', 'chemist',
    'hospital', 'clinic', 'doctor', 'diagnostic', 'dr lal', 'lenskart', 'dentist',
  ],
  housing: [
    'bescom', 'tata power', 'adani power', 'tsspdcl', 'apspdcl', 'msedcl', 'mseb', 'bses',
    'tneb', 'kseb', 'uppcl', 'cesc', 'nbpdcl', 'sbpdcl', 'dgvcl', 'mgvcl', 'ugvcl', 'pgvcl',
    'torrent power', 'electricity', 'power bill', 'powerbill', 'eb bill', 'light bill',
    'water bill', 'piped gas', 'indane', 'hp gas', 'bharat gas', 'wifi', 'broadband',
    'act fibernet', 'airtel broadband', 'bbps', 'bharat billpay', 'billdesk', 'rent', 'maintenance',
  ],
  education: [
    'coursera', 'udemy', 'unacademy', 'byju', 'school', 'college', 'tuition', 'books', 'stationery',
  ],
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

const PROMO_NOISE_RE =
  /\b(?:get|win|earn|avail|enjoy|unlock|grab|claim(?:\s+your|\s+now)?|chance\s+to\s+win|assured\s+(?:cashback|reward)|up\s*to\s+(?:rs\.?|inr|₹)|upto\s+(?:rs\.?|inr|₹)|flat\s+(?:rs\.?|inr|₹)?\s*[0-9,.]+\s*(?:off|cashback|discount)|scratch\s+card|voucher|coupon|promo(?:\s*code)?|use\s+code|apply\s+code|valid\s+(?:till|until)|limited\s+period|t&c\s+apply|terms\s+apply|congratulations|you(?:'ve|\s+have)\s+won|lucky\s+draw|pre-?approved|loan\s+offer|credit\s+limit|upgrade\s+your\s+card|apply\s+now|shop\s+(?:for|worth)|min(?:imum)?\s+(?:spend|order)|cashback\s+offer|special\s+offer)\b/i;

const STRONG_INCOME_RE =
  /\b(?:(?:paid|sent|transferred)\s+(?:(?:rs\.?|inr|₹)\s*[0-9,.]+\s+)?to\s+you\b|(?:paid|sent)\s+you\b|you\s+(?:have\s+)?received\b|received\s+(?:rs\.?|inr|₹|money|payment|from)\b|(?:payment|amount)\s+(?:of\s+(?:rs\.?|inr|₹)\s*[0-9,.]+\s+)?received\b|money\s+received\b|credited\s+(?:to|in|into|with|by|for|rs\.?|inr|₹)|(?:has\s+been|is)\s+credited\b|credit\s+(?:of|to|in)\b|deposited\s+(?:in|to|into)\b|\bcr\.?\s*(?:to|by|in)\b|\b(?:salary|freelance|income)\b|(?:cashback|refund|dividend|reimbursement)\s+(?:of\s+)?(?:(?:rs\.?|inr|₹)\s*[0-9,.]+\s+)?(?:credited|received|deposited|processed|issued)|(?:credited|received|deposited)\s+(?:rs\.?|inr|₹)?\s*[0-9,.]*\s*(?:as\s+)?(?:cashback|refund|salary|dividend|reimbursement))\b/i;

const DEBIT_ACCOUNT_RE =
  /\b(?:(?:your\s+)?(?:[A-Za-z]+\s+){0,3}(?:a\/c|acct|account|card)\s*(?:no\.?)?\s*(?:[*xX]+\d+|\d+)?\s*(?:is|has\s+been)?\s*debited|debited\s+(?:from|by|for|with)\s+(?:(?:[A-Za-z]+\s+){0,3}(?:your|a\/c|acct|account|card)|(?:rs\.?|inr|₹)?\s*[0-9,.]+))\b/i;

function cleanText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function formatPartyName(str) {
  return str
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const hasUpper = /[A-Z]/.test(w);
      const hasLower = /[a-z]/.test(w);
      if (hasUpper && hasLower) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
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
  const cleaned = stripLeadingNoise(raw)
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
  {
    re: /(?:^|[:\-!]\s*)([A-Za-z][A-Za-z0-9&.'\- ]{1,40}?)\s+(?:has\s+)?(?:paid|sent|transferred)\s+(?:(?:rs\.?|inr|₹)\s*[0-9,.]+\s+)?(?:to\s+you|you)\b/i,
  },
  {
    re: /\b(?:from|by)\s+(?:vpa\s+)?[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\s*\(\s*(?!upi\b|ref\b)([A-Za-z][A-Za-z0-9&.'\- ]{1,35}?)\s*\)/i,
  },
  {
    re: /\b(?:received(?:\s+(?:of\s+)?(?:rs\.?|inr|₹)\s*[0-9,.]+)?\s+from|transfer\s+from|transferred\s+from)\s+(?!(?:rs\.?|inr|vpa)\b)([A-Za-z][A-Za-z0-9&.'\- ]{1,40}?)(?:\s*\(|\s+on|\s+via|\s+ref|\s+using|\s+through|\s+in\s+your|\s+in\s+a\/c|\s+to\s+your|\s+into|[,.;/]|$)/i,
  },
  {
    re: /\b(?:credited\s+(?:by|from)|deposited\s+by|from)\s+(?!(?:rs\.?|inr|vpa|your|a\/c|acct|account)\b)([A-Za-z][A-Za-z0-9&.'\- ]{1,40}?)(?:\s*\(|\s+on|\s+via|\s+ref|\s+using|\s+through|\s+in\s+your|\s+in\s+a\/c|\s+to\s+your|\s+into|[,.;/]|$)/i,
  },
  {
    re: /;\s*([A-Za-z][A-Za-z0-9&.'\- ]{1,35}?)\s+credited\b/i,
  },
  {
    re: /\binfo\s*[:-]\s*(?:upi\/(?:(?:cr|dr|p2a|p2m)\/)?(?:\d+\/)?)?([A-Za-z][A-Za-z0-9&.'\- ]{1,35}?)(?:[/,.;(]|$)/i,
  },
  {
    re: /\bupi\/(?:(?:cr|dr|p2a|p2m)\/)?\d+\/([A-Za-z][A-Za-z0-9&.'\- ]{1,35}?)(?:[/,.;(]|$)/i,
  },
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
  {
    re: /\b(?:to|towards)\s+(?:vpa\s+)?[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\s*\(\s*(?!upi\b|ref\b)([A-Za-z][A-Za-z0-9&.'\- ]{1,35}?)\s*\)/i,
  },
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

function detectTransactionType(text) {
  if (PROMO_NOISE_RE.test(text)) {
    return 'expense';
  }
  if (STRONG_INCOME_RE.test(text) && !DEBIT_ACCOUNT_RE.test(text)) {
    return 'income';
  }
  return 'expense';
}

function extractAmount(text) {
  const patterns = [
    /(?:rs\.?|inr|₹)\s*[:\-]?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /\b(?:debited|credited|paid|sent|spent|withdrawn|deducted|charged|transferred|received|deposited|recharged?)(?:\s+(?:by|for|of|with|amount|amt))?\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /\b([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:rs\.?|rupees|inr|bucks)\b/i,
  ];

  for (const regex of patterns) {
    const match = text.match(regex);
    if (match && match[1]) {
      const num = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(num) && num > 0) return num;
    }
  }

  const tokens = text.split(/\s+/);
  for (const t of tokens) {
    const cleanNum = t.replace(/[₹,]/g, '');
    const num = parseFloat(cleanNum);
    if (!isNaN(num) && num > 0 && num < 10000000 && !t.includes(':') && !t.includes('/')) {
      return num;
    }
  }

  return null;
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

function extractIncomeTitleAndCategory(text) {
  const lower = text.toLowerCase();
  const counterparty = matchPartyFromPatterns(text, INCOME_SENDER_PATTERNS);
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
  } else if (/\b(?:freelance|client|invoice)\b/i.test(lower)) {
    category = 'freelance-business';
    if (!title) title = 'Client Payment';
  } else if (!title) {
    title = lower.includes('upi') || lower.includes('gpay') || lower.includes('phonepe') || lower.includes('paytm')
      ? 'UPI Money Received'
      : 'Bank Credit';
  }

  return { title, counterparty, category };
}

function extractMerchant(text) {
  const counterparty = matchPartyFromPatterns(text, EXPENSE_RECIPIENT_PATTERNS);
  if (counterparty) {
    return { title: counterparty, counterparty };
  }

  const lower = text.toLowerCase();
  for (const categoryKeywords of Object.values(CATEGORY_KEYWORDS)) {
    for (const kw of categoryKeywords) {
      if (lower.includes(kw)) {
        const kwTitle = formatPartyName(kw);
        return { title: kwTitle, counterparty: kwTitle };
      }
    }
  }

  return { title: 'Bank Debit Expense', counterparty: '' };
}

function detectCategory(text, merchant = '') {
  const combined = `${text} ${merchant}`.toLowerCase();

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (combined.includes(kw)) {
        return category;
      }
    }
  }

  return 'other';
}

function detectPaymentMethod(text) {
  const lower = text.toLowerCase();
  if (lower.includes('upi') || lower.includes('gpay') || lower.includes('phonepe') || lower.includes('paytm') || lower.includes('vpa')) {
    return 'upi';
  }
  if (lower.includes('card') || lower.includes('pos') || lower.includes('ending') || lower.includes('debit card') || lower.includes('credit card')) {
    return 'card';
  }
  if (lower.includes('netbanking') || lower.includes('neft') || lower.includes('imps') || lower.includes('rtgs')) {
    return 'netbanking';
  }
  if (lower.includes('cash')) {
    return 'cash';
  }
  return 'upi';
}

function extractDate(text) {
  const lower = text.toLowerCase();
  const now = new Date();

  if (lower.includes('yesterday')) {
    const yest = new Date();
    yest.setDate(now.getDate() - 1);
    return yest.toISOString().split('T')[0];
  }

  const datePatterns = [
    /(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/,
    /(\d{1,2})\s*([A-Za-z]{3,9})\s*(\d{2,4})?/i,
  ];

  for (const regex of datePatterns) {
    const match = text.match(regex);
    if (match) {
      const parsed = new Date(match[0]);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().split('T')[0];
      }
    }
  }

  return now.toISOString().split('T')[0];
}

export function parseExpenseText(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;

  const text = cleanText(rawText);
  const type = detectTransactionType(text);
  const amount = extractAmount(text);
  const paymentMethod = detectPaymentMethod(text);
  const accountHint = extractAccountHint(text);
  const date = extractDate(text);

  let title;
  let counterparty;
  let category;
  if (type === 'income') {
    const incomeDetails = extractIncomeTitleAndCategory(text);
    title = incomeDetails.title;
    counterparty = incomeDetails.counterparty;
    category = incomeDetails.category;
  } else {
    const expenseDetails = extractMerchant(text);
    title = expenseDetails.title;
    counterparty = expenseDetails.counterparty;
    category = detectCategory(text, title);
  }

  const isBankSms =
    /debited|credited|received|deposited|transferred|sent|paid|a\/c|ending|ref\s*no|avl\s*bal/i.test(text);

  return {
    type,
    amount: amount || '',
    title: title || (type === 'income' ? 'Income' : 'Expense'),
    counterparty: counterparty || '',
    accountHint,
    category,
    paymentMethod,
    date,
    originalText: text,
    isBankSms,
    confidence: amount ? (title ? 'high' : 'medium') : 'low',
  };
}
