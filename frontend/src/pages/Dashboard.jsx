import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useAuth } from '../context/AuthContext';
import { getExpenses, getBudgets } from '../lib/firestore';
import { CATEGORIES, formatCurrency, getCategoryMeta } from '../lib/constants';
import { buildBudgetAlert } from '../lib/budgetAlerts';
import SpendingCalendar from '../components/SpendingCalendar';

const RADIAN = Math.PI / 180;
const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
  if (percent < 0.05) return null;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>{`${(percent * 100).toFixed(0)}%`}</text>;
};

function StatCard({ icon, label, value, sub, subColor = 'text-gray-500', bgColor = 'bg-blue-50' }) {
  return (
    <div className="card p-3.5 sm:p-5 hover:shadow-card-hover transition-shadow duration-300 min-w-0 flex flex-col justify-between">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] sm:text-sm text-gray-500 font-medium leading-tight">{label}</p>
        <div className={`w-7 h-7 sm:w-10 sm:h-10 ${bgColor} rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0`}>
          <span className="text-sm sm:text-xl">{icon}</span>
        </div>
      </div>
      <p className="text-xl sm:text-2xl font-bold text-gray-900 mt-1.5 tabular-nums truncate">{value}</p>
      {sub && <p className={`text-[11px] sm:text-xs mt-1 font-medium leading-tight ${subColor}`}>{sub}</p>}
    </div>
  );
}

