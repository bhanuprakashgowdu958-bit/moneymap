// Magic SMS & Bank Alert Parser for Indian Banks & UPI transactions
// Supports HDFC, ICICI, SBI, Axis, Kotak, PNB, Bank of Baroda, Paytm, PhonePe, Google Pay, CRED, and freeform text.

const CATEGORY_KEYWORDS = {
  'food-delivery': [
    'zomato', 'swiggy', 'mcdonald', 'domino', 'pizza', 'biryani', 'kfc', 'burger king',
    'haldiram', 'subway', 'eatclub', 'box8', 'behrouz', 'faasos', 'restaurant', 'cafe',
    'bistro', 'diner', 'dhaba', 'food', 'lunch', 'dinner', 'breakfast', 'snack'
  ],
  'groceries': [
    'blinkit', 'zepto', 'instamart', 'bigbasket', 'bb daily', 'dmart', 'd-mart', 'supermarket',
    'grocery', 'kirana', 'nature basket', 'reliance fresh', 'more retail', 'spencer',
    'milk', 'vegetables', 'fruits', 'ration'
  ],
  'drinks-beverages': [
    'starbucks', 'chai point', 'chaayos', 'barista', 'cafe coffee day', 'third wave',
    'blue tokai', 'coffee', 'tea', 'chai', 'beer', 'wine', 'liquor', 'alcohol', 'pub', 'brewery'
  ],
  'transport': [
    'uber', 'ola', 'rapido', 'namma yatri', 'metro', 'irctc', 'railway', 'train', 'flight',
    'indigo', 'air india', 'petrol', 'diesel', 'fuel', 'hpcl', 'bpcl', 'iocl', 'shell',
    'fastag', 'toll', 'parking', 'cab', 'auto'
  ],
  'shopping': [
    'amazon', 'flipkart', 'myntra', 'ajio', 'nykaa', 'zara', 'h&m', 'meesho', 'tata cliq',
    'croma', 'reliance digital', 'ikea', 'decathlon', 'uniqlo', 'clothes', 'shoes'
  ],
  'entertainment': [
    'bookmyshow', 'pvr', 'inox', 'cinepolis', 'movie', 'netflix', 'spotify', 'prime video',
    'hotstar', 'disney', 'youtube', 'gaming', 'steam', 'playstation'
  ],
  'subscriptions': [
    'netflix', 'spotify', 'prime', 'youtube premium', 'apple', 'google one', 'gym',
    'cult.fit', 'cultfit', 'gold gym', 'subscription', 'membership', 'cloud'
  ],
  'health-wellness': [
    'apollo', 'pharmeasy', '1mg', 'tata 1mg', 'netmeds', 'medplus', 'pharmacy', 'chemist',
    'hospital', 'clinic', 'doctor', 'diagnostic', 'dr lal', 'lenskart', 'dentist'
  ],
  'housing': [
    'rent', 'maintenance', 'electricity', 'bescom', 'tata power', 'adani power', 'water bill',
    'piped gas', 'indane', 'hp gas', 'bharat gas', 'wifi', 'broadband', 'act fibernet', 'airtel broadband'
  ],
  'education': [
    'coursera', 'udemy', 'unacademy', 'byju', 'school', 'college', 'tuition', 'books', 'stationery'
  ],
};

const STRONG_INCOME_RE =
  /\b(?:(?:paid|sent|transferred)\s+(?:(?:rs\.?|inr|₹)\s*[0-9,.]+\s+)?to\s+you\b|(?:paid|sent)\s+you\b|you\s+received\b|received\s+(?:rs\.?|inr|₹|money|payment|from)\b|money\s+received\b|payment\s+received\b|credited\s+(?:to\s+(?:your|a\/c|acct|x+\d+)|with|by|in|for|rs\.?|inr|₹)|(?:has\s+been|is)\s+credited\b|deposited\s+(?:in|to|into)\b|\bcr\.?\s+(?:to|by)\b|\b(?:salary|cashback|refund|dividend|reimbursement|freelance|income)\b)/i;

const DEBIT_ACCOUNT_RE =
  /\b(?:your\s+(?:a\/c|acct|account|card)\s+.*debited|debited\s+(?:from|by)\s+(?:your|a\/c|acct|[0-9,.]+))\b/i;

