import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useAuth } from '../context/AuthContext';
import { getMonthlyStats, getWeeklyData, getRecentExpenses, getBudgets } from '../lib/firestore';
import { fetchGmailTransactions, importGmailTransactions } from '../lib/gmailSync';
import { CATEGORIES, formatCurrency } from '../lib/constants';
import toast from 'react-hot-toast';

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
    <div className="card hover:shadow-card-hover transition-shadow duration-300">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 font-medium">{label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          {sub && <p className={`text-xs mt-1 font-medium ${subColor}`}>{sub}</p>}
        </div>
        <div className={`w-11 h-11 ${bgColor} rounded-xl flex items-center justify-center`}>
          <span className="text-xl">{icon}</span>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, displayName, monthlyIncome, currency } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats]     = useState({ total: 0, stats: [] });
  const [lastMonth, setLastMonth] = useState(0);
  const [todayTotal, setTodayTotal] = useState(0);
  const [weekly, setWeekly]   = useState([]);
  const [recent, setRecent]   = useState([]);
  const [budgets, setBudgets] = useState([]);

  // Gmail Auto-Sync state
  const [showGmailModal, setShowGmailModal] = useState(false);
  const [syncingGmail, setSyncingGmail]     = useState(false);
  const [gmailPending, setGmailPending]     = useState([]);
  const [selectedEmails, setSelectedEmails] = useState(new Set());
  const [importing, setImporting]           = useState(false);

  const loadDashboardData = useCallback(() => {
    if (!user) return;
    const now = new Date();
    const month = now.getMonth() + 1;
    const year  = now.getFullYear();
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear  = month === 1 ? year - 1 : year;

    Promise.all([
      getMonthlyStats(user.uid, month, year),
      getMonthlyStats(user.uid, prevMonth, prevYear),
      getWeeklyData(user.uid),
      getRecentExpenses(user.uid, 5),
      getBudgets(user.uid, month, year),
    ])
      .then(([cur, prev, wk, rec, bud]) => {
        setStats(cur);
        setLastMonth(prev.total);

        // Today total
        const today = now.toDateString();
        const todaySum = cur.expenses
          .filter((e) => new Date(e.date).toDateString() === today)
          .reduce((s, e) => s + e.amount, 0);
        setTodayTotal(todaySum);

        setWeekly(wk);
        setRecent(rec);

        // Merge budgets with spending
        const spendMap = {};
        cur.stats.forEach((s) => { spendMap[s._id] = s.total; });
        setBudgets(bud.map((b) => ({
          ...b,
          spent: spendMap[b.category] || 0,
          percentage: Math.round(((spendMap[b.category] || 0) / b.limit) * 100),
        })));
      })
      .catch(() => toast.error('Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // Open Gmail Sync modal and fetch detected emails
  const handleOpenGmailSync = async () => {
    setShowGmailModal(true);
    setSyncingGmail(true);
    try {
      const list = await fetchGmailTransactions();
      setGmailPending(list);
      setSelectedEmails(new Set(list.map((t) => t.emailId)));
    } catch {
      toast.error('Failed to scan bank transaction emails');
    } finally {
      setSyncingGmail(false);
    }
  };

  // Toggle selection
  const toggleSelectEmail = (id) => {
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Import chosen transactions
  const handleImportSelected = async () => {
    if (!user) return;
    const toImport = gmailPending.filter((t) => selectedEmails.has(t.emailId));
    if (toImport.length === 0) {
      toast.error('Please select at least 1 transaction to import');
      return;
    }

    setImporting(true);
    try {
      const count = await importGmailTransactions(toImport, user.uid);
      toast.success(`Successfully imported ${count} transactions from Gmail! ⚡`);
      setShowGmailModal(false);
      loadDashboardData();
    } catch {
      toast.error('Import failed');
    } finally {
      setImporting(false);
    }
  };

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
  const safeToSpend = Math.max(0, monthlyIncome - stats.total);
  const safePercent = monthlyIncome > 0 ? Math.round((safeToSpend / monthlyIncome) * 100) : null;

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Good {greeting}, {displayName.split(' ')[0]}! 👋</h1>
          <p className="text-gray-500 text-sm mt-0.5">Here's your financial overview</p>
        </div>
        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          <button
            onClick={handleOpenGmailSync}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-medium text-sm rounded-xl shadow-sm hover:shadow transition-all"
            title="Scan bank debit emails from Gmail and auto-import expenses"
          >
            <span>⚡</span> Sync Bank Emails
          </button>
          <Link to="/add-expense" className="btn-primary flex items-center gap-2">
            <span>➕</span> Add Expense
          </Link>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon="💸" label="Spent This Month" value={formatCurrency(stats.total, currency)}
          sub={lastMonth > 0 ? `${changeIsUp ? '↑' : '↓'} ${changeAbs}% vs last month` : 'First month tracking'}
          subColor={changeIsUp ? 'text-red-500' : 'text-emerald-500'} bgColor="bg-red-50" />
        <StatCard icon="💰" label="Today's Spending" value={formatCurrency(todayTotal, currency)} sub="All categories" bgColor="bg-amber-50" />
        <StatCard icon="✅" label="Safe to Spend" value={formatCurrency(safeToSpend, currency)}
          sub={safePercent !== null ? `${safePercent}% of income remaining` : 'Set income in settings'}
          subColor={safePercent !== null && safePercent < 20 ? 'text-red-500' : 'text-emerald-500'} bgColor="bg-emerald-50" />
        <StatCard icon="📅" label="Last Month" value={formatCurrency(lastMonth, currency)} sub="Previous period" bgColor="bg-purple-50" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card lg:col-span-2">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Weekly Spending (Last 7 Days)</h2>
          {areaData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={areaData}>
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

        <div className="card">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Category Split</h2>
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
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
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5"><span>{cat?.icon}</span>{cat?.label}</span>
                      <span className={`text-xs font-semibold ${b.percentage >= 100 ? 'text-red-600' : b.percentage >= 80 ? 'text-amber-600' : 'text-gray-500'}`}>
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
            <h2 className="text-base font-semibold text-gray-900">Recent Expenses</h2>
            <Link to="/expenses" className="text-sm text-blue-600 font-semibold hover:underline">View all →</Link>
          </div>
          {recent.length > 0 ? (
            <div className="space-y-3">
              {recent.map((e) => {
                const cat = CATEGORIES[e.category];
                return (
                  <div key={e.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50 transition-colors">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ backgroundColor: cat?.bgColor }}>{cat?.icon}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{e.title}</p>
                      <p className="text-xs text-gray-400">{cat?.label} · {new Date(e.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
                    </div>
                    <span className="text-sm font-bold text-gray-900 flex-shrink-0">{formatCurrency(e.amount, currency)}</span>
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

      {/* Gmail Auto-Sync Modal */}
      {showGmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center text-xl shadow-sm">
                  ⚡
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Gmail Bank Transaction Auto-Sync</h3>
                  <p className="text-xs text-gray-500">Detect & import debit alerts from HDFC, ICICI, SBI, UPI, Swiggy, etc.</p>
                </div>
              </div>
              <button
                onClick={() => setShowGmailModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              {syncingGmail ? (
                <div className="py-12 text-center">
                  <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                  <p className="text-sm font-semibold text-gray-800">Scanning your emails for bank transactions...</p>
                  <p className="text-xs text-gray-400 mt-1">Filtering UPI debits, card transactions & food orders</p>
                </div>
              ) : gmailPending.length === 0 ? (
                <div className="py-10 text-center text-gray-500">
                  <div className="text-4xl mb-2">🎉</div>
                  <p className="text-base font-semibold text-gray-800">No un-synced transactions found!</p>
                  <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
                    All detected bank debit emails and receipts have already been imported into MoneyMap.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between text-xs text-gray-500 pb-1">
                    <span>Found <strong className="text-gray-900 font-bold">{gmailPending.length}</strong> new debit transactions</span>
                    <button
                      onClick={() => {
                        if (selectedEmails.size === gmailPending.length) {
                          setSelectedEmails(new Set());
                        } else {
                          setSelectedEmails(new Set(gmailPending.map((t) => t.emailId)));
                        }
                      }}
                      className="text-blue-600 font-semibold hover:underline"
                    >
                      {selectedEmails.size === gmailPending.length ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {gmailPending.map((item) => {
                      const isSelected = selectedEmails.has(item.emailId);
                      const cat = CATEGORIES[item.category] || CATEGORIES.other;
                      return (
                        <div
                          key={item.emailId}
                          onClick={() => toggleSelectEmail(item.emailId)}
                          className={`p-3 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
                            isSelected
                              ? 'border-blue-500 bg-blue-50/50 shadow-sm'
                              : 'border-gray-200 hover:border-gray-300 bg-white'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}} // Handled by parent div
                            className="mt-1 w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0" style={{ backgroundColor: cat.bgColor }}>
                            {cat.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-gray-900 truncate">{item.title}</p>
                              <span className="text-sm font-bold text-red-600 flex-shrink-0">
                                -{formatCurrency(item.amount, currency)}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500 truncate mt-0.5">{item.subject}</p>
                            <p className="text-[11px] text-gray-400 mt-1">
                              {item.from} · {new Date(item.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setShowGmailModal(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 font-medium text-sm rounded-xl hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              {gmailPending.length > 0 && (
                <button
                  type="button"
                  onClick={handleImportSelected}
                  disabled={importing || selectedEmails.size === 0}
                  className="btn-primary py-2 px-5 text-sm flex items-center gap-2 disabled:opacity-50"
                >
                  {importing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Importing...
                    </>
                  ) : (
                    <>
                      <span>📥</span> Import {selectedEmails.size} Selected
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
