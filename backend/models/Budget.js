const mongoose = require('mongoose');

const budgetSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    category: {
      type: String,
      required: true,
      enum: [
        'food-delivery',
        'groceries',
        'drinks-beverages',
        'transport',
        'entertainment',
        'health-wellness',
        'shopping',
        'subscriptions',
        'housing',
        'education',
        'gifts-social',
        'savings-investment',
        'other'
      ]
    },
    limit: {
      type: Number,
      required: [true, 'Budget limit is required'],
      min: [1, 'Budget limit must be at least 1']
    },
    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12
    },
    year: {
      type: Number,
      required: true
    },
    alertAt: {
      type: Number,
      default: 80, // alert when 80% of budget is used
      min: 10,
      max: 100
    }
  },
  { timestamps: true }
);

// Unique budget per user per category per month
budgetSchema.index({ user: 1, category: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('Budget', budgetSchema);