function cleanText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function capitalizeWords(str) {
  return str
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function detectTransactionType(text) {
  if (STRONG_INCOME_RE.test(text) && !DEBIT_ACCOUNT_RE.test(text)) {
    return 'income';
  }
  return 'expense';
}

function extractAmount(text) {
  const patterns = [
    /(?:rs\.?|inr|₹)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /(?:debited(?:\s+by|\s+with)?|credited(?:\s+by|\s+with)?|received|deposited|spent|paid|sent)\s*(?:rs\.?|inr|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:rs|rupees|inr|bucks)/i,
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

function extractIncomeTitleAndCategory(text) {
  const lower = text.toLowerCase();
  let title = '';

  const senderPatterns = [
    /(?:^|[:-]\s*)([A-Za-z][A-Za-z0-9&.\- ]{1,30}?)\s+(?:paid|sent|transferred)\s+(?:(?:rs\.?|inr|₹)\s*[0-9,.]+\s+)?(?:to\s+you|you)\b/i,
    /\b(?:received(?:\s+(?:rs\.?|inr|₹)\s*[0-9,.]+)?\s+from|transfer\s+from|transferred\s+from)\s+([A-Za-z][A-Za-z0-9&.\- ]{1,30}?)(?:\s+on|\s+via|\s+ref|\s+using|\s+to\s+your|\s+into|\.|$)/i,
    /\b(?:credited\s+(?:by|from)|deposited\s+by|from)\s+(?!(?:rs\.?|inr)\b)([A-Za-z][A-Za-z0-9&.\- ]{1,30}?)(?:\s+on|\s+via|\s+ref|\s+using|\s+to\s+your|\s+into|\.|$)/i,
    /\binfo:\s*(?:upi\/)?([A-Za-z0-9&.\- ]{2,25}?)(?:\/|\.|$)/i,
    /\bvpa\s*[:/]\s*([A-Za-z0-9&.\- ]{2,25}?)(?:\/|\.|$)/i,
  ];

  for (const regex of senderPatterns) {
    const match = text.match(regex);
    if (match && match[1]) {
      const candidate = cleanPartyCandidate(match[1]);
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
  } else if (/\b(?:freelance|client|invoice)\b/i.test(lower)) {
    category = 'freelance-business';
    if (!title) title = 'Client Payment';
  } else if (!title) {
    title = lower.includes('upi') || lower.includes('gpay') || lower.includes('phonepe') || lower.includes('paytm')
      ? 'UPI Money Received'
      : 'Bank Credit';
  }

  return { title, category };
}

function extractMerchant(text) {
  const merchantPatterns = [
    /\bfv\.?\s*([A-Za-z0-9&.\- ]{2,30}?)(?:,|\s+bal|\s+on|$)/i,
    /(?:transfer\s+to|transferred\s+to|trf\s+to|paid\s+to|sent\s+to|to|at)\s+(?!you\b|your\b)([A-Za-z0-9&.\- ]{2,30}?)(?:\s+on|\s+via|\s+ref|\s+using|\.|$)/i,
    /info:\s*(?:upi\/)?([A-Za-z0-9&.\- ]{2,25}?)(?:\/|\.|$)/i,
    /(?:vpa|upi)\s*[:/]\s*([A-Za-z0-9&.\- ]{2,25}?)(?:\/|\.|$)/i,
  ];

  for (const regex of merchantPatterns) {
    const match = text.match(regex);
    if (match && match[1]) {
      const candidate = cleanPartyCandidate(match[1]);
      if (!isInvalidPartyName(candidate)) {
        return capitalizeWords(candidate);
      }
    }
  }

  const lower = text.toLowerCase();
  for (const categoryKeywords of Object.values(CATEGORY_KEYWORDS)) {
    for (const kw of categoryKeywords) {
      if (lower.includes(kw)) {
        return capitalizeWords(kw);
      }
    }
  }

  return 'Bank Debit Expense';
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
  const date = extractDate(text);

  let title;
  let category;
  if (type === 'income') {
    const incomeDetails = extractIncomeTitleAndCategory(text);
    title = incomeDetails.title;
    category = incomeDetails.category;
  } else {
    title = extractMerchant(text);
    category = detectCategory(text, title);
  }

  const isBankSms =
    /debited|credited|received|deposited|transferred|sent|paid|a\/c|ending|ref\s*no|avl\s*bal/i.test(text);

  return {
    type,
    amount: amount || '',
    title: title || (type === 'income' ? 'Income' : 'Expense'),
    category,
    paymentMethod,
    date,
    originalText: text,
    isBankSms,
    confidence: amount ? (title ? 'high' : 'medium') : 'low',
  };
}
