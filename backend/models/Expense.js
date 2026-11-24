const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [100, 'Title cannot exceed 100 characters']
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [0.01, 'Amount must be greater than 0']
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
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
    date: {
      type: Date,
      required: [true, 'Date is required'],
      default: Date.now
    },
    note: {
      type: String,
      trim: true,
      maxlength: [500, 'Note cannot exceed 500 characters']
    },
    paymentMethod: {
      type: String,
      enum: ['cash', 'upi', 'card', 'netbanking', 'other'],
      default: 'upi'
    },
    tags: [String],
    isRecurring: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

// Index for faster queries
expenseSchema.index({ user: 1, date: -1 });
expenseSchema.index({ user: 1, category: 1 });

module.exports = mongoose.model('Expense', expenseSchema);
