import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { applyExpenseFilters, subscribeToExpenses } from '../lib/firestore';
import {
  CATEGORIES,
  INCOME_CATEGORIES,
  formatCurrency,
} from '../lib/constants';
import TransactionRow from '../components/TransactionRow';
import toast from 'react-hot-toast';

export default function Expenses() {
  const { user, currency } = useAuth();
  const [allExpenses, setAllExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(() => {
    const now = new Date();
    return {
      type: 'all',
      category: 'all',
      month: now.getMonth() + 1,
      year: now.getFullYear(),
    };
  });

  useEffect(() => {
    if (!user?.uid) return undefined;
    const unsub = subscribeToExpenses(
      user.uid,
      (items) => {
        setAllExpenses(items);
        setLoading(false);
      },
      () => {
        toast.error('Failed to load transactions');
        setLoading(false);
      }
    );
    return unsub;
  }, [user?.uid]);

  const expenses = useMemo(
    () => applyExpenseFilters(allExpenses, filter),
    [allExpenses, filter]
  );

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
          {expenses.map((e, idx) => (
            <TransactionRow
              key={e.id}
              transaction={e}
              currency={currency}
              showDivider={idx < expenses.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
