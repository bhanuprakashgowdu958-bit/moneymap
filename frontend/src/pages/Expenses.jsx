import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getExpenses } from '../lib/firestore';
import { CATEGORIES, PAYMENT_METHODS, formatCurrency, formatDate } from '../lib/constants';
import toast from 'react-hot-toast';

export default function Expenses() {
  const { user, currency } = useAuth();
  const [expenses, setExpenses] = useState([]);
  const [loading,  setLoading]  = useState(true);
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
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
