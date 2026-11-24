// Smart Bank Statement Parser (CSV, XLS, XLSX)
// 100% client-side — supports HDFC, SBI, ICICI, Axis, Kotak, Paytm, PhonePe & generic statements.

import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { parseExpenseText } from './smsParser';

const DATE_HEADERS = ['txn date', 'transaction date', 'value date', 'date', 'posting date', 'txndate'];
const DESC_HEADERS = [
  'narration', 'description', 'particulars', 'transaction remarks', 'remarks',
  'details', 'merchant', 'transaction details', 'title', 'memo'
];
const DEBIT_HEADERS = [
  'withdrawal amt.', 'withdrawal amt', 'withdrawal', 'debit', 'debit amount',
  'dr', 'withdrawal (dr)', 'debit(inr)', 'amount debited'
];
const CREDIT_HEADERS = [
  'deposit amt.', 'deposit amt', 'deposit', 'credit', 'credit amount',
  'cr', 'deposit (cr)', 'credit(inr)', 'amount credited'
];
const AMOUNT_HEADERS = ['amount', 'txn amount', 'transaction amount', 'amt'];
const TYPE_HEADERS = ['type', 'dr/cr', 'cr/dr', 'transaction type', 'drcr'];

/**
 * Normalize header string for matching
 */
function norm(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9/(). ]/g, '').trim();
}

/**
 * Parse numeric amount from strings like "1,499.50", "Rs. 450", "(200.00)"
 */
function parseNum(val) {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const str = String(val).replace(/[₹,$\s]|rs\.?|inr/gi, '').trim();
  if (!str || str === '-' || str === '--') return 0;
  const num = parseFloat(str.replace(/[()]/g, ''));
  return isNaN(num) ? 0 : num;
}

/**
 * Parse Indian & ISO date formats + Excel serial numbers
 */
