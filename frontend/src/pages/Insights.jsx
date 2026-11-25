import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useAuth } from '../context/AuthContext';
import { getMonthlyStats } from '../lib/firestore';
import { CATEGORIES, formatCurrency } from '../lib/constants';
import toast from 'react-hot-toast';

export default function Insights() {
  const { user, currency, monthlyIncome } = useAuth();
  const [stats,       setStats]       = useState([]);
  const [total,       setTotal]       = useState(0);
  const [incomeTotal, setIncomeTotal] = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [month,    setMonth]    = useState(new Date().getMonth() + 1);
  const [year]                  = useState(new Date().getFullYear());
  const [lastMonth, setLastMonth] = useState(0);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear  = month === 1 ? year - 1 : year;
    Promise.all([
      getMonthlyStats(user.uid, month, year),
      getMonthlyStats(user.uid, prevMonth, prevYear),
    ])
      .then(([cur, prev]) => {
        setStats(cur.stats);
        setTotal(cur.total);
        setIncomeTotal(cur.incomeTotal || 0);
        setLastMonth(prev.total);
      })
      .catch(() => toast.error('Failed to load insights'))
      .finally(() => setLoading(false));
  }, [user, month]);

  const topCategory = stats[0];
  const barData = stats.map((s) => ({
    name:   CATEGORIES[s._id]?.label?.split(' ')[0] || s._id,
    amount: s.total,
    color:  CATEGORIES[s._id]?.color || '#94a3b8',
  }));

  const months = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: new Date(2000, i).toLocaleString('en-IN', { month: 'long' }) }));
  const foodDeliverySpend  = stats.find((s) => s._id === 'food-delivery')?.total || 0;
  const foodDeliveryMeals  = foodDeliverySpend > 0 ? Math.round(foodDeliverySpend / 300) : 0;
  const yearlyFoodDelivery = foodDeliverySpend * 12;
  const changeAbs  = lastMonth > 0 ? Math.abs(Math.round(((total - lastMonth) / lastMonth) * 100)) : 0;
  const changeIsUp = total > lastMonth;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Insights</h1>
          <p className="text-gray-500 text-xs sm:text-sm mt-0.5">Understand your spending patterns</p>
        </div>
        <select className="input-field w-full sm:w-auto text-sm py-2.5" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="card flex items-center justify-center h-48">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : stats.length === 0 ? (
        <div className="card text-center py-12 sm:py-16">
          <div className="text-5xl mb-4">💡</div>
          <h3 className="text-lg font-semibold text-gray-700">No data for this month</h3>
          <p className="text-gray-400 text-sm mt-1">Add some expenses to see insights</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="card p-3.5 sm:p-5 text-center min-w-0"><p className="text-xs text-gray-500 mb-1">Total Spent</p><p className="text-lg sm:text-xl font-bold text-gray-900 tabular-nums truncate">{formatCurrency(total, currency)}</p></div>
            <div className="card p-3.5 sm:p-5 text-center min-w-0"><p className="text-xs text-gray-500 mb-1">Income Received</p><p className="text-lg sm:text-xl font-bold text-emerald-600 tabular-nums truncate">+{formatCurrency(incomeTotal, currency)}</p></div>
            <div className="card p-3.5 sm:p-5 text-center min-w-0">
              <p className="text-xs text-gray-500 mb-1">Top Category</p>
              <p className="text-xl">{CATEGORIES[topCategory?._id]?.icon}</p>
              <p className="text-xs font-semibold text-gray-700 mt-0.5 truncate">{CATEGORIES[topCategory?._id]?.label}</p>
            </div>
            <div className="card p-3.5 sm:p-5 text-center min-w-0"><p className="text-xs text-gray-500 mb-1">Transactions</p><p className="text-lg sm:text-xl font-bold text-gray-900 tabular-nums">{stats.reduce((s, c) => s + c.count, 0)}</p></div>
          </div>

          <div className="card min-w-0">
            <h2 className="text-base font-semibold text-gray-900 mb-3 sm:mb-4">Spending by Category</h2>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={barData} margin={{ top: 5, right: 6, left: -12, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${currency}${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => [`${currency}${v.toLocaleString('en-IN')}`, 'Spent']} contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }} />
                <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                  {barData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Category Breakdown</h2>
            <div className="space-y-3">
              {stats.map((s) => {
                const cat = CATEGORIES[s._id];
                const pct = total > 0 ? Math.round((s.total / total) * 100) : 0;
                return (
                  <div key={s._id} className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ backgroundColor: cat?.bgColor }}>{cat?.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-sm font-medium text-gray-700 truncate">{cat?.label}</span>
                        <span className="text-sm font-bold text-gray-900 tabular-nums flex-shrink-0">{formatCurrency(s.total, currency)}</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: cat?.color }} />
                      </div>
                    </div>
                    <span className="text-xs text-gray-400 w-9 text-right tabular-nums flex-shrink-0">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          {foodDeliverySpend > 0 && (
            <div className="card bg-gradient-to-br from-orange-50 to-red-50 border border-orange-100">
              <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">💡 Smart Insight: Food Delivery</h2>
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 bg-white rounded-xl">
                  <span className="text-2xl">🍕</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">You ordered food ~{foodDeliveryMeals} times this month</p>
                    <p className="text-xs text-gray-500 mt-0.5">Spent {formatCurrency(foodDeliverySpend, currency)} ≈ {formatCurrency(Math.round(foodDeliverySpend / (foodDeliveryMeals || 1)), currency)}/meal</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-white rounded-xl">
                  <span className="text-2xl">📅</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">At this rate → {formatCurrency(yearlyFoodDelivery, currency)} on delivery this year</p>
                    <p className="text-xs text-gray-500 mt-0.5">That could fund a Goa vacation + savings!</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-white rounded-xl">
                  <span className="text-2xl">🏠</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Cooking 3 more meals/week could save you</p>
                    <p className="text-xs text-emerald-600 font-semibold mt-0.5">≈ {formatCurrency(Math.round(foodDeliverySpend * 0.4), currency)} per month!</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {lastMonth > 0 && (
            <div className={`card ${changeIsUp ? 'bg-red-50 border border-red-100' : 'bg-emerald-50 border border-emerald-100'}`}>
              <div className="flex items-center gap-4">
                <span className="text-3xl">{changeIsUp ? '📈' : '📉'}</span>
                <div>
                  <p className="font-semibold text-gray-900">
                    {changeIsUp ? `Spending up ${changeAbs}% vs last month` : `Spending down ${changeAbs}% vs last month`}
                  </p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {changeIsUp ? 'Review your top categories and set tighter budgets.' : "Great job! You're spending less this month. Keep the streak going!"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
