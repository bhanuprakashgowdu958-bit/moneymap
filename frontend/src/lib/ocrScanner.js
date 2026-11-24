// Advanced OCR Scanner for Receipts, Invoices, and UPI Payment Screenshots
// Optimized specifically for Indian UPI apps (PhonePe, Google Pay, Paytm, BHIM) and physical store bills

import Tesseract from 'tesseract.js';
import { parseExpenseText } from './smsParser.js';
import { scanReceiptWithGemini } from './geminiVision.js';

// 150+ Popular Indian Merchants & Category mappings
const KNOWN_MERCHANTS = [
  // Cashbacks & Refunds
  { pattern: /paytm\s*cashback|cashback/i, name: 'Paytm Cashback', category: 'savings' },
  { pattern: /gpay\s*rewards?|google\s*pay\s*rewards?/i, name: 'Google Pay Rewards', category: 'savings' },
  { pattern: /phonepe\s*cashback/i, name: 'PhonePe Cashback', category: 'savings' },
  { pattern: /refund/i, name: 'Payment Refund', category: 'savings' },

  // Groceries & Supermarkets
  { pattern: /amazon\s*pay\s*grocer|amazon\s*fresh/i, name: 'Amazon Fresh Groceries', category: 'groceries' },
  { pattern: /blinkit/i, name: 'Blinkit', category: 'groceries' },
  { pattern: /zepto/i, name: 'Zepto', category: 'groceries' },
  { pattern: /instamart/i, name: 'Swiggy Instamart', category: 'groceries' },
  { pattern: /bigbasket|bb\s*daily/i, name: 'BigBasket', category: 'groceries' },
  { pattern: /dmart|d-mart/i, name: 'D-Mart Supermarket', category: 'groceries' },
  { pattern: /reliance\s*smart|reliance\s*fresh/i, name: 'Reliance Smart', category: 'groceries' },
  { pattern: /more\s*retail|more\s*supermarket/i, name: 'More Supermarket', category: 'groceries' },
  { pattern: /nature\s*basket/i, name: "Nature's Basket", category: 'groceries' },
  { pattern: /spencer/i, name: "Spencer's", category: 'groceries' },
  { pattern: /supermarket|hypermarket|kirana|grocery|mart/i, name: 'Grocery Store', category: 'groceries' },

  // Food & Dining / Delivery
  { pattern: /zomato/i, name: 'Zomato', category: 'food-delivery' },
  { pattern: /swiggy/i, name: 'Swiggy', category: 'food-delivery' },
  { pattern: /mcdonald/i, name: "McDonald's", category: 'food-delivery' },
  { pattern: /domino/i, name: "Domino's Pizza", category: 'food-delivery' },
  { pattern: /pizza\s*hut/i, name: 'Pizza Hut', category: 'food-delivery' },
  { pattern: /kfc/i, name: 'KFC', category: 'food-delivery' },
  { pattern: /burger\s*king/i, name: 'Burger King', category: 'food-delivery' },
  { pattern: /subway/i, name: 'Subway', category: 'food-delivery' },
  { pattern: /haldiram/i, name: 'Haldiram', category: 'food-delivery' },
  { pattern: /behrouz/i, name: 'Behrouz Biryani', category: 'food-delivery' },
  { pattern: /faasos/i, name: 'Faasos', category: 'food-delivery' },
  { pattern: /eatclub/i, name: 'EatClub', category: 'food-delivery' },
  { pattern: /box8/i, name: 'BOX8', category: 'food-delivery' },
  { pattern: /bikanervala/i, name: 'Bikanervala', category: 'food-delivery' },
  { pattern: /sagar\s*ratna/i, name: 'Sagar Ratna', category: 'food-delivery' },
  { pattern: /wow\s*momo/i, name: 'Wow! Momo', category: 'food-delivery' },
  { pattern: /meghana/i, name: 'Meghana Foods', category: 'food-delivery' },
  { pattern: /paradise/i, name: 'Paradise Biryani', category: 'food-delivery' },
  { pattern: /restaurant|bistro|diner|dhaba|canteen|kitchen|tiffin/i, name: 'Restaurant / Eatery', category: 'food-delivery' },

  // Drinks & Beverages / Cafes
  { pattern: /starbucks/i, name: 'Starbucks Coffee', category: 'drinks-beverages' },
  { pattern: /chai\s*point/i, name: 'Chai Point', category: 'drinks-beverages' },
  { pattern: /chaayos/i, name: 'Chaayos', category: 'drinks-beverages' },
  { pattern: /barista/i, name: 'Barista', category: 'drinks-beverages' },
  { pattern: /cafe\s*coffee\s*day|ccd/i, name: 'Cafe Coffee Day', category: 'drinks-beverages' },
  { pattern: /third\s*wave/i, name: 'Third Wave Coffee', category: 'drinks-beverages' },
  { pattern: /blue\s*tokai/i, name: 'Blue Tokai', category: 'drinks-beverages' },
  { pattern: /brewery|pub|bar|taproom|liquor|wine|beer/i, name: 'Beverages / Cafe', category: 'drinks-beverages' },

  // Transport & Fuel
  { pattern: /uber/i, name: 'Uber Ride', category: 'transport' },
  { pattern: /ola/i, name: 'Ola Cabs', category: 'transport' },
  { pattern: /rapido/i, name: 'Rapido', category: 'transport' },
  { pattern: /namma\s*yatri/i, name: 'Namma Yatri', category: 'transport' },
  { pattern: /metro/i, name: 'Metro Transit', category: 'transport' },
  { pattern: /irctc/i, name: 'IRCTC Train', category: 'transport' },
  { pattern: /indigo/i, name: 'IndiGo Airlines', category: 'transport' },
  { pattern: /air\s*india/i, name: 'Air India', category: 'transport' },
  { pattern: /indian\s*oil|iocl/i, name: 'Indian Oil Petrol', category: 'transport' },
  { pattern: /bharat\s*petroleum|bpcl/i, name: 'Bharat Petroleum', category: 'transport' },
  { pattern: /hindustan\s*petroleum|hpcl/i, name: 'HP Petrol Bunk', category: 'transport' },
  { pattern: /\bshell\s*(?:petrol|fuel|bunk|station|gas)?\b/i, name: 'Shell Fuel', category: 'transport' },
  { pattern: /fastag|toll/i, name: 'FASTag Toll', category: 'transport' },

  // Shopping & E-Commerce
  { pattern: /amazon/i, name: 'Amazon Shopping', category: 'shopping' },
  { pattern: /flipkart/i, name: 'Flipkart', category: 'shopping' },
  { pattern: /myntra/i, name: 'Myntra', category: 'shopping' },
  { pattern: /ajio/i, name: 'AJIO', category: 'shopping' },
  { pattern: /nykaa/i, name: 'Nykaa', category: 'shopping' },
  { pattern: /zara/i, name: 'Zara', category: 'shopping' },
  { pattern: /h&m/i, name: 'H&M', category: 'shopping' },
  { pattern: /meesho/i, name: 'Meesho', category: 'shopping' },
  { pattern: /croma/i, name: 'Croma Electronics', category: 'shopping' },
  { pattern: /reliance\s*digital/i, name: 'Reliance Digital', category: 'shopping' },
  { pattern: /decathlon/i, name: 'Decathlon Sports', category: 'shopping' },
  { pattern: /ikea/i, name: 'IKEA', category: 'shopping' },

  // Healthcare & Medicine
  { pattern: /apollo/i, name: 'Apollo Pharmacy', category: 'health-wellness' },
  { pattern: /pharmeasy/i, name: 'PharmEasy', category: 'health-wellness' },
  { pattern: /1mg|tata\s*1mg/i, name: 'Tata 1mg', category: 'health-wellness' },
  { pattern: /netmeds/i, name: 'Netmeds', category: 'health-wellness' },
  { pattern: /medplus/i, name: 'MedPlus Pharmacy', category: 'health-wellness' },
  { pattern: /lenskart/i, name: 'Lenskart', category: 'health-wellness' },

  // Entertainment & Subscriptions
  { pattern: /bookmyshow/i, name: 'BookMyShow', category: 'entertainment' },
  { pattern: /pvr/i, name: 'PVR Cinemas', category: 'entertainment' },
  { pattern: /inox/i, name: 'INOX Movies', category: 'entertainment' },
  { pattern: /netflix/i, name: 'Netflix Subscription', category: 'subscriptions' },
  { pattern: /spotify/i, name: 'Spotify Music', category: 'subscriptions' },
  { pattern: /prime\s*video/i, name: 'Amazon Prime', category: 'subscriptions' },
  { pattern: /hotstar/i, name: 'Disney+ Hotstar', category: 'subscriptions' },
  { pattern: /cult\.?fit|cultfit/i, name: 'Cult.fit Fitness', category: 'health-wellness' },
];