export default function Dashboard() {
  const { user, displayName, monthlyIncome, currency } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats]     = useState({ total: 0, incomeTotal: 0, stats: [] });
  const [lastMonth, setLastMonth] = useState(0);
  const [todayTotal, setTodayTotal] = useState(0);
  const [weekly, setWeekly]   = useState([]);
  const [recent, setRecent]   = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [allExpenses, setAllExpenses] = useState([]);

  const loadDashboardData = useCallback(() => {
    if (!user) return;
    const now = new Date();
    const month = now.getMonth() + 1;
    const year  = now.getFullYear();
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear  = month === 1 ? year - 1 : year;

    Promise.all([
      getExpenses(user.uid),
      getBudgets(user.uid, month, year),
    ])
      .then(([allExp, bud]) => {
        setAllExpenses(allExp);
        // Current month calculations (expenses vs income separated accurately)
        const curTransactions = allExp.filter((e) => {
          const d = new Date(e.date);
          return d.getMonth() + 1 === month && d.getFullYear() === year;
        });
        const curExpenses = curTransactions.filter((e) => e.type !== 'income');
        const curIncomes = curTransactions.filter((e) => e.type === 'income');
        const curTotal = curExpenses.reduce((s, e) => s + e.amount, 0);
        const curIncomeTotal = curIncomes.reduce((s, e) => s + e.amount, 0);

        const byCategory = {};
        curExpenses.forEach((e) => {
          if (!byCategory[e.category]) byCategory[e.category] = { total: 0, count: 0 };
          byCategory[e.category].total += e.amount;
          byCategory[e.category].count += 1;
        });
        const statsArr = Object.entries(byCategory)
          .map(([cat, v]) => ({ _id: cat, ...v }))
          .sort((a, b) => b.total - a.total);

        setStats({ total: curTotal, incomeTotal: curIncomeTotal, stats: statsArr, expenses: curExpenses });

        // Previous month calculation (expenses only)
        const prevTotal = allExp
          .filter((e) => {
            if (e.type === 'income') return false;
            const d = new Date(e.date);
            return d.getMonth() + 1 === prevMonth && d.getFullYear() === prevYear;
          })
          .reduce((s, e) => s + e.amount, 0);
        setLastMonth(prevTotal);

        // Today's total (expenses only)
        const todayStr = now.toDateString();
        const todaySum = curExpenses
          .filter((e) => new Date(e.date).toDateString() === todayStr)
          .reduce((s, e) => s + e.amount, 0);
        setTodayTotal(todaySum);

        // Weekly chart data (last 7 days, expenses only)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const dayMap = {};
        allExp.forEach((e) => {
          if (e.type === 'income') return;
          const d = new Date(e.date);
          if (d >= sevenDaysAgo) {
            const key = d.toISOString().split('T')[0];
            dayMap[key] = (dayMap[key] || 0) + e.amount;
          }
        });
        setWeekly(Object.entries(dayMap).map(([_id, total]) => ({ _id, total })));

        // Recent 5 expenses
        setRecent(allExp.slice(0, 5));

        // Merge budgets with spending
        const spendMap = {};
        statsArr.forEach((s) => { spendMap[s._id] = s.total; });
        setBudgets(bud.map((b) => ({
          ...b,
          spent: spendMap[b.category] || 0,
          percentage: Math.round(((spendMap[b.category] || 0) / (b.limit || 1)) * 100),
        })));
      })
      .catch((err) => {
        console.warn('Dashboard data load notice:', err);
      })
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        <p className="text-gray-400 text-sm">Loading your dashboard...</p>
      </div>
    </div>
  );

  const changeAbs = lastMonth > 0 ? Math.abs(Math.round(((stats.total - lastMonth) / lastMonth) * 100)) : 0;
  const changeIsUp = stats.total > lastMonth;
  const effectiveIncome = monthlyIncome > 0 ? monthlyIncome : stats.incomeTotal;
  const safeToSpend = Math.max(0, effectiveIncome - stats.total);
  const safePercent = effectiveIncome > 0 ? Math.round((safeToSpend / effectiveIncome) * 100) : null;

  const pieData = stats.stats.slice(0, 6).map((c) => ({
    name:  CATEGORIES[c._id]?.label || c._id,
    value: c.total,
    color: CATEGORIES[c._id]?.color || '#94a3b8',
  }));

  const areaData = weekly.map((d) => ({
    day:    new Date(d._id).toLocaleDateString('en-IN', { weekday: 'short' }),
    amount: d.total,
  }));

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

  const activeAlerts = budgets
    .map((b) => buildBudgetAlert(b, b.spent, currency))
    .filter(Boolean)
    .sort((a, b) => b.percentage - a.percentage);
  const hasOverBudget = activeAlerts.some((a) => a.level === 'over' || a.level === 'reached');

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Good {greeting}, {displayName.split(' ')[0]}! 👋</h1>
          <p className="text-gray-500 text-xs sm:text-sm mt-0.5">Here's your financial overview</p>
        </div>
        <Link to="/add-expense" className="btn-primary hidden sm:inline-flex items-center gap-2 self-auto">
          <span>➕</span> Add Expense
        </Link>
      </div>

      {/* Live Budget Alert Banner */}
      {activeAlerts.length > 0 && (
        <div
          className={`rounded-2xl p-3.5 sm:p-4 border shadow-sm ${
            hasOverBudget
              ? 'bg-red-50/90 border-red-200 text-red-900'
              : 'bg-amber-50/90 border-amber-200 text-amber-900'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="space-y-1 min-w-0">
              <p className="text-xs sm:text-sm font-bold flex items-center gap-1.5">
                <span>{hasOverBudget ? '🚨' : '⚠️'}</span>
                <span>{hasOverBudget ? 'Budget Limit Alert' : 'Approaching Budget Limit'}</span>
              </p>
              <div className="space-y-0.5">
                {activeAlerts.slice(0, 2).map((alert) => (
                  <p key={alert.category} className="text-xs leading-relaxed">
                    {alert.icon} <strong>{alert.label}:</strong> {alert.message}
                  </p>
                ))}
                {activeAlerts.length > 2 && (
                  <p className="text-[11px] opacity-80">
                    +{activeAlerts.length - 2} more category alert(s)
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Link
                to="/budgets"
                className={`text-xs font-semibold px-3 py-2 rounded-xl border transition-colors ${
                  hasOverBudget
                    ? 'bg-white border-red-200 text-red-700 hover:bg-red-100'
                    : 'bg-white border-amber-200 text-amber-800 hover:bg-amber-100'
                }`}
              >
                View Budgets
              </Link>
              <Link
                to="/settings#app-guard"
                className="text-xs font-semibold px-3 py-2 rounded-xl bg-gray-900 text-white hover:bg-gray-800 transition-colors"
              >
                📱 App-Open Alert
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard icon="💸" label="Spent This Month" value={formatCurrency(stats.total, currency)}
          sub={lastMonth > 0 ? `${changeIsUp ? '↑' : '↓'} ${changeAbs}% vs last month` : 'First month tracking'}
          subColor={changeIsUp ? 'text-red-500' : 'text-emerald-500'} bgColor="bg-red-50" />
        <StatCard icon="💰" label="Today's Spending" value={formatCurrency(todayTotal, currency)} sub="All categories" bgColor="bg-amber-50" />
        <StatCard icon="✅" label="Safe to Spend" value={formatCurrency(safeToSpend, currency)}
          sub={safePercent !== null ? `${safePercent}% of ${monthlyIncome > 0 ? 'budgeted ' : 'received '}income left` : 'Set income or log receipts'}
          subColor={safePercent !== null && safePercent < 20 ? 'text-red-500' : 'text-emerald-500'} bgColor="bg-emerald-50" />
        <StatCard icon="📥" label="Received (Income)" value={`+${formatCurrency(stats.incomeTotal, currency)}`}
          sub="Money credited this month" subColor="text-emerald-600" bgColor="bg-emerald-50" />
      </div>

      {/* Interactive Spending Calendar */}
      <SpendingCalendar expenses={allExpenses} currency={currency} />

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="card lg:col-span-2 min-w-0">
          <h2 className="text-base font-semibold text-gray-900 mb-3 sm:mb-4">Weekly Spending (Last 7 Days)</h2>
          {areaData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={areaData} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorAmt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${currency}${v}`} />
                <Tooltip formatter={(v) => [`${currency}${v.toLocaleString('en-IN')}`, 'Amount']} contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }} />
                <Area type="monotone" dataKey="amount" stroke="#2563eb" strokeWidth={2.5} fill="url(#colorAmt)" dot={{ fill: '#2563eb', r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No spending data for the past 7 days</div>}
        </div>

        <div className="card min-w-0">
          <h2 className="text-base font-semibold text-gray-900 mb-3 sm:mb-4">Category Split</h2>
          {pieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} labelLine={false} label={renderCustomLabel} dataKey="value">
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={(v) => [`${currency}${v.toLocaleString('en-IN')}`, '']} contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 mt-2">
                {pieData.map((d) => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }}></div>
                      <span className="text-gray-600">{d.name}</span>
                    </div>
                    <span className="font-semibold text-gray-800">{formatCurrency(d.value, currency)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No expenses this month</div>}
        </div>
      </div>

      {/* Budget & Recent */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <div className="card min-w-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Budget Status</h2>
            <Link to="/budgets" className="text-sm text-blue-600 font-semibold hover:underline">Manage →</Link>
          </div>
          {budgets.length > 0 ? (
            <div className="space-y-3">
              {budgets.slice(0, 5).map((b) => {
                const cat = CATEGORIES[b.category];
                const pct = Math.min(b.percentage, 100);
                return (
                  <div key={b.id}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5 min-w-0 truncate"><span className="flex-shrink-0">{cat?.icon}</span><span className="truncate">{cat?.label}</span></span>
                      <span className={`text-xs font-semibold flex-shrink-0 tabular-nums ${b.percentage >= 100 ? 'text-red-600' : b.percentage >= 80 ? 'text-amber-600' : 'text-gray-500'}`}>
                        {formatCurrency(b.spent, currency)} / {formatCurrency(b.limit, currency)}
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className={`h-2 rounded-full transition-all duration-500 ${b.percentage >= 100 ? 'bg-red-500' : b.percentage >= 80 ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <div className="text-3xl mb-2">🎯</div>
              <p className="text-sm">No budgets set yet</p>
              <Link to="/budgets" className="text-blue-600 text-sm font-semibold hover:underline mt-1 inline-block">Set budgets →</Link>
            </div>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Recent Activity</h2>
            <Link to="/expenses" className="text-sm text-blue-600 font-semibold hover:underline">View all →</Link>
          </div>
          {recent.length > 0 ? (
            <div className="space-y-3">
              {recent.map((e) => {
                const isIncome = e.type === 'income';
                const cat = getCategoryMeta(e.category, e.type);
                return (
                  <div key={e.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50 transition-colors">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ backgroundColor: cat?.bgColor }}>{cat?.icon}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{e.title}</p>
                      <p className="text-xs text-gray-400">{cat?.label} · {new Date(e.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
                    </div>
                    <span className={`text-sm font-bold flex-shrink-0 tabular-nums ${isIncome ? 'text-emerald-600' : 'text-gray-900'}`}>
                      {isIncome ? '+' : ''}{formatCurrency(e.amount, currency)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <div className="text-3xl mb-2">📋</div>
              <p className="text-sm">No expenses yet</p>
              <Link to="/add-expense" className="text-blue-600 text-sm font-semibold hover:underline mt-1 inline-block">Add your first →</Link>
            </div>
          )}
        </div>
      </div>

      {stats.total > 0 && (
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-5 text-white">
          <div className="flex items-center gap-3">
            <span className="text-3xl">💡</span>
            <div>
              <p className="font-semibold text-sm">Monthly Insight</p>
              <p className="text-blue-100 text-sm mt-0.5">
                You've spent <strong className="text-white">{formatCurrency(stats.total, currency)}</strong> this month.
                {changeIsUp
                  ? ` That's ${changeAbs}% more than last month. Consider reviewing food delivery expenses.`
                  : ` Great job! You're spending ${changeAbs}% less than last month. Keep it up! 🎉`}
              </p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
