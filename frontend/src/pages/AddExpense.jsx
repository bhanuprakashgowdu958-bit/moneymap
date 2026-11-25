import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { addExpense, getBudgets, getMonthlyStats } from '../lib/firestore';
import { buildBudgetAlert } from '../lib/budgetAlerts';
import { uploadToCloudinary } from '../lib/cloudinary';
import { parseExpenseText } from '../lib/smsParser';
import { scanReceiptImage } from '../lib/ocrScanner';
import { CATEGORIES, INCOME_CATEGORIES, PAYMENT_METHODS, getCategoryMeta } from '../lib/constants';
import toast from 'react-hot-toast';

/**
 * Sanitize any amount input (number, formatted string, or OCR output)
 * into a clean numeric string valid for <input type="number">.
 * Returns '' if invalid or <= 0.
 */
function sanitizeAmount(val) {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number') {
    return isNaN(val) || val <= 0 ? '' : String(val);
  }
  const str = String(val).trim();
  if (str.startsWith('-')) return '';
  // Strip leading currency codes like Rs., INR, etc.
  const withoutCurrency = str.replace(/^(?:rs\.?|inr|₹|¥|\$|€|£)\s*/i, '');
  const cleaned = withoutCurrency.replace(/[^0-9.]/g, '');
  const num = parseFloat(cleaned);
  return !isNaN(num) && num > 0 ? String(num) : '';
}