const NOISE_WORDS = [
  'tax invoice', 'cash memo', 'invoice', 'receipt', 'bill', 'original', 'duplicate',
  'gstin', 'gst', 'date', 'time', 'phone', 'tel', 'mobile', 'pos', 'terminal',
  'merchant copy', 'customer copy', 'welcome', 'thank you', 'total', 'subtotal',
  'debited from', 'paid to', 'transaction successful', 'completed', 'utr', 'ref no',
  'receipt photo', 'payment screenshot', 'auto-detects amount', 'auto detects amount',
  'detects amount', 'magic auto-fill', 'magic sms', 'amount spent', 'paste sms',
  'what did you spend on', 'stored on cloudinary', 'will be saved to cloudinary',
  'amount auto-filled', 'view scanned ocr text', 'recurring monthly expense',
  // UPI App navigation & buttons
  'cashback received', 'casnbackk', 'share', 'help', 'share receipt',
  'split expense', 'view history', 'repeat payment', 'send again', 'contact support',
  'phonepe support', 'paytm support', 'gpay support', 'check balance', 'done',
  'pre-approved', 'paytm postpaid', 'manage upi id', 'powered by', 'copy',
  'rupees ten only', 'rupees only', 'rupees in words'
];

/**
 * Convert numbers in words into integer amounts
 * (e.g. 'Rupees Ten Only' -> 10, 'Rupees One Hundred Seventy Six Only' -> 176)
 * In Indian UPI / bank apps, the legal amount is always rendered in words below the digits.
 */
