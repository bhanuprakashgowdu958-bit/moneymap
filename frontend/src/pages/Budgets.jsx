import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getBudgets, setBudget, deleteBudget, getMonthlyStats } from '../lib/firestore';
import { CATEGORIES, formatCurrency, getBudgetStatus } from '../lib/constants';
import toast from 'react-hot-toast';

const now = new Date();
const currentMonth = now.getMonth() + 1;
const currentYear  = now.getFullYear();

export default function Budgets() {
  const { user, currency } = useAuth();
  const [budgets,   setBudgets]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showForm,  setShowForm]  = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [form, setForm] = useState({ category: 'food-delivery', limit: '', alertAt: 80 });

  const fetchBudgets = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [bud, stats] = await Promise.all([
        getBudgets(user.uid, currentMonth, currentYear),
        getMonthlyStats(user.uid, currentMonth, currentYear),
      ]);
      const spendMap = {};
      stats.stats.forEach((s) => { spendMap[s._id] = s.total; });
      setBudgets(bud.map((b) => ({
        ...b,
        spent:      spendMap[b.category] || 0,
        percentage: Math.round(((spendMap[b.category] || 0) / b.limit) * 100),
      })));
    } catch {
      toast.error('Failed to load budgets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchBudgets(); }, [user]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.limit || Number(form.limit) <= 0) return toast.error('Enter a valid limit');
    setSaving(true);
    try {
      await setBudget(user.uid, { ...form, limit: Number(form.limit), month: currentMonth, year: currentYear });
      toast.success('Budget saved! 🎯');
      setShowForm(false);
      setForm({ category: 'food-delivery', limit: '', alertAt: 80 });
      fetchBudgets();
    } catch (err) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this budget?')) return;
    try {
      await deleteBudget(user.uid, id);
      toast.success('Budget removed');
      fetchBudgets();
    } catch {
      toast.error('Failed to delete');
    }
  };

  const totalBudgeted = budgets.reduce((s, b) => s + b.limit, 0);
  const totalSpent    = budgets.reduce((s, b) => s + (b.spent || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Budget Manager</h1>
          <p className="text-gray-500 text-sm mt-0.5">Set limits, stay on track</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary self-start sm:self-auto flex items-center gap-2">
          <span>{showForm ? '✕' : '+'}</span> {showForm ? 'Cancel' : 'Set Budget'}
        </button>
      </div>

      {budgets.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          <div className="card text-center">
            <p className="text-sm text-gray-500">Total Budgeted</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(totalBudgeted, currency)}</p>
          </div>
          <div className="card text-center">
            <p className="text-sm text-gray-500">Total Spent</p>
            <p className={`text-2xl font-bold mt-1 ${totalSpent > totalBudgeted ? 'text-red-600' : 'text-gray-900'}`}>
              {formatCurrency(totalSpent, currency)}
            </p>
          </div>
        </div>
      )}

      {showForm && (
        <div className="card border-2 border-blue-100">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Set Category Budget</h2>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="label">Category</label>
              <select className="input-field" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {Object.entries(CATEGORIES).filter(([k]) => k !== 'other').map(([k, v]) => (
                  <option key={k} value={k}>{v.icon} {v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Monthly Limit ({currency})</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">{currency}</span>
                <input type="number" className="input-field pl-8" placeholder="5000"
                  value={form.limit} onChange={(e) => setForm({ ...form, limit: e.target.value })} required min="1" />
              </div>
            </div>
            <div>
              <label className="label">Alert at ({form.alertAt}% used)</label>
              <input type="range" min="50" max="95" step="5" value={form.alertAt}
                onChange={(e) => setForm({ ...form, alertAt: Number(e.target.value) })} className="w-full accent-blue-600" />
              <div className="flex justify-between text-xs text-gray-400 mt-0.5"><span>50%</span><span>95%</span></div>
            </div>
            <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2">
              {saving ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span> Saving...</> : 'Save Budget 🎯'}
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <div className="card flex items-center justify-center h-48">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : budgets.length === 0 ? (
        <div className="card text-center py-16">
          <div className="text-5xl mb-4">🎯</div>
          <h3 className="text-lg font-semibold text-gray-700">No budgets set</h3>
          <p className="text-gray-400 text-sm mt-1">Set category limits to control your spending</p>
        </div>
      ) : (
        <div className="space-y-4">
          {budgets.map((b) => {
            const cat    = CATEGORIES[b.category];
            const pct    = Math.min(b.percentage || 0, 100);
            const status = getBudgetStatus(b.percentage || 0);
            const remaining = Math.max(b.limit - (b.spent || 0), 0);
            return (
              <div key={b.id} className="card hover:shadow-card-hover transition-all duration-300">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl" style={{ backgroundColor: cat?.bgColor }}>{cat?.icon}</div>
                    <div>
                      <p className="font-semibold text-gray-900">{cat?.label}</p>
                      <p className={`text-xs font-semibold ${status.color}`}>{status.label}</p>
                    </div>
                  </div>
                  <button onClick={() => handleDelete(b.id)} className="text-xs text-red-400 hover:text-red-600 transition-colors">Remove</button>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-3 mb-2">
                  <div className={`h-3 rounded-full transition-all duration-700 ${status.bg}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>{formatCurrency(b.spent || 0, currency)} spent</span>
                  <span className="font-semibold">{b.percentage || 0}%</span>
                  <span>{formatCurrency(remaining, currency)} left of {formatCurrency(b.limit, currency)}</span>
                </div>
                {b.percentage >= 80 && b.percentage < 100 && (
                  <div className="mt-3 bg-amber-50 rounded-xl px-3 py-2 text-xs text-amber-700 font-medium">
                    ⚠️ You're at {b.percentage}% of your {cat?.label} budget. Slow down!
                  </div>
                )}
                {b.percentage >= 100 && (
                  <div className="mt-3 bg-red-50 rounded-xl px-3 py-2 text-xs text-red-700 font-medium">
                    🚨 Over budget by {formatCurrency((b.spent || 0) - b.limit, currency)}.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