export default function AddExpense() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const paramDate = searchParams.get('date');
  const initialDate = paramDate && /^\d{4}-\d{2}-\d{2}$/.test(paramDate)
    ? paramDate
    : new Date().toISOString().split('T')[0];
  const { user, currency } = useAuth();
  const [loading, setLoading] = useState(false);
  const [magicInput, setMagicInput] = useState('');
  const [parsedInfo, setParsedInfo] = useState(null);

  // Receipt & OCR states
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptPreview, setReceiptPreview] = useState(null);
  const [isScanningOcr, setIsScanningOcr] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrDetected, setOcrDetected] = useState(null);
  const fileRef = useRef();

  const hasGeminiKey = Boolean(
    typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GEMINI_API_KEY
  );

  const [form, setForm] = useState({
    type:          'expense',
    title:         '',
    amount:        '',
    category:      'food-delivery',
    date:          initialDate,
    paymentMethod: 'upi',
    note:          '',
    isRecurring:   false,
  });
  const [budgetMap, setBudgetMap] = useState({});
  const [spentMap, setSpentMap] = useState({});

  useEffect(() => {
    if (!user?.uid) return;
    const d = new Date(form.date || initialDate);
    if (isNaN(d.getTime())) return;
    const m = d.getMonth() + 1;
    const y = d.getFullYear();

    Promise.all([getBudgets(user.uid, m, y), getMonthlyStats(user.uid, m, y)])
      .then(([buds, stats]) => {
        const bMap = {};
        buds.forEach((b) => { bMap[b.category] = b; });
        const sMap = {};
        stats.stats.forEach((s) => { sMap[s._id] = s.total; });
        setBudgetMap(bMap);
        setSpentMap(sMap);
      })
      .catch(() => {});
  }, [user, form.date, initialDate]);

  // Handle Magic SMS / Smart Text input
  const handleMagicTextChange = (text) => {
    setMagicInput(text);
    if (!text.trim()) {
      setParsedInfo(null);
      return;
    }

    const parsed = parseExpenseText(text);
    if (parsed && (parsed.amount || !['Expense', 'Income', 'Bank Debit Expense'].includes(parsed.title))) {
      setParsedInfo(parsed);
      const nextType = parsed.type === 'income' ? 'income' : 'expense';
      const activeCats = nextType === 'income' ? INCOME_CATEGORIES : CATEGORIES;
      setForm((prev) => ({
        ...prev,
        type:          nextType,
        amount:        parsed.amount || prev.amount,
        title:         parsed.title !== 'Bank Debit Expense' && parsed.title !== 'Expense' ? parsed.title : prev.title,
        category:      activeCats[parsed.category] ? parsed.category : (nextType === 'income' ? 'upi-received' : prev.category),
        paymentMethod: parsed.paymentMethod || prev.paymentMethod,
        date:          parsed.date || prev.date,
      }));
    }
  };

  // Paste from device clipboard
  const handlePasteClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          handleMagicTextChange(text);
          toast.success('Pasted & parsed from clipboard! ✨');
        } else {
          toast.error('Clipboard is empty');
        }
      } else {
        toast.error('Clipboard permission not available in this browser');
      }
    } catch {
      toast.error('Please paste manually into the box');
    }
  };

  // Handle Receipt Upload & Trigger Auto-OCR Amount Extraction
  const handleReceiptChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Reset file input value so selecting the same file again triggers onChange
    if (e.target) e.target.value = '';

    setReceiptFile(file);
    setReceiptPreview(URL.createObjectURL(file));
    setOcrDetected(null);
    setIsScanningOcr(true);
    setOcrProgress(10);

    try {
      const data = await scanReceiptImage(file, (pct) => setOcrProgress(pct));
      if (data) {
        // Authenticity Check: If image is NOT a payment receipt/bill (e.g. terminal logs, memes, code errors)
        if (!data.isReceipt) {
          setOcrDetected({
            isReceipt: false,
            message: 'Image is not a payment receipt or bill.',
            rawText: data.rawText,
          });
          toast('Not a payment receipt or bill. Please enter the amount manually.', {
            icon: '⚠️',
            duration: 5000,
          });
          return;
        }

        const detectedAmt = sanitizeAmount(data.amount);

        const resolvedData = {
          ...data,
          amount: detectedAmt || data.amount,
        };
        setOcrDetected(resolvedData);

        setForm((prev) => ({
          ...prev,
          amount:        detectedAmt || prev.amount,
          title:         data.title && data.title !== 'Scanned Expense' ? data.title : prev.title,
          category:      data.category || prev.category,
          paymentMethod: data.paymentMethod || prev.paymentMethod,
          note:          data.reference ? (prev.note ? `${prev.note} • ${data.reference}` : data.reference) : prev.note,
        }));

        if (detectedAmt) {
          toast.success(`🎉 Auto-filled: ${currency}${detectedAmt} for ${data.title}!`, { duration: 5000 });
        } else {
          toast(`Detected ${data.title}! Please enter the amount spent.`, { icon: '💡' });
        }
      }
    } catch (err) {
      console.warn('OCR detection notice:', err);
      toast('Receipt attached! Please type in the amount.', { icon: '📷' });
    } finally {
      setIsScanningOcr(false);
    }
  };

  const handleQuickAddAmount = (val) => {
    setForm((prev) => ({
      ...prev,
      amount: String((Number(prev.amount) || 0) + val),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanAmt = sanitizeAmount(form.amount);
    const numAmount = Number(cleanAmt);
    if (!cleanAmt || isNaN(numAmount) || numAmount <= 0) {
      return toast.error(
        form.type === 'income' ? 'Please enter the amount received' : 'Please enter the amount spent',
        { icon: '⚠️' }
      );
    }
    const isIncome = form.type === 'income';
    const catMeta = getCategoryMeta(form.category, form.type);
    const finalTitle = form.title.trim() || catMeta?.label || (isIncome ? 'Income' : 'Expense');
    setLoading(true);
    try {
      let receiptUrl = '';
      let receiptPublicId = '';

      if (receiptFile) {
        toast.loading('Uploading receipt to Cloudinary...', { id: 'receipt' });
        const result = await uploadToCloudinary(receiptFile, 'moneymap/receipts');
        receiptUrl      = result.url;
        receiptPublicId = result.publicId;
        toast.dismiss('receipt');
      }

      await addExpense(user.uid, {
        ...form,
        title: finalTitle,
        amount: numAmount,
        receiptUrl,
        receiptPublicId,
      });

      if (isIncome) {
        toast.success('Income added! 💰');
      } else {
        const postAlert = buildBudgetAlert(
          budgetMap[form.category],
          (spentMap[form.category] || 0) + numAmount,
          currency
        );
        if (postAlert) {
          toast(postAlert.message, {
            icon: postAlert.level === 'over' ? '🚨' : '⚠️',
            duration: 6000,
          });
        } else {
          toast.success('Expense added! 💸');
        }
      }
      navigate('/expenses');
    } catch (err) {
      toast.dismiss('receipt');
      toast.error(err.message || 'Failed to add expense');
    } finally {
      setLoading(false);
    }
  };

  const isIncome = form.type === 'income';
  const activeCategories = isIncome ? INCOME_CATEGORIES : CATEGORIES;
  const selectedCat = getCategoryMeta(form.category, form.type);
  const pendingAmount = Number(sanitizeAmount(form.amount)) || 0;
  const projectedAlert = !isIncome
    ? buildBudgetAlert(
        budgetMap[form.category],
        (spentMap[form.category] || 0) + pendingAmount,
        currency
      )
    : null;

  const handleTypeSwitch = (nextType) => {
    if (nextType === form.type) return;
    setForm((prev) => ({
      ...prev,
      type: nextType,
      category: nextType === 'income' ? 'upi-received' : 'food-delivery',
    }));
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
            {isIncome ? 'Add Income' : 'Add Expense'}
          </h1>
          <p className="text-gray-500 text-xs sm:text-sm mt-0.5">Track money received and money spent accurately</p>
        </div>

        {/* Expense / Income Segmented Switch */}
        <div className="grid grid-cols-2 gap-1.5 bg-white p-1 rounded-xl border border-gray-200 shadow-sm w-full sm:w-auto">
          <button
            type="button"
            onClick={() => handleTypeSwitch('expense')}
            className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
              !isIncome ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            💸 Expense
          </button>
          <button
            type="button"
            onClick={() => handleTypeSwitch('income')}
            className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
              isIncome ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            💰 Income
          </button>
        </div>
      </div>

      {/* ⚡ MAGIC SMS / BANK ALERT PARSER CARD */}
      <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 rounded-2xl p-4 sm:p-5 text-white shadow-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-2.5 gap-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xl">✨</span>
            <span className="font-bold text-sm tracking-wide">Magic Auto-Fill Bar</span>
          </div>
          <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-xs bg-white/20 hover:bg-white/30 text-white font-semibold px-3 py-2.5 sm:py-1.5 rounded-xl sm:rounded-lg transition-all flex items-center justify-center gap-1.5 backdrop-blur-sm shadow-sm active:scale-95"
            >
              📷 Scan Receipt
            </button>
            <button
              type="button"
              onClick={handlePasteClipboard}
              className="text-xs bg-white/20 hover:bg-white/30 text-white font-semibold px-3 py-2.5 sm:py-1.5 rounded-xl sm:rounded-lg transition-all flex items-center justify-center gap-1.5 backdrop-blur-sm shadow-sm active:scale-95"
            >
              📋 Paste SMS
            </button>
          </div>
        </div>

        <p className="text-xs text-blue-100 mb-3 leading-relaxed">
          Paste any Bank SMS, UPI notification, or type naturally like <em>"Swiggy dinner 450 UPI"</em>. We'll extract everything automatically!
        </p>

        <textarea
          rows={2}
          value={magicInput}
          onChange={(e) => handleMagicTextChange(e.target.value)}
          placeholder="Paste SMS here: 'Sent Rs. 350.00 to ZOMATO on 24-Nov via UPI...'"
          className="w-full bg-white/10 text-white placeholder-blue-200/70 border border-white/20 rounded-xl px-3.5 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-white/40 resize-none font-mono"
        />

        {parsedInfo && (
          <div className="mt-3 bg-white/20 backdrop-blur-md rounded-xl p-2.5 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-emerald-300 flex items-center gap-1">
              ✓ Auto-detected:
            </span>
            {parsedInfo.amount && (
              <span className="bg-white/30 px-2 py-0.5 rounded-md font-bold text-white">
                {currency}{parsedInfo.amount}
              </span>
            )}
            {parsedInfo.title && (
              <span className="bg-white/20 px-2 py-0.5 rounded-md text-blue-100">
                {parsedInfo.title}
              </span>
            )}
            <span className="bg-white/20 px-2 py-0.5 rounded-md font-semibold text-white">
              {parsedInfo.type === 'income' ? '💰 Income' : '💸 Expense'}
            </span>
            <span className="bg-white/20 px-2 py-0.5 rounded-md text-blue-100">
              {getCategoryMeta(parsedInfo.category, parsedInfo.type)?.icon} {getCategoryMeta(parsedInfo.category, parsedInfo.type)?.label}
            </span>
            <span className="bg-white/20 px-2 py-0.5 rounded-md uppercase tracking-wider text-[10px]">
              {parsedInfo.paymentMethod}
            </span>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="card space-y-5">
        {/* Amount - hero field */}
        <div className="text-center py-5 px-6 bg-gray-50 rounded-2xl overflow-hidden">
          {/* Subtle OCR success or warning banner inside amount container */}
          {ocrDetected && ocrDetected.isReceipt === false ? (
            <div className="-mx-6 -mt-5 mb-4 bg-amber-500 text-white text-xs font-semibold py-1.5 px-3 flex items-center justify-center gap-1.5 shadow-sm">
              <span>⚠️</span> Not recognized as a payment receipt — please enter the amount manually
            </div>
          ) : ocrDetected && sanitizeAmount(ocrDetected.amount) ? (
            <div className="-mx-6 -mt-5 mb-4 bg-emerald-600 text-white text-xs font-semibold py-1.5 px-3 flex items-center justify-center gap-1.5 shadow-sm">
              <span>✨</span> Auto-detected: {currency}{sanitizeAmount(ocrDetected.amount)} spent at <strong>{ocrDetected.title}</strong> ({CATEGORIES[ocrDetected.category]?.label || ocrDetected.category})
            </div>
          ) : ocrDetected && ocrDetected.title ? (
            <div className="-mx-6 -mt-5 mb-4 bg-blue-600 text-white text-xs font-semibold py-1.5 px-3 flex items-center justify-center gap-1.5 shadow-sm">
              <span>📍</span> Detected: <strong>{ocrDetected.title}</strong> — please enter the amount below
            </div>
          ) : null}

          <p className="text-sm text-gray-500 mb-2 font-medium mt-1">
            {isIncome ? 'Amount Received' : 'Amount Spent'}
          </p>
          <div className="flex items-center justify-center gap-1.5">
            <span className="text-2xl sm:text-3xl font-bold text-gray-400">{currency}</span>
            <input
              type="number"
              inputMode="decimal"
              className="text-4xl sm:text-5xl font-bold text-gray-900 bg-transparent border-none outline-none text-center w-full max-w-[190px] sm:max-w-[210px] placeholder:text-gray-300 tabular-nums"
              placeholder="0"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              min="0.01"
              step="0.01"
            />
          </div>

          {/* Quick Apply Auto-detected badge if available */}
          {ocrDetected && sanitizeAmount(ocrDetected.amount) && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => {
                  const amt = sanitizeAmount(ocrDetected.amount);
                  if (amt) setForm((prev) => ({ ...prev, amount: amt }));
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 rounded-full text-xs font-semibold text-emerald-800 transition-all shadow-sm active:scale-95"
              >
                <span>✨ Auto-detected:</span>
                <span className="font-bold underline">{currency}{sanitizeAmount(ocrDetected.amount)}</span>
                <span className="text-[10px] text-emerald-700 bg-white/80 px-1.5 py-0.5 rounded font-normal">
                  {form.amount === sanitizeAmount(ocrDetected.amount) ? 'Applied ✓' : 'Tap to apply'}
                </span>
              </button>
            </div>
          )}

          {/* Quick amount chips */}
          <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
            {[50, 100, 200, 500, 1000].map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => handleQuickAddAmount(val)}
                className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 transition-all shadow-sm"
              >
                +{currency}{val}
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="label">{isIncome ? 'Where did you receive it from?' : 'What did you spend on?'}</label>
          <input
            type="text"
            className="input-field"
            placeholder={isIncome ? 'e.g. From Rahul, Monthly Salary, Amazon Refund...' : 'e.g. Zomato dinner, Uber ride, Blinkit...'}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>

        {/* Category Grid */}
        <div>
          <label className="label">Category</label>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {Object.entries(activeCategories).map(([key, cat]) => (
              <button
                key={key}
                type="button"
                onClick={() =>
                  setForm((prev) => {
                    const prevCatLabel = activeCategories[prev.category]?.label;
                    const shouldAutoFill = !prev.title.trim() || prev.title === prevCatLabel;
                    return {
                      ...prev,
                      category: key,
                      title: shouldAutoFill ? cat.label : prev.title,
                    };
                  })
                }
                className={`flex flex-col items-center justify-center gap-1 p-2.5 sm:p-3 min-h-[72px] rounded-xl border-2 transition-all text-[11px] sm:text-xs font-medium active:scale-95 ${
                  form.category === key
                    ? isIncome
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm scale-[1.02]'
                      : 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm scale-[1.02]'
                    : 'border-gray-100 bg-gray-50 text-gray-600 hover:border-gray-200 hover:bg-white'
                }`}
              >
                <span className="text-xl sm:text-2xl">{cat.icon}</span>
                <span className="text-center leading-tight">{cat.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Date and Payment */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <div>
            <label className="label">Date</label>
            <input
              type="date"
              className="input-field"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">Payment Method</label>
            <select
              className="input-field"
              value={form.paymentMethod}
              onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.icon} {m.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Receipt Upload & Auto-Scan (Cloudinary + Tesseract OCR) */}
        <div>
          <label className="label flex flex-wrap items-center justify-between gap-1.5">
            <span>Receipt Photo or Payment Screenshot (Auto-Detects Amount)</span>
            <span className={`text-xs font-medium ${ocrDetected?.isAiVision || hasGeminiKey ? 'text-primary' : 'text-blue-600'}`}>
              {ocrDetected?.isAiVision ? '✨ Gemini AI Vision Active' : hasGeminiKey ? '✨ Gemini AI Vision Ready' : 'AI OCR Scanner Active'}
            </span>
          </label>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            ref={fileRef}
            onChange={handleReceiptChange}
          />
          {receiptPreview ? (
            <div className="relative border border-gray-200 rounded-2xl overflow-hidden bg-gray-900">
              <img
                src={receiptPreview}
                alt="Receipt"
                className={`w-full max-h-56 object-contain mx-auto transition-opacity ${
                  isScanningOcr ? 'opacity-40' : 'opacity-100'
                }`}
              />

              {/* Scanning Overlay Animation */}
              {isScanningOcr && (
                <div className="absolute inset-0 bg-blue-900/60 backdrop-blur-sm flex flex-col items-center justify-center text-white p-4">
                  <div className="w-10 h-10 border-3 border-white border-t-transparent rounded-full animate-spin mb-3"></div>
                  <p className="font-semibold text-sm">Scanning Screenshot for Amount...</p>
                  <p className="text-xs text-blue-200 mt-1">Reading payment & debit details ({ocrProgress}%)</p>
                  <div className="w-48 bg-white/20 rounded-full h-1.5 mt-3 overflow-hidden">
                    <div
                      className="bg-white h-full transition-all duration-300 rounded-full"
                      style={{ width: `${Math.max(15, ocrProgress)}%` }}
                    />
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setReceiptFile(null);
                  setReceiptPreview(null);
                  setOcrDetected(null);
                  if (fileRef.current) fileRef.current.value = '';
                }}
                className="absolute top-2 right-2 bg-red-500/90 hover:bg-red-600 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs shadow transition-all"
              >
                ✕
              </button>

              <div className="p-2.5 bg-gray-50 flex items-center justify-between text-xs border-t border-gray-100">
                <span className="text-gray-500 flex items-center gap-1.5">
                  ☁️ Will be saved to Cloudinary
                </span>
                {ocrDetected && ocrDetected.isReceipt === false ? (
                  <span className="text-amber-800 font-medium flex items-center gap-1 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-md">
                    ⚠️ Not a payment receipt
                  </span>
                ) : ocrDetected && sanitizeAmount(ocrDetected.amount) ? (
                  <span className="text-emerald-700 font-semibold flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded-md">
                    {ocrDetected.isAiVision ? '✨ Gemini AI: ' : '✓ '}Amount auto-filled: {currency}{sanitizeAmount(ocrDetected.amount)}
                  </span>
                ) : ocrDetected && ocrDetected.title ? (
                  <span className="text-blue-700 font-semibold flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded-md">
                    ✓ Scanned: {ocrDetected.title}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="text-blue-600 hover:underline font-medium"
                  >
                    Change photo
                  </button>
                )}
              </div>

              {ocrDetected?.rawText && (
                <details className="p-2.5 bg-gray-50/70 border-t border-gray-100 text-[11px] text-gray-500">
                  <summary className="cursor-pointer font-medium text-blue-600 hover:text-blue-700">
                    🔍 View Scanned OCR Text
                  </summary>
                  <pre className="mt-2 p-2 bg-white rounded-lg border border-gray-200 overflow-x-auto whitespace-pre-wrap font-mono text-[10px] text-gray-700 max-h-36 overflow-y-auto">
                    {ocrDetected.rawText}
                  </pre>
                </details>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-gray-200 hover:border-blue-400 bg-gray-50/50 hover:bg-blue-50/50 rounded-2xl py-6 text-center transition-all group"
            >
              <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center mx-auto mb-2 text-xl group-hover:scale-110 transition-transform">
                📷
              </div>
              <p className="text-xs font-semibold text-gray-700">
                Attach UPI Debit Screenshot or Food Bill
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Auto-scans and fills the amount instantly • Saves to Cloudinary
              </p>
            </button>
          )}
        </div>

        {/* Note */}
        <div>
          <label className="label">Note (optional)</label>
          <textarea
            className="input-field resize-none"
            rows={2}
            placeholder="Any additional notes or split details..."
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </div>

        {/* Recurring toggle */}
        <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl hover:bg-gray-50 transition-colors">
          <div className="relative">
            <input
              type="checkbox"
              className="sr-only"
              checked={form.isRecurring}
              onChange={(e) => setForm({ ...form, isRecurring: e.target.checked })}
            />
            <div className={`w-10 h-6 rounded-full transition-colors ${form.isRecurring ? 'bg-blue-600' : 'bg-gray-200'}`}>
              <div className={`w-5 h-5 bg-white rounded-full shadow-sm transition-transform mt-0.5 mx-0.5 ${form.isRecurring ? 'translate-x-4' : ''}`} />
            </div>
          </div>
          <div>
            <span className="text-sm font-medium text-gray-700">Recurring monthly expense</span>
            <p className="text-xs text-gray-400">Mark if this auto-debits every month (Netflix, Rent, Wi-Fi)</p>
          </div>
        </label>

        {/* Live Budget Warning */}
        {projectedAlert && (
          <div
            className={`rounded-xl p-3 border text-xs flex items-start gap-2 ${
              projectedAlert.level === 'over' || projectedAlert.level === 'reached'
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            <span className="text-base leading-none">{projectedAlert.level === 'over' ? '🚨' : '⚠️'}</span>
            <div>
              <p className="font-bold">
                {projectedAlert.level === 'over' ? 'Over Monthly Budget!' : 'Budget Threshold Alert'}
              </p>
              <p className="mt-0.5">{projectedAlert.message}</p>
            </div>
          </div>
        )}

        {/* Submit Buttons */}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary flex-1">
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || isScanningOcr}
            className={`${isIncome ? 'bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 px-5 min-h-[44px] rounded-xl transition-all duration-200 shadow-sm hover:shadow-md active:scale-95' : 'btn-primary'} flex-1 flex items-center justify-center gap-2`}
          >
            {loading ? (
              <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span> Saving...</>
            ) : isScanningOcr ? (
              <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span> Scanning Receipt...</>
            ) : (
              `${isIncome ? 'Save Income' : 'Save Expense'} ${selectedCat?.icon || '💸'}`
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