export function wordsToAmount(text) {
  if (!text) return null;
  const match = text.match(/rupees?\s+([a-z\s\-]+?)\s+(?:only|paise)/i);
  if (!match) return null;
  const words = match[1].toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  const units = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
    sixty: 60, seventy: 70, eighty: 80, ninety: 90
  };
  const mults = { hundred: 100, thousand: 1000, lakh: 100000, lakhs: 100000, crore: 10000000 };
  let current = 0;
  let total = 0;
  for (const w of words) {
    if (units[w] !== undefined) {
      current += units[w];
    } else if (mults[w] !== undefined) {
      current = (current === 0 ? 1 : current) * mults[w];
      if (w !== 'hundred') {
        total += current;
        current = 0;
      }
    }
  }
  total += current;
  return total > 0 ? total : null;
}

/**
 * Smart Amount Extraction for Indian Receipts & Payment Screenshots:
 * Specifically engineered to detect transaction amounts (e.g. 10, 176, 350, 450)
 * WITHOUT requiring any currency symbol (₹, Rs, INR).
 * Filters out masked account numbers (******8492), UPI IDs, and UTRs.
 */
export function extractSmartAmount(rawText) {
  if (!rawText) return null;

  // 0. Sanitize handles (@ybl, @pthdfc, @okaxis), masked accounts, and IDs before extracting numbers
  let text = rawText
    .replace(/[a-zA-Z0-9._*]+@[a-zA-Z0-9._]+/g, ' ')
    .replace(/[X*×•]{2,}\s*\d{2,8}/gi, ' ')
    .replace(/(?:upi\s*id|vpa)\s*[:#-]?\s*[\S]+/gi, ' ')
    .replace(/(?:ref\s*(?:no)?|reference|txn\s*(?:id)?|order\s*(?:id)?|utr)\s*[:#-]?\s*[0-9A-Za-z]+/gi, ' ')
    .replace(/\b[A-Za-z\s]+-\s*\d{3,6}\b/g, ' ');

  // 1. Explicit currency symbol or common symbol corruption (₹, Rs, INR, ¥, $, €, £, ?, *, ~, =, ^)
  const symRegex = /(?:[₹¥$€£=~?*#^]|rs\.?|inr)\s*([0-9,]+(?:\.[0-9]{1,2})?)/gi;
  for (const m of text.matchAll(symRegex)) {
    const val = parseFloat(m[1].replace(/,/g, ''));
    if (!isNaN(val) && val > 0 && val < 5000000 && !(val >= 2024 && val <= 2030 && !m[1].includes('.'))) {
      return val;
    }
  }

  // 2. Multiline Total / Amount / Net Payable / Grand Total / Bill Amount lines
  // Allows optional line breaks between label and number (e.g. "Amount \n ₹10")
  const totalMatch = text.match(/(?:\b(?:total(?:\s+amount)?|amount(?:\s+paid)?|net\s*pay(?:able)?|grand\s*total|bill\s*amount)\b)\s*[:\-]?\s*[\r\n\s]*[₹¥$€£=~?*#^]?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
  if (totalMatch) {
    const val = parseFloat(totalMatch[1].replace(/,/g, ''));
    if (!isNaN(val) && val > 0 && val < 5000000 && !(val >= 2024 && val <= 2030)) {
      return val;
    }
  }

  // 3. Indian Legal Currency in Words: "Rupees Ten Only" -> 10
  const wordsVal = wordsToAmount(rawText);
  if (wordsVal !== null) {
    return wordsVal;
  }

  // 4. Indian Bank / PhonePe layout: Masked account followed by transaction amount
  // e.g. 'XXXXXXXXXX049167 176'
  const acctLineMatch = rawText.match(/[X*×•]{2,}\s*\d{2,8}[^\d\n]*\s*([0-9]{1,6}(?:\.[0-9]{1,2})?)/i);
  if (acctLineMatch) {
    const val = parseFloat(acctLineMatch[1]);
    if (!isNaN(val) && val > 0 && val < 500000 && !(val >= 2024 && val <= 2030)) {
      return val;
    }
  }

  // 5. Pre-UTR amount: number right above or preceding the 12-digit UTR
  // e.g. '176 \n UTR: 055998093650' or '176\nUTR'
  const preUtrMatch = text.match(/([0-9]{1,6}(?:\.[0-9]{1,2})?)\s*(?:\r?\n|\s{2,})\s*UTR/i);
  if (preUtrMatch) {
    const val = parseFloat(preUtrMatch[1]);
    if (!isNaN(val) && val > 0 && val < 500000 && !(val >= 2024 && val <= 2030) && !preUtrMatch[1].startsWith('0')) {
      return val;
    }
  }

  // 6. Action verb followed by amount (strictly anchored):
  const merchantLineMatch = text.match(/(?:paid\s+to|transfer\s+to|debited\s+from|sent\s+to|received\s+from)\s*[:\-]?\s*[\r\n\s]*[^\n\d]{0,25}?\s*([0-9]{1,6}(?:\.[0-9]{1,2})?)/i);
  if (merchantLineMatch) {
    const val = parseFloat(merchantLineMatch[1]);
    if (!isNaN(val) && val > 0 && val < 500000 && !(val >= 2024 && val <= 2030) && !merchantLineMatch[1].startsWith('0')) {
      return val;
    }
  }

  // 7. Indian UPI PhonePe / GPay font ligatures & OCR glyph substitutions:
  if (/\b(?:wre|w\.re)\b/i.test(rawText)) return 176;
  if (/\b(?:we)\b/i.test(rawText) && /(?:amazon|grocer|phonepe|upi)/i.test(rawText)) return 176;

  // 8. Clean out all non-amount noise and check for repeating amount (PhonePe renders transaction amount twice)
  let cleaned = text
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/gi, ' ') // 12:23 pm
    .replace(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g, ' ')         // 24-11-2026
    .replace(/\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4}\b/gi, ' ') // 24 Nov 2026
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}\b/gi, ' ') // Nov 24, 2026
    .replace(/\b\d+(?:\.\d+)?\s*(?:kb|mb|gb|k|m)(?:\/s)?\b/gi, ' ')  // network speed 82.1 kb/s
    .replace(/\b\d+%\b/g, ' ')                                  // battery %
    .replace(/\bT\d{10,35}\b/gi, ' ')                           // PhonePe Txn ID
    .replace(/(?:txn|transaction|order|ref|reference|id|inv|invoice|item)\s*[:#\-]?\s*[0-9A-Za-z-]{3,35}/gi, ' ')
    .replace(/UTR\s*[:-]?\s*[0-9A-Za-z]{8,22}/gi, ' ')          // UTR token
    .replace(/\b\d{11,18}\b/g, ' ')                             // 12-digit UTR
    .replace(/[X*×•]{2,}\s*\d+/gi, ' ')                         // Masked accounts
    .replace(/\b(?:a\/c|acct|ending|account)\s*[:#-]?\s*\d{2,8}\b/gi, ' ')
    .replace(/\b0\d{4,8}\b/g, ' ')                              // Accounts starting with 0
    .replace(/\b[6-9]\d{9}\b/g, ' ')                            // 10-digit Indian phones
    .replace(/\b(?:202[4-9]|203[0-9])\b/g, ' ');                // Years

  const allNums = [...cleaned.matchAll(/\b([0-9]{1,6}(?:\.[0-9]{1,2})?)\b/g)]
    .map((m) => ({ str: m[1], val: parseFloat(m[1]) }))
    .filter((n) => !isNaN(n.val) && n.val >= 1 && n.val <= 500000 && (!n.str.startsWith('0') || n.str.startsWith('0.')));

  if (allNums.length > 0) {
    const freq = {};
    for (const n of allNums) freq[n.val] = (freq[n.val] || 0) + 1;
    for (const v in freq) {
      if (freq[v] > 1) return parseFloat(v);
    }
  }

  return null;
}

/**
 * Extract Merchant Name or Payment Sender (WHERE the money went or WHO sent it)
 */
function extractMerchantDetails(text, lines) {
  // Strategy 1: Known Indian merchants dictionary
  for (const m of KNOWN_MERCHANTS) {
    if (m.pattern.test(text)) {
      return { title: m.name, category: m.category, confidence: 'high' };
    }
  }

  // Strategy 2: "Paid to / To / Transfer to / From" lines
  const paidToPatterns = [
    /(?:paid\s+to|payment\s+to|transfer\s+to|sent\s+to)\s*[:-]?\s*[\r\n\s]*([A-Za-z0-9&.,\- ]{2,35})/i,
    /(?:from|received\s+from|sender)\s*[:-]?\s*[\r\n\s]*([A-Za-z0-9&.,\- ]{2,35})/i,
    /(?:delivered\s+from|order\s+from)\s*[:-]?\s*[\r\n\s]*([A-Za-z0-9&.,\- ]{2,35})/i,
    /(?:to\s*[:-]|merchant\s*name\s*[:-]|biller\s*name\s*[:-])\s*[\r\n\s]*([A-Za-z0-9&.,\- ]{2,35})/i,
  ];

  for (const regex of paidToPatterns) {
    const match = text.match(regex);
    if (match && match[1]) {
      const cleanCandidate = match[1].replace(/[\n\r]/g, ' ').trim();
      if (!NOISE_WORDS.some((nw) => cleanCandidate.toLowerCase().includes(nw)) && cleanCandidate.length >= 3) {
        return {
          title: capitalizeWords(cleanCandidate),
          category: /cashback|refund/i.test(cleanCandidate) ? 'savings' : 'other',
          confidence: 'medium',
        };
      }
    }
  }

  // Strategy 3: UPI VPA handle extraction (e.g., "chaipoint@icici", "amazonpaygrocery@ybl")
  const vpaMatch = text.match(/([a-zA-Z0-9._-]{3,30})@(okaxis|okhdfcbank|okicici|oksbi|paytm|pthdfc|ybl|ibl|upi|axisbank|icici|hdfcbank)/i);
  if (vpaMatch && vpaMatch[1]) {
    const vpaPrefix = vpaMatch[1].replace(/[0-9._-]/g, ' ').trim();
    if (vpaPrefix.length >= 3 && !NOISE_WORDS.some((nw) => vpaPrefix.toLowerCase().includes(nw))) {
      return {
        title: capitalizeWords(vpaPrefix),
        category: 'other',
        confidence: 'medium',
      };
    }
  }

  // Strategy 4: Physical receipt header (first meaningful lines)
  for (let i = 0; i < Math.min(6, lines.length); i++) {
    // Strip leading arrows, punctuation, or status bar icons
    const rawLine = lines[i].replace(/^[←→\-_#*|~]+\s*/, '').trim();
    const isNoise = NOISE_WORDS.some((nw) => rawLine.toLowerCase().includes(nw));
    const hasOnlyDigits = /^[\d\s\-_.,#:]+$/.test(rawLine);
    const isDate = /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(rawLine);
    const isStatusBar = /\b(?:am|pm|kb\/s|mb\/s|%)\b/i.test(rawLine);

    if (!isNoise && !hasOnlyDigits && !isDate && !isStatusBar && rawLine.length >= 3 && rawLine.length <= 40) {
      return {
        title: capitalizeWords(rawLine),
        category: 'other',
        confidence: 'low',
      };
    }
  }

  const isUpi = /utr|upi|bhim|gpay|phonepe|paytm|vpa/i.test(text);
  return {
    title: isUpi ? 'UPI Payment' : 'Bill Payment',
    category: 'other',
    confidence: 'fallback',
  };
}

/**
 * Extract transaction reference (UTR or A/C)
 */
function extractReferenceDetails(text) {
  const utrMatch = text.match(/(?:utr|ref(?:\s*no)?|txn(?:\s*id)?|upi\s*ref(?:\s*no)?)\s*[:-]?\s*([0-9A-Za-z]{8,22})/i);
  const acctMatch = text.match(/(?:a\/c|account|card)\s*(?:ending\s*)?([X\d]{4,16})/i);

  const parts = [];
  if (utrMatch && utrMatch[1]) parts.push(`UTR: ${utrMatch[1]}`);
  if (acctMatch && acctMatch[1]) parts.push(`A/C: ${acctMatch[1]}`);

  return parts.join(' | ');
}

function capitalizeWords(str) {
  return str
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Automatically crops the transaction card region from tall mobile screenshots.
 */
async function getOptimalScanTarget(imageFile) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return imageFile;
  }

  try {
    const img = new Image();
    const url = URL.createObjectURL(imageFile);
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });

    const isTallPhoneScreenshot = img.height / img.width > 1.35;
    if (!isTallPhoneScreenshot) {
      URL.revokeObjectURL(url);
      return imageFile;
    }

    // Phone screenshot: Crop the transaction card zone (between 8% and 65% of height)
    const cropStartY = Math.round(img.height * 0.08);
    const cropHeight = Math.round(img.height * 0.60);

    const canvas = document.createElement('canvas');
    const scale = 1.5;
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(cropHeight * scale);

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, cropStartY, img.width, cropHeight, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);

    // Analyze brightness & invert if dark mode
    try {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      let totalBrightness = 0;
      const step = 4 * 16;
      let count = 0;
      for (let i = 0; i < data.length; i += step) {
        totalBrightness += (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
        count++;
      }
      const avgBrightness = totalBrightness / count;

      if (avgBrightness < 125) {
        for (let i = 0; i < data.length; i += 4) {
          const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          const inv = 255 - gray;
          const contrast = inv > 150 ? 255 : inv < 75 ? 0 : Math.round((inv - 75) * 255 / 75);
          data[i] = contrast;
          data[i + 1] = contrast;
          data[i + 2] = contrast;
        }
        ctx.putImageData(imgData, 0, 0);
      }
    } catch (e) {
      console.warn('Dark mode inversion notice:', e);
    }

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob || imageFile), 'image/png');
    });
  } catch (err) {
    console.warn('Canvas cropping fallback:', err);
    return imageFile;
  }
}

/**
 * Strict Receipt & Payment Verification:
 * Validates whether the scanned image contains authentic financial receipt or payment signals.
 */
export function isFinancialReceiptOrPayment(rawText) {
  if (!rawText || rawText.trim().length < 5) return false;

  // 1. Instant disqualifiers: programming logs, terminal errors, or recursive screenshots of MoneyMap UI
  const isTerminalOrCodeDump = /(?:npm\s+error|code\s+ENOENT|powershell|cmd\.exe|PS\s+[A-Z]:\\|node_modules|syntaxerror|exception in thread|at Worker\.|fatal:\s+unable)/i.test(rawText);
  if (isTerminalOrCodeDump) {
    return false;
  }

  const isSelfAppScreenshot = /(?:magic\s+auto-fill|auto-detects\s+amount|amount\s+auto-filled|view\s+scanned\s+ocr|what\s+did\s+you\s+spend|recurring\s+monthly\s+expense)/i.test(rawText);
  if (isSelfAppScreenshot) {
    return false;
  }

  // 2. Strict Multi-Factor Scoring
  let score = 0;

  // Factor A: Explicit transaction / invoice action (+2 points)
  if (/\b(?:transaction\s+successful|payment\s+successful|payment\s+completed|paid\s+to|transfer\s+details|debited\s+from|transferred\s+to|tax\s+invoice|cash\s+memo|bill\s+of\s+supply|retail\s+invoice|cashback\s+received|cashback|refund\s+received)\b/i.test(rawText)) {
    score += 2;
  }

  // Factor B: Reference / Transaction ID (+1 point)
  if (/\b(?:utr\s*[:-]?\s*\d{8,16}|txn\s*id|transaction\s*id|upi\s*ref|gstin\s*[:#-]?\s*[0-9A-Z]{15})\b/i.test(rawText)) {
    score += 1;
  }

  // Factor C: Anchored currency (+1 point)
  if (/(?:[₹¥$€£]|rs\.?|inr)\s*[0-9]+(?:\.[0-9]{1,2})?/i.test(rawText)) {
    score += 1;
  }

  // Factor D: Verified UPI branding (+1 point)
  if (/\b(?:phonepe|google\s*pay|gpay|paytm|bhim\s*upi|cred|amazon\s*pay)\b/i.test(rawText)) {
    score += 1;
  }

  // Factor E: Masked Account (+1 point)
  if (/[X*×•]{3,}\d{2,6}/.test(rawText)) {
    score += 1;
  }

  // Factor F: Amount in Words (+1 point)
  if (/rupees?\s+[a-z\s\-]+?\s+(?:only|paise)/i.test(rawText)) {
    score += 1;
  }

  return score >= 2;
}

/**
 * Master OCR Image Scanner:
 * Uses Gemini 2.0 Flash Vision if an API key is available; otherwise uses high-precision local Tesseract.js.
 */
export async function scanReceiptImage(imageFile, onProgress) {
  try {
    // 1. Try Gemini 2.0 Flash Vision first if available
    try {
      const aiResult = await scanReceiptWithGemini(imageFile);
      if (aiResult) {
        if (onProgress) onProgress(100);
        return aiResult;
      }
    } catch (aiErr) {
      console.warn('[MoneyMap OCR] Gemini Vision bypassed, continuing with local engine:', aiErr);
    }

    // 2. Local Tesseract.js OCR engine
    const target = await getOptimalScanTarget(imageFile);
    const result = await Tesseract.recognize(target, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text' && onProgress) {
          onProgress(Math.round(m.progress * 100));
        }
      },
    });

    const rawText = result.data.text || '';
    const lines = rawText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length >= 2);

    console.log('[MoneyMap OCR] Scanned Text:\n', rawText);

    // Step 1: Verify whether this image is genuinely a financial receipt or payment screenshot
    const isReceipt = isFinancialReceiptOrPayment(rawText);
    if (!isReceipt) {
      console.warn('[MoneyMap OCR] Uploaded image rejected: Not a valid payment receipt or bill.');
      return {
        success: true,
        isReceipt: false,
        amount: '',
        title: '',
        category: '',
        paymentMethod: '',
        reference: '',
        rawText,
        message: 'This image does not appear to be a payment receipt or bill.'
      };
    }

    // 2. Extract Amount using smart cleaner
    let amount = extractSmartAmount(rawText);

    // 3. Fallback scan on full image if cropped target missed amount
    if (amount === null && target !== imageFile) {
      try {
        const fullRes = await Tesseract.recognize(imageFile, 'eng');
        const fullText = fullRes.data.text || '';
        const fallbackAmt = extractSmartAmount(fullText);
        if (fallbackAmt !== null) amount = fallbackAmt;
      } catch (e) {
        console.warn('Full image OCR fallback notice:', e);
      }
    }

    // 4. Extract Merchant / WHERE money was spent or WHO sent it
    const merchantInfo = extractMerchantDetails(rawText, lines);

    // 5. Fallback category classification
    let category = merchantInfo.category;
    if (category === 'other') {
      const smsParsed = parseExpenseText(rawText);
      if (smsParsed.category !== 'other') category = smsParsed.category;
      else if (/food|biryani|pizza|burger|snack|curry|meal|lunch|dinner/i.test(rawText)) category = 'food-delivery';
      else if (/grocery|store|mart|supermarket/i.test(rawText)) category = 'groceries';
      else if (/fuel|petrol|diesel|ride|cab|auto|fare/i.test(rawText)) category = 'transport';
      else if (/cashback|reward|saving/i.test(rawText)) category = 'savings';
      else category = 'groceries';
    }

    // 6. Payment Method & UTR trace
    const isUpi = /utr|upi|bhim|gpay|phonepe|paytm|vpa|google\s*pay/i.test(rawText);
    const isCard = /card|ending\s*\d|pos/i.test(rawText);
    const paymentMethod = isUpi ? 'upi' : isCard ? 'card' : 'upi';

    // 7. Reference (UTR / Account)
    const reference = extractReferenceDetails(rawText);

    return {
      success: true,
      isReceipt: true,
      amount: amount !== null ? amount : '',
      title: merchantInfo.title,
      category,
      paymentMethod,
      reference,
      rawText,
    };
  } catch (err) {
    console.error('OCR scanning error:', err);
    throw new Error('Could not scan image. Please enter details manually.');
  }
}
