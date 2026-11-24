const express = require('express');
const Budget = require('../models/Budget');
const Expense = require('../models/Expense');
const { protect } = require('../middleware/auth');

const router = express.Router();
router.use(protect);

// @GET /api/budgets — Get budgets for a month
router.get('/', async (req, res) => {
  try {
    const { month, year } = req.query;
    const currentMonth = Number(month) || new Date().getMonth() + 1;
    const currentYear = Number(year) || new Date().getFullYear();

    const budgets = await Budget.find({ user: req.user._id, month: currentMonth, year: currentYear });

    // Get actual spending for each budget
    const start = new Date(currentYear, currentMonth - 1, 1);
    const end = new Date(currentYear, currentMonth, 0, 23, 59, 59);

    const spending = await Expense.aggregate([
      { $match: { user: req.user._id, date: { $gte: start, $lte: end } } },
      { $group: { _id: '$category', spent: { $sum: '$amount' } } }
    ]);

    const spendingMap = {};
    spending.forEach((s) => { spendingMap[s._id] = s.spent; });

    const budgetsWithSpending = budgets.map((b) => ({
      ...b.toObject(),
      spent: spendingMap[b.category] || 0,
      percentage: Math.round(((spendingMap[b.category] || 0) / b.limit) * 100)
    }));

    res.json({ success: true, budgets: budgetsWithSpending });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @POST /api/budgets — Create or update budget
router.post('/', async (req, res) => {
  try {
    const { category, limit, month, year, alertAt } = req.body;
    const currentMonth = month || new Date().getMonth() + 1;
    const currentYear = year || new Date().getFullYear();

    const budget = await Budget.findOneAndUpdate(
      { user: req.user._id, category, month: currentMonth, year: currentYear },
      { limit, alertAt: alertAt || 80 },
      { upsert: true, new: true, runValidators: true }
    );

    res.status(201).json({ success: true, budget });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @DELETE /api/budgets/:id — Delete budget
router.delete('/:id', async (req, res) => {
  try {
    await Budget.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    res.json({ success: true, message: 'Budget deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
