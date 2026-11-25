import { CATEGORIES, formatCurrency } from './constants';

/**
 * Evaluate a single budget object against spent amount and return structured alert info.
 */
export function buildBudgetAlert(budget, spent, currency = '₹') {
  if (!budget || !budget.limit || budget.limit <= 0) return null;

  const limit = Number(budget.limit);
  const alertAt = Number(budget.alertAt) || 80;
  const percentage = Math.round((spent / limit) * 100);
  const remaining = Math.max(0, limit - spent);
  const overBy = Math.max(0, spent - limit);
  const cat = CATEGORIES[budget.category];
  const label = cat?.label || budget.category;

  if (spent > limit) {
    return {
      category: budget.category,
      icon: cat?.icon || '🚨',
      label,
      level: 'over',
      spent,
      limit,
      percentage,
      remaining: 0,
      overBy,
      message: `${label} is ${formatCurrency(overBy, currency)} over your ${formatCurrency(limit, currency)} limit (${percentage}% used).`,
    };
  }

  if (spent === limit || percentage >= 100) {
    return {
      category: budget.category,
      icon: cat?.icon || '⚠️',
      label,
      level: 'reached',
      spent,
      limit,
      percentage,
      remaining: 0,
      overBy: 0,
      message: `${label} hit 100% of your ${formatCurrency(limit, currency)} limit (${currency}0 left).`,
    };
  }

  if (percentage >= alertAt) {
    return {
      category: budget.category,
      icon: cat?.icon || '⚠️',
      label,
      level: 'near',
      spent,
      limit,
      percentage,
      remaining,
      overBy: 0,
      message: `${label} is at ${percentage}% (${formatCurrency(remaining, currency)} left of ${formatCurrency(limit, currency)}).`,
    };
  }

  return null;
}
