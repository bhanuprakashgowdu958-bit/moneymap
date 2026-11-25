import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getExpenses, updateExpense } from '../lib/firestore';
import { CATEGORIES, PAYMENT_METHODS, formatCurrency, formatDate } from '../lib/constants';
import toast from 'react-hot-toast';

function toDateInputValue(dateInput) {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Expenses() {
  const { user, currency } = useAuth();
  const [expenses, setExpenses] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [editForm, setEditForm] = useState({
    title: '',
    amount: '',
    category: 'other',
    date: '',
    paymentMethod: 'upi',
    note: '',
    isRecurring: false,
  });
  const now = new Date();
  const [filter, setFilter] = useState({ category: 'all', month: now.getMonth() + 1, year: now.getFullYear() });

  const fetchExpenses = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await getExpenses(user.uid, filter);
      setExpenses(data);
    } catch {
      toast.error('Failed to load expenses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchExpenses(); }, [filter, user]);

  useEffect(() => {
    if (!editing) return;
    const onKeyDown = (ev) => {
      if (ev.key === 'Escape' && !saving) setEditing(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, saving]);

  const openEditModal = (expense) => {
    const dateValue = toDateInputValue(expense.date);
    setEditing({ ...expense, originalDateValue: dateValue });
    setEditForm({
      title: expense.title || '',
      amount: expense.amount != null ? String(expense.amount) : '',
      category: CATEGORIES[expense.category] ? expense.category : 'other',
      date: dateValue,
      paymentMethod: PAYMENT_METHODS.some((p) => p.value === expense.paymentMethod)
        ? expense.paymentMethod
        : 'upi',
      note: expense.note || '',
      isRecurring: Boolean(expense.isRecurring),
    });
  };

  const handleSaveEdit = async (ev) => {
    ev.preventDefault();
    if (!editing) return;

    const numAmount = Number(editForm.amount);
    if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
      return toast.error('Please enter a valid amount');
    }
    if (!editForm.date) {
      return toast.error('Please select a date');
    }

    const finalTitle = editForm.title.trim() || CATEGORIES[editForm.category]?.label || 'Expense';
    const nextDate =
      editForm.date === editing.originalDateValue
        ? editing.date
        : `${editForm.date}T12:00:00`;

    const payload = {
      title: finalTitle,
      amount: numAmount,
      category: editForm.category,
      date: nextDate,
      paymentMethod: editForm.paymentMethod,
      note: editForm.note.trim(),
      isRecurring: editForm.isRecurring,
    };

    setSaving(true);
    try {
      await updateExpense(user.uid, editing.id, payload);
      const updatedDate = new Date(nextDate);
      const matchesFilter =
        updatedDate.getMonth() + 1 === Number(filter.month) &&
        updatedDate.getFullYear() === Number(filter.year) &&
        (filter.category === 'all' || filter.category === payload.category);

      setExpenses((prev) => {
        if (!matchesFilter) return prev.filter((item) => item.id !== editing.id);
        return prev
          .map((item) =>
            item.id === editing.id
              ? { ...item, ...payload, date: updatedDate }
              : item
          )
          .sort((a, b) => new Date(b.date) - new Date(a.date));
      });
      toast.success('Expense updated ✅');
      setEditing(null);
    } catch {
      toast.error('Failed to update expense');
    } finally {
      setSaving(false);
    }
  };

  const totalAmount = expenses.reduce((s, e) => s + e.amount, 0);
  const months = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: new Date(2000, i).toLocaleString('en-IN', { month: 'long' }) }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Expenses</h1>
        <p className="text-gray-500 text-sm mt-0.5">All your tracked spending in one place</p>
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <select className="input-field w-auto text-sm" value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })}>
            <option value="all">All Categories</option>
            {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
          <select className="input-field w-auto text-sm" value={filter.month} onChange={(e) => setFilter({ ...filter, month: Number(e.target.value) })}>
            {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <select className="input-field w-auto text-sm" value={filter.year} onChange={(e) => setFilter({ ...filter, year: Number(e.target.value) })}>
            {[2024, 2025, 2026].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <div className="ml-auto">
            <span className="text-sm text-gray-500">Total: </span>
            <span className="font-bold text-gray-900">{formatCurrency(totalAmount, currency)}</span>
            <span className="text-xs text-gray-400 ml-1">({expenses.length} entries)</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card flex items-center justify-center h-48">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : expenses.length === 0 ? (
        <div className="card text-center py-16">
          <div className="text-5xl mb-4">📋</div>
          <h3 className="text-lg font-semibold text-gray-700">No expenses found</h3>
          <p className="text-gray-400 text-sm mt-1">Try changing your filters or add a new expense</p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          {expenses.map((e, idx) => {
            const cat = CATEGORIES[e.category];
            return (
              <div key={e.id} className={`flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors ${idx < expenses.length - 1 ? 'border-b border-gray-100' : ''}`}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ backgroundColor: cat?.bgColor || '#f8fafc' }}>
                  {cat?.icon || '📦'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-800 truncate">{e.title}</p>
                    {e.isRecurring && <span className="badge-blue">🔄 Recurring</span>}
                    {e.receiptUrl && (
                      <a href={e.receiptUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline flex items-center gap-0.5">📷 Receipt</a>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-gray-400">{formatDate(e.date)}</span>
                    <span className="text-gray-200">·</span>
                    <span className="text-xs" style={{ color: cat?.textColor }}>{cat?.label}</span>
                    <span className="text-gray-200">·</span>
                    <span className="text-xs text-gray-400 capitalize">{PAYMENT_METHODS.find(p => p.value === e.paymentMethod)?.icon} {e.paymentMethod}</span>
                  </div>
                  {e.note && <p className="text-xs text-gray-400 mt-0.5 truncate">{e.note}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-bold text-gray-900">{formatCurrency(e.amount, currency)}</p>
                  <button
                    type="button"
                    onClick={() => openEditModal(e)}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors mt-0.5"
                  >
                    Edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => { if (!saving) setEditing(null); }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Edit Expense</h2>
              <button
                type="button"
                disabled={saving}
                onClick={() => setEditing(null)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="label text-xs">Title</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Expense title"
                  value={editForm.title}
                  onChange={(ev) => setEditForm({ ...editForm, title: ev.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">Amount ({currency})</label>
                  <input
                    type="number"
                    className="input-field"
                    min="0.01"
                    step="0.01"
                    value={editForm.amount}
                    onChange={(ev) => setEditForm({ ...editForm, amount: ev.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label text-xs">Date</label>
                  <input
                    type="date"
                    className="input-field"
                    value={editForm.date}
                    onChange={(ev) => setEditForm({ ...editForm, date: ev.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">Category</label>
                  <select
                    className="input-field"
                    value={editForm.category}
                    onChange={(ev) => setEditForm({ ...editForm, category: ev.target.value })}
                  >
                    {Object.entries(CATEGORIES).map(([k, v]) => (
                      <option key={k} value={k}>{v.icon} {v.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label text-xs">Payment Method</label>
                  <select
                    className="input-field"
                    value={editForm.paymentMethod}
                    onChange={(ev) => setEditForm({ ...editForm, paymentMethod: ev.target.value })}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>{m.icon} {m.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="label text-xs">Note</label>
                <textarea
                  className="input-field resize-none"
                  rows={2}
                  placeholder="Optional notes"
                  value={editForm.note}
                  onChange={(ev) => setEditForm({ ...editForm, note: ev.target.value })}
                />
              </div>

              <label className="flex items-center gap-2.5 cursor-pointer text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={editForm.isRecurring}
                  onChange={(ev) => setEditForm({ ...editForm, isRecurring: ev.target.checked })}
                />
                <span>Recurring monthly expense</span>
              </label>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setEditing(null)}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary flex-1"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
