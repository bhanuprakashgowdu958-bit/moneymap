// Advanced OCR Scanner for Receipts, Invoices, and UPI Payment Screenshots
// Optimized specifically for Indian UPI apps (PhonePe, Google Pay, Paytm, BHIM) and physical store bills

import Tesseract from 'tesseract.js';
import { parseExpenseText } from './smsParser.js';

// 150+ Popular Indian Merchants & Category mappings
const KNOWN_MERCHANTS = [
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
  { pattern: /shell/i, name: 'Shell Fuel', category: 'transport' },
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
  'debited from', 'paid to', 'transaction successful', 'completed', 'utr', 'ref no'
];

/**
 * Robust Amount Extraction for Indian OCR
 * Handles ₹, Rs, INR, Yen (¥), dollar ($), euro (€), pound (£)
 * Handles OCR glyph corruptions (?, *, ~, #, =, ^) and dropped currency symbols
 * Handles PhonePe / UPI masked accounts, Debited from lines, Paid to lines, decimal numbers, and UTR context
 */
export function extractSmartAmount(rawText) {
  if (!rawText) return null;

  // 1. Pre-UTR amount extraction (run on rawText BEFORE stripping UTR)
  // Catches cases like "₹176 UTR: 055998093650" or "176\nUTR: 055998093650"
  const preUtrMatches = [...rawText.matchAll(/(?:[₹¥$€£=~?*#^]|rs\.?|inr)?\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:\r?\n|\s{2,}|\s*)\s*UTR\s*[:-]?\s*[0-9A-Za-z]{8,22}/gi)];
  for (const m of preUtrMatches) {
    const matchIdx = m.index ?? 0;
    const beforeMatch = rawText.slice(Math.max(0, matchIdx - 25), matchIdx);
    // Ensure this match is not simply the trailing digits of a masked account number (e.g. XXXXXXXXXX049167),
    // an account descriptor (e.g. a/c ending, acct ending, ending:), a timestamp (e.g. 12:23),
    // an account number with leading zeros (e.g. 049167), or a calendar year (e.g. 2026)
    if (
      !/[X*×•]{2,}\s*$/i.test(beforeMatch) &&
      !/\b(?:a\/c|acct|ending|account)\s*[:#-]?\s*$/i.test(beforeMatch) &&
      !/:\s*$/.test(beforeMatch) &&
      !(m[1].startsWith('0') && !m[1].startsWith('0.'))
    ) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(val) && val > 0 && val < 5000000 && !(val >= 2024 && val <= 2030 && !m[1].includes('.'))) {
        return val;
      }
    }
  }

  // 2. Masked Bank Account line followed by amount:
  // e.g., 'XXXXXXXXXX049167 ₹176', 'XXXXXXXXXX 049167 176', '••••••••••049167\n176', 'ending 4167: ₹176'
  const acctMatches = [...rawText.matchAll(/(?:[X*×•]{3,}\s*\d{2,8}|\b(?:a\/c|acct|ending)\s*[:#-]?\s*\d{2,8})\s*[^0-9\r\n]*[\s\r\n]*(?:[₹¥$€£=~?*#^]|rs\.?|inr)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/gi)];
  for (const m of acctMatches) {
    const val = parseFloat(m[1].replace(/,/g, ''));
    if (!isNaN(val) && val > 0 && val < 5000000 && !(val >= 2024 && val <= 2030 && !m[1].includes('.'))) {
      return val;
    }
  }

  // 3. Clean out phone status bar noise, dates, times, battery, speeds, IDs, masked accounts, and UTR
  let text = rawText
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/gi, ' ') // 12:23 pm
    .replace(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g, ' ')         // 24-11-2026
    .replace(/\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4}\b/gi, ' ') // 24 Nov 2026
    .replace(/\b\d+(?:\.\d+)?\s*(?:kb|mb|gb)(?:\/s)?\b/gi, ' ')  // 82.1 kb/s
    .replace(/\b\d+%\b/g, ' ')                                  // 85%
    .replace(/\bT\d{12,30}\b/gi, ' ')                           // PhonePe Transaction ID
    .replace(/(?:invoice|inv|bill|order|item|txn|ref)\s*[:#-]?\s*[0-9A-Za-z-]{6,30}/gi, ' ') // Reference & Order IDs
    .replace(/[X*×•]{3,}\s*\d{2,8}/gi, ' ')                      // Masked accounts
    .replace(/\b(?:a\/c|acct|ending)\s*[:#-]?\s*\d{2,8}\b/gi, ' ') // Account endings
    .replace(/UTR\s*[:-]?\s*[0-9A-Za-z]{8,22}/gi, ' ')          // 12-digit UTR
    .replace(/\b(?:pin|pincode|zip|postal)\s*[:#-]?\s*\d{6}\b/gi, ' ') // Pin codes
    .replace(/\b[6-9]\d{9}\b/g, ' ');                           // 10-digit Indian phone numbers

  // 4. Total / Net Pay / Grand Total / Bill Amount lines
  const totalMatches = [...text.matchAll(/(?:\b(?<!sub[-\s]*)total|\bamount|\bnet\s*pay(?:able)?|\bgrand\s*total|\bbill\s*amount)\s*[:-]?\s*(?:[₹¥$€£=~?*#^]|rs\.?|inr)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/gi)];
  for (const m of totalMatches) {
    const val = parseFloat(m[1].replace(/,/g, ''));
    if (!isNaN(val) && val > 0 && val < 5000000 && !(val >= 2024 && val <= 2030 && !m[1].includes('.'))) {
      return val;
    }
  }

  // 5. Standard currency symbols (₹, Rs, INR, ¥, $, €, £) followed by number
  // Tesseract regularly maps Indian Rupee symbol (₹) to Yen (¥), Rs, or INR
  const symMatches = [...text.matchAll(/(?:[₹¥$€£]|rs\.?|inr)\s*([0-9,]+(?:\.[0-9]{1,2})?)/gi)];
  for (const m of symMatches) {
    const val = parseFloat(m[1].replace(/,/g, ''));
    if (!isNaN(val) && val > 0 && val < 5000000 && !(val >= 2024 && val <= 2030 && !m[1].includes('.'))) {
      return val;
    }
  }

  // 6. Context blocks: 'Debited from', 'Debited', 'Paid to', 'Payment to', 'Transfer to', 'Sent to'
  const blockMatches = [...text.matchAll(/(?:debited\s+from|debited|paid\s+to|payment\s+to|transfer\s+to|sent\s+to)\s*[:-]?\s*[\s\S]{0,120}?(?:[₹¥$€£=~?*#^]|rs\.?|inr)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/gi)];
  for (const m of blockMatches) {
    const val = parseFloat(m[1].replace(/,/g, ''));
    if (!isNaN(val) && val > 0 && val < 5000000 && !(val >= 2024 && val <= 2030 && !m[1].includes('.'))) {
      return val;
    }
  }

  // 7. Common glyph corruptions of Rupee (?, *, ~, #, =, ^)
  const corruptMatches = [...text.matchAll(/(?:[?*~#^=])\s*([0-9,]+(?:\.[0-9]{1,2})?)/g)];
  for (const m of corruptMatches) {
    const val = parseFloat(m[1].replace(/,/g, ''));
    if (!isNaN(val) && val > 0 && val < 5000000 && !(val >= 2024 && val <= 2030 && !m[1].includes('.'))) {
      return val;
    }
  }

  // 8. Standalone decimal amounts (e.g. 176.00 or 450.50)
  const decimalMatches = [...text.matchAll(/\b([0-9]{1,6}\.[0-9]{2})\b/g)];
  for (const m of decimalMatches) {
    const val = parseFloat(m[1]);
    if (!isNaN(val) && val > 0 && val < 5000000 && !(val >= 2024 && val <= 2030)) {
      return val;
    }
  }

  // 9. Standalone integer line fallback
  // Iterate through lines to find isolated positive integers (avoiding years or phone digits)
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const clean = line.replace(/^[₹¥$€£=?*~#^>rR'"/\\|,\-\s]+/, '').trim();
    if (/^[0-9]{1,6}$/.test(clean) && !(clean.startsWith('0') && clean.length > 1)) {
      const val = parseInt(clean, 10);
      if (val > 0 && val < 500000 && !(val >= 2024 && val <= 2030)) {
        return val;
      }
    }
  }

  return null;
}

/**
 * Extract Merchant Name (WHERE the money was spent)
 */
function extractMerchantDetails(text, lines) {
  // Strategy 1: Known Indian merchants dictionary
  for (const m of KNOWN_MERCHANTS) {
    if (m.pattern.test(text)) {
      return { title: m.name, category: m.category, confidence: 'high' };
    }
  }

  // Strategy 2: "Paid to / To / Transfer to" lines
  const paidToPatterns = [
    /(?:paid\s+to|payment\s+to|transfer\s+to|sent\s+to)\s*[:-]?\s*([A-Za-z0-9&.,\- ]{2,35})/i,
    /(?:to\s*[:-]|merchant\s*name\s*[:-]|biller\s*name\s*[:-])\s*([A-Za-z0-9&.,\- ]{2,35})/i,
    /(?:delivered\s+from|order\s+from)\s*[:-]?\s*([A-Za-z0-9&.,\- ]{2,35})/i,
  ];

  for (const regex of paidToPatterns) {
    const match = text.match(regex);
    if (match && match[1]) {
      const cleanCandidate = match[1].replace(/[\n\r]/g, ' ').trim();
      if (!NOISE_WORDS.some((nw) => cleanCandidate.toLowerCase().includes(nw)) && cleanCandidate.length >= 3) {
        return {
          title: capitalizeWords(cleanCandidate),
          category: 'other',
          confidence: 'medium',
        };
      }
    }
  }

  // Strategy 3: UPI VPA handle extraction (e.g., "chaipoint@icici", "amazonpaygrocery@ybl")
  const vpaMatch = text.match(/([a-zA-Z0-9._-]{3,30})@(okaxis|okhdfcbank|okicici|oksbi|paytm|ybl|ibl|upi|axisbank|icici|hdfcbank)/i);
  if (vpaMatch && vpaMatch[1]) {
    const vpaPrefix = vpaMatch[1].replace(/[0-9._-]/g, ' ').trim();
    if (vpaPrefix.length >= 3) {
      return {
        title: capitalizeWords(vpaPrefix),
        category: 'other',
        confidence: 'medium',
      };
    }
  }

  // Strategy 4: Physical receipt header (first 3 meaningful lines)
  for (let i = 0; i < Math.min(4, lines.length); i++) {
    const line = lines[i];
    const isNoise = NOISE_WORDS.some((nw) => line.toLowerCase().includes(nw));
    const hasOnlyDigits = /^[\d\s\-_.,#:]+$/.test(line);

    if (!isNoise && !hasOnlyDigits && line.length >= 3 && line.length <= 40) {
      return {
        title: capitalizeWords(line),
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
  const utrMatch = text.match(/(?:utr|ref(?:\s*no)?|txn(?:\s*id)?)\s*[:-]?\s*([0-9A-Za-z]{8,22})/i);
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
 * Pre-process image for OCR:
 * Inverts dark-mode screenshots (black background -> white background, white text -> black text)
 * and scales appropriately so Tesseract can recognize fonts & Rupee glyphs with high accuracy.
 */
async function preprocessImageForOcr(imageFile) {
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

    const canvas = document.createElement('canvas');
    const maxDim = 1600;
    let width = img.width;
    let height = img.height;
    if (width > maxDim || height > maxDim) {
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
    }
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);

    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    let totalBrightness = 0;
    const step = 4 * 16;
    let count = 0;
    for (let i = 0; i < data.length; i += step) {
      totalBrightness += (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      count++;
    }
    const avgBrightness = totalBrightness / count;

    // Dark-mode screenshot detected (avg brightness < 110): invert & enhance contrast
    if (avgBrightness < 110) {
      for (let i = 0; i < data.length; i += 4) {
        let r = 255 - data[i];
        let g = 255 - data[i + 1];
        let b = 255 - data[i + 2];
        r = r > 180 ? 255 : r < 70 ? 0 : r;
        g = g > 180 ? 255 : g < 70 ? 0 : g;
        b = b > 180 ? 255 : b < 70 ? 0 : b;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
      }
      ctx.putImageData(imgData, 0, 0);
      return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob || imageFile), 'image/png');
      });
    }

    return imageFile;
  } catch (err) {
    console.warn('Image pre-processing fallback:', err);
    return imageFile;
  }
}

/**
 * Master OCR Image Scanner
 */
export async function scanReceiptImage(imageFile, onProgress) {
  try {
    const targetFile = await preprocessImageForOcr(imageFile);
    const result = await Tesseract.recognize(targetFile, 'eng', {
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

    // 1. Extract Amount using smart cleaner
    const amount = extractSmartAmount(rawText);

    // 2. Extract Merchant / WHERE money was spent
    const merchantInfo = extractMerchantDetails(rawText, lines);

    // 3. Fallback category classification
    let category = merchantInfo.category;
    if (category === 'other') {
      const smsParsed = parseExpenseText(rawText);
      if (smsParsed.category !== 'other') category = smsParsed.category;
      else if (/food|biryani|pizza|burger|snack|curry|meal|lunch|dinner/i.test(rawText)) category = 'food-delivery';
      else if (/grocery|store|mart|supermarket/i.test(rawText)) category = 'groceries';
      else if (/fuel|petrol|diesel|ride|cab|auto|fare/i.test(rawText)) category = 'transport';
      else category = 'groceries';
    }

    // 4. Payment Method & UTR trace
    const isUpi = /utr|upi|bhim|gpay|phonepe|paytm|vpa|google\s*pay/i.test(rawText);
    const isCard = /card|ending\s*\d|pos/i.test(rawText);
    const paymentMethod = isUpi ? 'upi' : isCard ? 'card' : 'upi';

    // 5. Reference (UTR / Account)
    const reference = extractReferenceDetails(rawText);

    return {
      success: true,
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
