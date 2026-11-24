import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { addExpense } from '../lib/firestore';
import { uploadToCloudinary } from '../lib/cloudinary';
import { parseExpenseText } from '../lib/smsParser';
import { scanReceiptImage } from '../lib/ocrScanner';
import { CATEGORIES, PAYMENT_METHODS } from '../lib/constants';
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

  const [form, setForm] = useState({
    title:         '',
    amount:        '',
    category:      'food-delivery',
    date:          new Date().toISOString().split('T')[0],
    paymentMethod: 'upi',
    note:          '',
    isRecurring:   false,
  });

  // Handle Magic SMS / Smart Text input
  const handleMagicTextChange = (text) => {
    setMagicInput(text);
    if (!text.trim()) {
      setParsedInfo(null);
      return;
    }

    const parsed = parseExpenseText(text);
    if (parsed && (parsed.amount || parsed.title !== 'Expense')) {
      setParsedInfo(parsed);
      setForm((prev) => ({
        ...prev,
        amount:        parsed.amount || prev.amount,
        title:         parsed.title !== 'Bank Debit Expense' && parsed.title !== 'Expense' ? parsed.title : prev.title,
        category:      parsed.category !== 'other' ? parsed.category : prev.category,
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
      return toast.error('Please enter the amount spent', { icon: '⚠️' });
    }
    if (!form.title.trim()) {
      return toast.error('Please enter what you spent on (e.g. Grocery Store)', { icon: '⚠️' });
    }
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
        amount: numAmount,
        receiptUrl,
        receiptPublicId,
      });

      toast.success('Expense added! 💸');
      navigate('/expenses');
    } catch (err) {
      toast.dismiss('receipt');
      toast.error(err.message || 'Failed to add expense');
    } finally {
      setLoading(false);
    }
  };

  const selectedCat = CATEGORIES[form.category];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Add Expense</h1>
        <p className="text-gray-500 text-sm mt-0.5">Track every rupee automatically or manually</p>
      </div>

      {/* ⚡ MAGIC SMS / BANK ALERT PARSER CARD */}
      <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 rounded-2xl p-5 text-white shadow-md">
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xl">✨</span>
            <span className="font-bold text-sm tracking-wide">Magic Auto-Fill Bar</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-xs bg-white/20 hover:bg-white/30 text-white font-semibold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 backdrop-blur-sm shadow-sm"
            >
              📷 Upload Screenshot / Bill
            </button>
            <button
              type="button"
              onClick={handlePasteClipboard}
              className="text-xs bg-white/20 hover:bg-white/30 text-white font-semibold px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 backdrop-blur-sm shadow-sm"
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
            <span className="bg-white/20 px-2 py-0.5 rounded-md text-blue-100">
              {CATEGORIES[parsedInfo.category]?.icon} {CATEGORIES[parsedInfo.category]?.label}
            </span>
            <span className="bg-white/20 px-2 py-0.5 rounded-md uppercase tracking-wider text-[10px]">
              {parsedInfo.paymentMethod}
            </span>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="card space-y-5">
        {/* Amount - hero field */}
        <div className="text-center py-5 px-6 bg-gray-50 rounded-2xl relative overflow-hidden">
          {/* Subtle OCR success or warning banner inside amount container */}
          {ocrDetected && ocrDetected.isReceipt === false ? (
            <div className="absolute top-0 inset-x-0 bg-amber-500 text-white text-xs font-semibold py-1.5 px-3 flex items-center justify-center gap-1.5 shadow-sm">
              <span>⚠️</span> Not recognized as a payment receipt — please enter the amount manually
            </div>
          ) : ocrDetected && sanitizeAmount(ocrDetected.amount) ? (
            <div className="absolute top-0 inset-x-0 bg-emerald-600 text-white text-xs font-semibold py-1.5 px-3 flex items-center justify-center gap-1.5 shadow-sm">
              <span>✨</span> Auto-detected: {currency}{sanitizeAmount(ocrDetected.amount)} spent at <strong>{ocrDetected.title}</strong> ({CATEGORIES[ocrDetected.category]?.label || ocrDetected.category})
            </div>
          ) : ocrDetected && ocrDetected.title ? (
            <div className="absolute top-0 inset-x-0 bg-blue-600 text-white text-xs font-semibold py-1.5 px-3 flex items-center justify-center gap-1.5 shadow-sm">
              <span>📍</span> Detected: <strong>{ocrDetected.title}</strong> — please enter the amount below
            </div>
          ) : null}

          <p className="text-sm text-gray-500 mb-2 font-medium mt-1">Amount Spent</p>
          <div className="flex items-center justify-center gap-2">
            <span className="text-3xl font-bold text-gray-400">{currency}</span>
            <input
              type="number"
              className="text-5xl font-bold text-gray-900 bg-transparent border-none outline-none text-center w-52 placeholder:text-gray-300"
              placeholder="0"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              min="0.01"
              step="0.01"
              autoFocus
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
          <label className="label">What did you spend on?</label>
          <input
            type="text"
            className="input-field"
            placeholder="e.g. Zomato dinner, Uber ride, Blinkit..."
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>

        {/* Category Grid */}
        <div>
          <label className="label">Category</label>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {Object.entries(CATEGORIES).map(([key, cat]) => (
              <button
                key={key}
                type="button"
                onClick={() => setForm({ ...form, category: key })}
                className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all text-xs font-medium ${
                  form.category === key
                    ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm scale-[1.02]'
                    : 'border-gray-100 bg-gray-50 text-gray-600 hover:border-gray-200 hover:bg-white'
                }`}
              >
                <span className="text-2xl">{cat.icon}</span>
                <span className="text-center leading-tight">{cat.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Date and Payment */}
        <div className="grid grid-cols-2 gap-4">
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
          <label className="label flex items-center justify-between">
            <span>Receipt Photo or Payment Screenshot (Auto-Detects Amount)</span>
            <span className={`text-xs font-medium ${ocrDetected?.isAiVision ? 'text-primary' : 'text-blue-600'}`}>
              {ocrDetected?.isAiVision ? '✨ Gemini AI Vision Active' : 'AI OCR Scanner Active'}
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

        {/* Submit Buttons */}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary flex-1">
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || isScanningOcr}
            className="btn-primary flex-1 flex items-center justify-center gap-2"
          >
            {loading ? (
              <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span> Saving...</>
            ) : isScanningOcr ? (
              <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span> Scanning Receipt...</>
            ) : (
              `Save Expense ${selectedCat?.icon || '💸'}`
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
