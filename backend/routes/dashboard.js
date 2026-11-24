const express = require('express');
const Expense = require('../models/Expense');
const Budget = require('../models/Budget');
const { protect } = require('../middleware/auth');

const router = express.Router();
router.use(protect);

// @GET /api/dashboard — Full dashboard data
router.get('/', async (req, res) => {
  try {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const monthStart = new Date(currentYear, currentMonth - 1, 1);
    const monthEnd = new Date(currentYear, currentMonth, 0, 23, 59, 59);

    // Today
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    // Last month
    const lastMonthStart = new Date(currentYear, currentMonth - 2, 1);
    const lastMonthEnd = new Date(currentYear, currentMonth - 1, 0, 23, 59, 59);

    const [
      totalThisMonth,
      totalToday,
      totalLastMonth,
      categoryBreakdown,
      recentExpenses,
      budgets,
      weeklyData
    ] = await Promise.all([
      // Total this month
      Expense.aggregate([
        { $match: { user: req.user._id, date: { $gte: monthStart, $lte: monthEnd } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),

      // Total today
      Expense.aggregate([
        { $match: { user: req.user._id, date: { $gte: todayStart, $lte: todayEnd } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),

      // Total last month
      Expense.aggregate([
        { $match: { user: req.user._id, date: { $gte: lastMonthStart, $lte: lastMonthEnd } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),

      // Category breakdown this month
      Expense.aggregate([
        { $match: { user: req.user._id, date: { $gte: monthStart, $lte: monthEnd } } },
        { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { total: -1 } }
      ]),

      // Recent 5 expenses
      Expense.find({ user: req.user._id }).sort({ date: -1 }).limit(5),

      // Budgets with spending
      Budget.find({ user: req.user._id, month: currentMonth, year: currentYear }),

      // Weekly spending (last 7 days)
      Expense.aggregate([
        {
          $match: {
            user: req.user._id,
            date: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
            total: { $sum: '$amount' }
          }
        },
        { $sort: { _id: 1 } }
      ])
    ]);

    // Spending for each budget
    const spendingMap = {};
    categoryBreakdown.forEach((c) => { spendingMap[c._id] = c.total; });

    const budgetsWithSpending = budgets.map((b) => ({
      ...b.toObject(),
      spent: spendingMap[b.category] || 0,
      percentage: Math.round(((spendingMap[b.category] || 0) / b.limit) * 100)
    }));

    const monthTotal = totalThisMonth[0]?.total || 0;
    const lastMonthTotal = totalLastMonth[0]?.total || 0;
    const monthlyIncome = req.user.monthlyIncome || 0;
    const safeToSpend = Math.max(0, monthlyIncome - monthTotal);

    res.json({
      success: true,
      data: {
        summary: {
          totalThisMonth: monthTotal,
          totalToday: totalToday[0]?.total || 0,
          totalLastMonth: lastMonthTotal,
          safeToSpend,
          monthlyIncome,
          changeFromLastMonth:
            lastMonthTotal > 0
              ? Math.round(((monthTotal - lastMonthTotal) / lastMonthTotal) * 100)
              : 0
        },
        categoryBreakdown,
        recentExpenses,
        budgets: budgetsWithSpending,
        weeklyData
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
