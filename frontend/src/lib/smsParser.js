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

/**
 * Clean and normalize text
 */
function cleanText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Extract Amount from Indian bank debit SMS or freeform text
 */
function extractAmount(text) {
  // Common bank patterns:
  // "Rs. 350.00", "Rs 350", "INR 1,499.50", "debited by Rs 250", "₹500", "paid Rs.80"
  const patterns = [
    /(?:rs\.?|inr|₹)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /(?:debited(?:\s+by|\s+with)?|spent|paid)\s*(?:rs\.?|inr|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:rs|rupees|inr|bucks)/i,
  ];

  for (const regex of patterns) {
    const match = text.match(regex);
    if (match && match[1]) {
      const num = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(num) && num > 0) return num;
    }
  }

  // Fallback: look for standalone numbers if text is short (e.g. "zomato 350")
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

/**
 * Extract Merchant / Title
 */
function extractMerchant(text) {
  // "to ZOMATO", "at BLINKIT", "transfer to SWIGGY", "Info: UPI/UBER/...", "Paid to Chai Point"
  const merchantPatterns = [
    /(?:transfer\s+to|transferred\s+to|paid\s+to|to|at)\s+([A-Za-z0-9&.\- ]{2,30}?)(?:\s+on|\s+via|\s+ref|\s+using|\.|$)/i,
    /info:\s*(?:upi\/)?([A-Za-z0-9&.\- ]{2,25}?)(?:\/|\.|$)/i,
    /(?:vpa|upi)\s*[:/]\s*([A-Za-z0-9&.\- ]{2,25}?)(?:\/|\.|$)/i,
  ];

  for (const regex of merchantPatterns) {
    const match = text.match(regex);
    if (match && match[1]) {
      const candidate = match[1].trim();
      // Ignore common non-merchant words
      if (!['a/c', 'account', 'card', 'upi', 'your', 'my', 'the'].includes(candidate.toLowerCase())) {
        return capitalizeWords(candidate);
      }
    }
  }

  // Freeform fallback: check if known brand name appears in text
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

/**
 * Detect Category from text / merchant
 */
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

/**
 * Detect Payment Method
 */
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
  return 'upi'; // default in India
}

/**
 * Extract Date
 */
function extractDate(text) {
  const lower = text.toLowerCase();
  const now = new Date();

  if (lower.includes('yesterday')) {
    const yest = new Date();
    yest.setDate(now.getDate() - 1);
    return yest.toISOString().split('T')[0];
  }

  // Patterns like "24-Nov-26", "24-11-2026", "24/11/26"
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

function capitalizeWords(str) {
  return str
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Master Parse Function
 * @param {string} rawText - Can be a bank SMS, UPI push notification, or natural text
 * @returns {Object} Parsed expense details
 */
export function parseExpenseText(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;

  const text = cleanText(rawText);
  const amount = extractAmount(text);
  const merchant = extractMerchant(text);
  const category = detectCategory(text, merchant);
  const paymentMethod = detectPaymentMethod(text);
  const date = extractDate(text);

  const isBankSms =
    /debited|transferred|sent|paid|a\/c|ending|ref\s*no|avl\s*bal/i.test(text);

  return {
    amount: amount || '',
    title: merchant || 'Expense',
    category,
    paymentMethod,
    date,
    originalText: text,
    isBankSms,
    confidence: amount ? (merchant ? 'high' : 'medium') : 'low',
  };
}