function parseStatementDate(val) {
  if (!val) return null;

  // Excel serial date number (e.g., 45620)
  if (typeof val === 'number' && val > 25000 && val < 70000) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(excelEpoch.getTime() + val * 86400000);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  const str = String(val).trim();
  if (!str) return null;

  // DD/MM/YYYY or DD-MM-YYYY or DD/MM/YY
  const dmy = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?:\s.*)?$/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10) - 1;
    let year = parseInt(dmy[3], 10);
    if (year < 100) year += 2000;
    const d = new Date(year, month, day, 12, 0, 0);
    if (!isNaN(d.getTime()) && d.getDate() === day) return d.toISOString();
  }

  // DD MMM YYYY or DD-MMM-YYYY (e.g. "24 Nov 2026", "24-Nov-26")
  const dMonY = str.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{2,4})/);
  if (dMonY) {
    let year = parseInt(dMonY[3], 10);
    if (year < 100) year += 2000;
    const d = new Date(`${dMonY[1]} ${dMonY[2]} ${year} 12:00:00`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // YYYY-MM-DD or standard JS Date
  const fallback = new Date(str);
  if (!isNaN(fallback.getTime()) && fallback.getFullYear() >= 2000) {
    return fallback.toISOString();
  }

  return null;
}

/**
 * Clean noisy Indian bank narration into a readable merchant title
 * e.g. "UPI/DR/433190821890/SWIGGY/ICIC/swiggy@icici" -> "Swiggy"
 */
function cleanNarrationTitle(rawDesc, smsParsed) {
  if (!rawDesc) return 'Bank Expense';

  // If smsParser found a known brand/merchant name, prefer it
  if (smsParsed?.title && smsParsed.title !== 'Bank Debit Expense' && smsParsed.title !== 'Expense') {
    return smsParsed.title;
  }

  // Extract merchant segment from UPI slash format: UPI/DR/12345/MERCHANT/BANK/...
  if (/^upi[/\-]/i.test(rawDesc)) {
    const parts = rawDesc.split(/[/\-]/).map((p) => p.trim()).filter(Boolean);
    const candidate = parts.find(
      (p) =>
        p.length >= 3 &&
        !/^(upi|dr|cr|p2m|p2a|pay|imps|neft|rtgs)$/i.test(p) &&
        !/^\d+$/.test(p) &&
        !p.includes('@') &&
        !/^(hdfc|icic|sbin|axis|kkbk|utib|yesb|bar0|paytm)$/i.test(p)
    );
    if (candidate) {
      return candidate
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ')
        .slice(0, 40);
    }
  }

  // Strip card masks & long ref numbers
  const cleaned = rawDesc
    .replace(/\b(?:pos|upi|imps|neft|rtgs|ach|ecs)\b/gi, ' ')
    .replace(/[X*]{3,}\d+/g, ' ')
    .replace(/\b\d{8,}\b/g, ' ')
    .replace(/[/\\|_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length >= 2) {
    return cleaned.slice(0, 42);
  }
  return rawDesc.slice(0, 42);
}

/**
 * Find the header row index and map column indices
 */
function detectColumns(rows) {
  const maxScan = Math.min(rows.length, 35);

  for (let r = 0; r < maxScan; r++) {
    const row = rows[r];
    if (!Array.isArray(row) || row.length < 2) continue;

    const normalized = row.map(norm);
    const findCol = (candidates) =>
      normalized.findIndex((cell) => candidates.some((c) => cell === c || cell.includes(c)));

    const dateIdx = findCol(DATE_HEADERS);
    const descIdx = findCol(DESC_HEADERS);
    const debitIdx = findCol(DEBIT_HEADERS);
    const creditIdx = findCol(CREDIT_HEADERS);
    const amountIdx = findCol(AMOUNT_HEADERS);
    const typeIdx = findCol(TYPE_HEADERS);

    const hasAmountCol = debitIdx !== -1 || amountIdx !== -1;
    if (dateIdx !== -1 && hasAmountCol && (descIdx !== -1 || debitIdx !== -1)) {
      return { headerRow: r, dateIdx, descIdx, debitIdx, creditIdx, amountIdx, typeIdx };
    }
  }

  return null;
}

/**
 * Parse raw 2D rows into normalized debit transactions
 */
function extractTransactionsFromRows(rows, existingExpenses = []) {
  const cols = detectColumns(rows);
  if (!cols) {
    throw new Error(
      'Could not detect Date and Amount/Debit columns. Please upload a standard bank CSV or Excel statement.'
    );
  }

  const existingKeys = new Set(
    existingExpenses.map((e) => {
      const day = new Date(e.date).toISOString().split('T')[0];
      return `${day}_${Number(e.amount).toFixed(2)}`;
    })
  );

  const transactions = [];
  let skippedCredits = 0;
  let duplicateCount = 0;

  for (let i = cols.headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row) || row.length < 2) continue;

    const dateIso = parseStatementDate(row[cols.dateIdx]);
    if (!dateIso) continue; // Skip summary/footer/empty rows

    const rawDesc = cols.descIdx !== -1 ? String(row[cols.descIdx] || '').trim() : 'Bank Transaction';

    // Determine debit amount
    let debitAmount = 0;
    if (cols.debitIdx !== -1) {
      debitAmount = Math.abs(parseNum(row[cols.debitIdx]));
      const creditAmount = cols.creditIdx !== -1 ? Math.abs(parseNum(row[cols.creditIdx])) : 0;
      if (debitAmount <= 0) {
        if (creditAmount > 0) skippedCredits++;
        continue;
      }
    } else if (cols.amountIdx !== -1) {
      const rawAmt = parseNum(row[cols.amountIdx]);
      const typeStr = cols.typeIdx !== -1 ? norm(row[cols.typeIdx]) : '';
      if (typeStr === 'cr' || typeStr === 'credit' || typeStr.includes('deposit')) {
        skippedCredits++;
        continue;
      }
      if (rawAmt === 0) continue;
      // If no type column, negative numbers are debits; if all positive, treat positive as debit unless "credit" in desc
      if (typeStr === '' && /\b(?:refund|salary|interest\s+credited|cashback\s+received)\b/i.test(rawDesc)) {
        skippedCredits++;
        continue;
      }
      debitAmount = Math.abs(rawAmt);
    }

    if (debitAmount <= 0) continue;

    const smsParsed = parseExpenseText(`${rawDesc} Rs ${debitAmount}`);
    const title = cleanNarrationTitle(rawDesc, smsParsed);
    const dayKey = dateIso.split('T')[0];
    const isDuplicate = existingKeys.has(`${dayKey}_${debitAmount.toFixed(2)}`);
    if (isDuplicate) duplicateCount++;

    transactions.push({
      rowId: `stmt-${i}-${dayKey}-${debitAmount}`,
      title,
      rawDescription: rawDesc,
      amount: debitAmount,
      date: dateIso,
      category: smsParsed?.category || 'other',
      paymentMethod: smsParsed?.paymentMethod || 'upi',
      isDuplicate,
    });
  }

  return { transactions, skippedCredits, duplicateCount };
}

/**
 * Parse an uploaded CSV, XLS, or XLSX bank statement file
 * @param {File} file
 * @param {Array} existingExpenses
 * @returns {Promise<{ transactions: Array, skippedCredits: number, duplicateCount: number }>}
 */
export async function parseBankStatementFile(file, existingExpenses = []) {
  const name = file.name.toLowerCase();

  if (name.endsWith('.csv')) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        skipEmptyLines: true,
        complete: (results) => {
          try {
            resolve(extractTransactionsFromRows(results.data || [], existingExpenses));
          } catch (err) {
            reject(err);
          }
        },
        error: (err) => reject(new Error(err.message || 'Failed to read CSV file')),
      });
    });
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new Error('The uploaded Excel file has no sheets.');
    }
    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    return extractTransactionsFromRows(rows, existingExpenses);
  }

  throw new Error('Unsupported file format. Please upload a .csv, .xls, or .xlsx bank statement.');
}
