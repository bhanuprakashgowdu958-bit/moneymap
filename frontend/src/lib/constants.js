// Category metadata
export const CATEGORIES = {
  'food-delivery': {
    label: 'Food Delivery',
    icon: '🍕',
    color: '#ef4444',
    bgColor: '#fef2f2',
    textColor: '#dc2626',
    description: 'Swiggy, Zomato, UberEats'
  },
  'groceries': {
    label: 'Groceries',
    icon: '🛒',
    color: '#22c55e',
    bgColor: '#f0fdf4',
    textColor: '#16a34a',
    description: 'Supermarket, BigBasket, Blinkit'
  },
  'drinks-beverages': {
    label: 'Drinks & Beverages',
    icon: '🥤',
    color: '#06b6d4',
    bgColor: '#ecfeff',
    textColor: '#0891b2',
    description: 'Coffee, Juices, Alcohol'
  },
  'transport': {
    label: 'Transport',
    icon: '🚗',
    color: '#f59e0b',
    bgColor: '#fffbeb',
    textColor: '#d97706',
    description: 'Fuel, Uber, Metro, Bus'
  },
  'entertainment': {
    label: 'Entertainment',
    icon: '🎬',
    color: '#8b5cf6',
    bgColor: '#f5f3ff',
    textColor: '#7c3aed',
    description: 'Movies, Games, Events'
  },
  'health-wellness': {
    label: 'Health & Wellness',
    icon: '💊',
    color: '#ec4899',
    bgColor: '#fdf2f8',
    textColor: '#db2777',
    description: 'Medicine, Doctor, Gym'
  },
  'shopping': {
    label: 'Shopping',
    icon: '👔',
    color: '#f97316',
    bgColor: '#fff7ed',
    textColor: '#ea580c',
    description: 'Clothes, Electronics, Gadgets'
  },
  'subscriptions': {
    label: 'Subscriptions',
    icon: '📱',
    color: '#6366f1',
    bgColor: '#eef2ff',
    textColor: '#4f46e5',
    description: 'Netflix, Spotify, Apps, Gym'
  },
  'housing': {
    label: 'Housing',
    icon: '🏠',
    color: '#14b8a6',
    bgColor: '#f0fdfa',
    textColor: '#0d9488',
    description: 'Rent, Maintenance, Electricity'
  },
  'education': {
    label: 'Education',
    icon: '📚',
    color: '#3b82f6',
    bgColor: '#eff6ff',
    textColor: '#2563eb',
    description: 'Courses, Books, Stationery'
  },
  'gifts-social': {
    label: 'Gifts & Social',
    icon: '🎁',
    color: '#e11d48',
    bgColor: '#fff1f2',
    textColor: '#be123c',
    description: 'Parties, Gifts, Dining out'
  },
  'savings-investment': {
    label: 'Savings',
    icon: '💰',
    color: '#059669',
    bgColor: '#ecfdf5',
    textColor: '#047857',
    description: 'SIP, FD, Emergency Fund'
  },
  'other': {
    label: 'Other',
    icon: '📦',
    color: '#94a3b8',
    bgColor: '#f8fafc',
    textColor: '#64748b',
    description: 'Miscellaneous expenses'
  }
};

export const PAYMENT_METHODS = [
  { value: 'upi', label: 'UPI', icon: '📲' },
  { value: 'card', label: 'Card', icon: '💳' },
  { value: 'cash', label: 'Cash', icon: '💵' },
  { value: 'netbanking', label: 'Net Banking', icon: '🏦' },
  { value: 'other', label: 'Other', icon: '💸' }
];

export const formatCurrency = (amount, currency = '₹') => {
  if (amount === undefined || amount === null) return `${currency}0`;
  return `${currency}${Number(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}`;
};

export const formatDate = (date) => {
  return new Date(date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
};

export const getMonthName = (month) => {
  return new Date(2000, month - 1).toLocaleString('en-IN', { month: 'long' });
};

export const getBudgetStatus = (percentage) => {
  if (percentage >= 100) return { label: 'Over Budget', color: 'text-red-600', bg: 'bg-red-500' };
  if (percentage >= 80) return { label: 'Near Limit', color: 'text-amber-600', bg: 'bg-amber-500' };
  if (percentage >= 50) return { label: 'Moderate', color: 'text-blue-600', bg: 'bg-blue-500' };
  return { label: 'On Track', color: 'text-emerald-600', bg: 'bg-emerald-500' };
};
