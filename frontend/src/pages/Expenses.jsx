import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { deleteExpense, getExpenses } from '../lib/firestore';
import {
  CATEGORIES,
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
  formatCurrency,
  formatDate,
  getCategoryMeta,
} from '../lib/constants';
import toast from 'react-hot-toast';

export default function Expenses() {
  const { user, currency } = useAuth();
  const [expenses, setExpenses] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const now = new Date();
  const [filter, setFilter] = useState({
    type: 'all',
    category: 'all',
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  });

  const fetchExpenses = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await getExpenses(user.uid, filter);
      setExpenses(data);
    } catch {
      toast.error('Failed to load transactions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchExpenses(); }, [filter, user]);

  const handleDelete = async (item) => {
    if (!window.confirm(`Delete "${item.title}" (${formatCurrency(item.amount, currency)})?`)) return;
    try {
      await deleteExpense(user.uid, item.id);
      setExpenses((prev) => prev.filter((e) => e.id !== item.id));
      toast.success('Transaction deleted');
    } catch {
      toast.error('Failed to delete transaction');
    }
  };

  const expenseSum = expenses.filter((e) => e.type !== 'income').reduce((s, e) => s + e.amount, 0);
  const incomeSum  = expenses.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0);
  const months = Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: new Date(2000, i).toLocaleString('en-IN', { month: 'long' }),
  }));

  const categoryOptions = filter.type === 'income'
    ? INCOME_CATEGORIES
    : filter.type === 'expense'
      ? CATEGORIES
      : { ...CATEGORIES, ...INCOME_CATEGORIES };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Expenses & Income</h1>
        <p className="text-gray-500 text-xs sm:text-sm mt-0.5">All money sent (expenses) and money received (income)</p>
      </div>

      {/* Type Tabs */}
      <div className="grid grid-cols-3 gap-2 bg-white p-1.5 rounded-2xl shadow-card max-w-md">
        {[
          { value: 'all', label: 'All' },
          { value: 'expense', label: '💸 Expenses' },
          { value: 'income', label: '💰 Income' },
        ].map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setFilter({ ...filter, type: tab.value, category: 'all' })}
            className={`py-2 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              filter.type === tab.value
                ? tab.value === 'income'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters & Totals */}
      <div className="card p-3.5 sm:p-4">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2.5 sm:gap-3 items-center">
          <select
            className="input-field col-span-2 sm:w-auto text-sm py-2.5"
            value={filter.category}
            onChange={(e) => setFilter({ ...filter, category: e.target.value })}
          >
            <option value="all">All Categories</option>
            {Object.entries(categoryOptions).map(([k, v]) => (
              <option key={k} value={k}>{v.icon} {v.label}</option>
            ))}
          </select>
          <select
            className="input-field col-span-1 sm:w-auto text-sm py-2.5"
            value={filter.month}
            onChange={(e) => setFilter({ ...filter, month: Number(e.target.value) })}
          >
            {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <select
            className="input-field col-span-1 sm:w-auto text-sm py-2.5"
            value={filter.year}
            onChange={(e) => setFilter({ ...filter, year: Number(e.target.value) })}
          >
            {[2024, 2025, 2026].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <div className="col-span-2 sm:col-span-1 sm:ml-auto flex flex-wrap items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-100">
            {filter.type !== 'income' && (
              <div className="text-xs sm:text-sm">
                <span className="text-gray-500">Spent: </span>
                <span className="font-bold text-gray-900 tabular-nums">{formatCurrency(expenseSum, currency)}</span>
              </div>
            )}
            {filter.type !== 'expense' && (
              <div className="text-xs sm:text-sm">
                <span className="text-gray-500">Received: </span>
                <span className="font-bold text-emerald-600 tabular-nums">+{formatCurrency(incomeSum, currency)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card flex items-center justify-center h-48">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : expenses.length === 0 ? (
        <div className="card text-center py-12 sm:py-16">
          <div className="text-5xl mb-4">📋</div>
          <h3 className="text-lg font-semibold text-gray-700">No transactions found</h3>
          <p className="text-gray-400 text-sm mt-1">Try changing your filters or add a new entry</p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          {expenses.map((e, idx) => {
            const isIncome = e.type === 'income';
            const cat = getCategoryMeta(e.category, e.type);
            return (
              <div
                key={e.id}
                className={`flex items-center gap-3 sm:gap-4 px-3.5 py-3.5 sm:px-5 sm:py-4 hover:bg-gray-50 transition-colors ${
                  idx < expenses.length - 1 ? 'border-b border-gray-100' : ''
                }`}
              >
                <div
                  className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center text-lg sm:text-xl flex-shrink-0"
                  style={{ backgroundColor: cat?.bgColor || '#f8fafc' }}
                >
                  {cat?.icon || '📦'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                    <p className="font-semibold text-sm sm:text-base text-gray-800 truncate">{e.title}</p>
                    {isIncome && (
                      <span className="badge-green text-[10px] sm:text-xs">Income</span>
                    )}
                    {e.isRecurring && <span className="badge-blue text-[10px] sm:text-xs">🔄 Recurring</span>}
                    {e.receiptUrl && (
                      <a
                        href={e.receiptUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-500 hover:underline flex items-center gap-0.5"
                      >
                        📷 Receipt
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-gray-400">{formatDate(e.date)}</span>
                    <span className="text-gray-200">·</span>
                    <span className="text-xs" style={{ color: cat?.textColor }}>{cat?.label}</span>
                    <span className="text-gray-200">·</span>
                    <span className="text-xs text-gray-400 capitalize">
                      {PAYMENT_METHODS.find((p) => p.value === e.paymentMethod)?.icon} {e.paymentMethod}
                    </span>
                  </div>
                  {e.note && <p className="text-xs text-gray-400 mt-0.5 truncate">{e.note}</p>}
                </div>
                <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                  <p
                    className={`font-bold text-sm sm:text-base tabular-nums ${
                      isIncome ? 'text-emerald-600' : 'text-gray-900'
                    }`}
                  >
                    {isIncome ? '+' : ''}{formatCurrency(e.amount, currency)}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleDelete(e)}
                    aria-label={`Delete ${e.title}`}
                    className="text-xs text-gray-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-lg transition-colors"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
