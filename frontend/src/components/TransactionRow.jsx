import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { formatCurrency, formatDate, getTransactionDisplay } from '../lib/constants';

/**
 * Shared PhonePe-style transaction row displaying clear direction arrows,
 * "Paid to" / "Received from" counterparty labels, and "Debited from" / "Credited to" source.
 */
export default function TransactionRow({
  transaction,
  currency = '₹',
  onDelete,
  compact = false,
  showDivider = false,
  className = '',
}) {
  const {
    isIncome,
    cat,
    paymentMeta,
    directionLabel,
    railLabel,
    railSource,
    displayName,
  } = getTransactionDisplay(transaction);

  const dateText = compact
    ? new Date(transaction.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : formatDate(transaction.date);

  return (
    <div
      className={`flex items-center gap-3 sm:gap-3.5 ${
        compact ? 'px-3 py-2.5 rounded-xl' : 'px-3.5 py-3.5 sm:px-5 sm:py-4'
      } hover:bg-gray-50/90 transition-colors ${
        showDivider ? 'border-b border-gray-100' : ''
      } ${className}`}
    >
      {/* Pure direction arrow circle */}
      <div
        className={`${
          compact ? 'w-9 h-9' : 'w-10 h-10 sm:w-11 sm:h-11'
        } rounded-full flex items-center justify-center flex-shrink-0 ${
          isIncome
            ? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100'
            : 'bg-gray-100 text-gray-700 ring-1 ring-gray-200/70'
        }`}
        aria-hidden="true"
      >
        {isIncome ? (
          <ArrowDownLeft className={compact ? 'w-4 h-4' : 'w-5 h-5'} strokeWidth={2.25} />
        ) : (
          <ArrowUpRight className={compact ? 'w-4 h-4' : 'w-5 h-5'} strokeWidth={2.25} />
        )}
      </div>

      {/* Direction label + Counterparty name + Date/Category */}
      <div className="flex-1 min-w-0">
        <p className="text-[11px] sm:text-xs font-medium text-gray-400 leading-tight">
          {directionLabel}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
          <p className={`font-semibold ${compact ? 'text-sm' : 'text-sm sm:text-base'} text-gray-900 truncate leading-snug`}>
            {displayName}
          </p>
          {!compact && transaction.isRecurring && (
            <span className="badge-blue text-[10px] sm:text-xs">🔄 Recurring</span>
          )}
          {!compact && transaction.receiptUrl && (
            <a
              href={transaction.receiptUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-500 hover:underline flex items-center gap-0.5"
            >
              📷 Receipt
            </a>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap text-[11px] sm:text-xs">
          <span className="text-gray-400">{dateText}</span>
          <span className="text-gray-300">·</span>
          <span className="font-medium truncate" style={{ color: cat?.textColor }}>
            {cat?.icon} {cat?.label}
          </span>
        </div>
        {!compact && transaction.note && (
          <p className="text-[11px] text-gray-400 mt-0.5 truncate">{transaction.note}</p>
        )}
      </div>

      {/* Amount + Debited from / Credited to + Optional delete */}
      <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
        <div className="text-right">
          <p
            className={`font-bold ${compact ? 'text-sm' : 'text-sm sm:text-base'} tabular-nums leading-snug ${
              isIncome ? 'text-emerald-600' : 'text-gray-900'
            }`}
          >
            {isIncome ? '+ ' : ''}
            {formatCurrency(transaction.amount, currency)}
          </p>
          <p className="text-[10px] sm:text-[11px] text-gray-400 mt-0.5 flex items-center justify-end gap-1 whitespace-nowrap">
            <span>{railLabel}</span>
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-700 font-semibold text-[10px]">
              <span>{paymentMeta.icon}</span>
              <span>{railSource}</span>
            </span>
          </p>
        </div>
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete({ ...transaction, displayName })}
            aria-label={`Delete ${displayName}`}
            className="text-xs text-gray-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-lg transition-colors"
          >
            🗑️
          </button>
        )}
      </div>
    </div>
  );
}
