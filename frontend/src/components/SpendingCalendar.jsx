import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isAfter,
  addMonths,
  subMonths,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Plus } from 'lucide-react';
import { CATEGORIES, formatCurrency } from '../lib/constants';

function toDayKey(dateInput) {
  const d = new Date(dateInput);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatCompactAmount(amount, currency) {
  if (amount >= 100000) return `${currency}${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `${currency}${(amount / 1000).toFixed(amount >= 10000 ? 0 : 1)}k`;
  return `${currency}${Math.round(amount)}`;
}

export default function SpendingCalendar({ expenses = [], currency = '₹' }) {
  const today = useMemo(() => new Date(), []);
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => new Date());

  // Group expenses by local YYYY-MM-DD key
  const { byDay, monthTotal, monthMaxDay, noSpendDays } = useMemo(() => {
    const map = {};
    expenses.forEach((exp) => {
      const key = toDayKey(exp.date);
      if (!map[key]) map[key] = { total: 0, items: [] };
      map[key].total += Number(exp.amount) || 0;
      map[key].items.push(exp);
    });

    const mStart = startOfMonth(currentMonth);
    const mEnd = endOfMonth(currentMonth);
    const daysInCurrentMonth = eachDayOfInterval({ start: mStart, end: mEnd });

    let mTotal = 0;
    let maxDay = 0;
    let zeroDays = 0;

    daysInCurrentMonth.forEach((day) => {
      const key = toDayKey(day);
      const dayAmt = map[key]?.total || 0;
      mTotal += dayAmt;
      if (dayAmt > maxDay) maxDay = dayAmt;
      if (dayAmt === 0 && !isAfter(day, today)) zeroDays += 1;
    });

    return { byDay: map, monthTotal: mTotal, monthMaxDay: maxDay, noSpendDays: zeroDays };
  }, [expenses, currentMonth, today]);

  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 }); // Mon start
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const selectedKey = toDayKey(selectedDate);
  const selectedData = byDay[selectedKey] || { total: 0, items: [] };
  const isTodaySelected = isSameDay(selectedDate, today);

  const handleJumpToday = () => {
    const now = new Date();
    setCurrentMonth(startOfMonth(now));
    setSelectedDate(now);
  };

  return (
    <div className="card p-4 sm:p-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <CalendarIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Spending Calendar</h2>
            <p className="text-xs text-gray-500">
              Click any date to inspect expenses ·{' '}
              <span className="text-emerald-600 font-semibold">{noSpendDays} no-spend days</span> this month
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={handleJumpToday}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
          >
            Today
          </button>
          <div className="flex items-center bg-gray-100 rounded-xl p-0.5">
            <button
              type="button"
              onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
              className="p-1.5 rounded-lg hover:bg-white text-gray-600 transition-all"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-bold text-gray-800 px-3 min-w-[100px] text-center">
              {format(currentMonth, 'MMM yyyy')}
            </span>
            <button
              type="button"
              onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
              className="p-1.5 rounded-lg hover:bg-white text-gray-600 transition-all"
              aria-label="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 2-Column Body: Calendar Grid + Selected Day Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: Month Calendar Grid */}
        <div className="lg:col-span-7">
          {/* Weekday Headers */}
          <div className="grid grid-cols-7 gap-1 mb-1.5">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="text-center text-[10px] font-semibold text-gray-400 uppercase tracking-wider py-0.5">
                {d}
              </div>
            ))}
          </div>

          {/* Day Cells */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day) => {
              const key = toDayKey(day);
              const inMonth = isSameMonth(day, currentMonth);
              const isSelected = isSameDay(day, selectedDate);
              const isToday = isSameDay(day, today);
              const isFuture = isAfter(day, today);
              const dayInfo = byDay[key];
              const daySpend = dayInfo?.total || 0;

              // Heatmap intensity for days with spending
              const ratio = monthMaxDay > 0 ? daySpend / monthMaxDay : 0;
              let cellBg = 'bg-white hover:bg-gray-50 border-gray-100';
              let pillClass = 'text-gray-400';

              if (!inMonth) {
                cellBg = 'bg-gray-50/40 border-transparent opacity-40';
              } else if (isSelected) {
                cellBg = 'bg-blue-600 border-blue-600 text-white shadow-md scale-[1.02]';
                pillClass = 'bg-white/20 text-white';
              } else if (daySpend > 0) {
                if (ratio >= 0.65) {
                  cellBg = 'bg-red-50/80 hover:bg-red-100/70 border-red-200';
                  pillClass = 'text-red-700 font-bold';
                } else if (ratio >= 0.3) {
                  cellBg = 'bg-amber-50/80 hover:bg-amber-100/70 border-amber-200';
                  pillClass = 'text-amber-700 font-semibold';
                } else {
                  cellBg = 'bg-blue-50/60 hover:bg-blue-100/60 border-blue-100';
                  pillClass = 'text-blue-700 font-semibold';
                }
              } else if (!isFuture) {
                cellBg = 'bg-emerald-50/40 hover:bg-emerald-50 border-emerald-100/70';
              }

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setSelectedDate(day);
                    if (!inMonth) setCurrentMonth(startOfMonth(day));
                  }}
                  className={`relative h-11 sm:h-12 rounded-lg border p-1 flex flex-col items-center justify-between transition-all ${cellBg}`}
                >
                  <div className="w-full flex items-center justify-between px-0.5">
                    <span
                      className={`text-xs font-semibold leading-none ${
                        isSelected
                          ? 'text-white'
                          : isToday
                          ? 'text-blue-600 font-bold underline underline-offset-2'
                          : inMonth
                          ? 'text-gray-800'
                          : 'text-gray-400'
                      }`}
                    >
                      {format(day, 'd')}
                    </span>
                    {inMonth && !isFuture && daySpend === 0 && !isSelected && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="No-spend day" />
                    )}
                  </div>

                  {daySpend > 0 ? (
                    <span
                      className={`text-[10px] leading-tight px-1.5 py-0.5 rounded-md truncate max-w-full ${pillClass}`}
                    >
                      {formatCompactAmount(daySpend, currency)}
                    </span>
                  ) : (
                    <span className="text-[10px] text-transparent select-none">-</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center justify-between gap-2 mt-3 pt-3 border-t border-gray-100 text-[11px] text-gray-500">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span> No-Spend
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span> Low
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500"></span> Medium
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500"></span> High
              </span>
            </div>
            <span>
              Month Total: <strong className="text-gray-800">{formatCurrency(monthTotal, currency)}</strong>
            </span>
          </div>
        </div>

        {/* Right: Selected Day Breakdown */}
        <div className="lg:col-span-5 bg-gray-50/80 rounded-2xl border border-gray-100 p-4 flex flex-col">
          <div className="flex items-start justify-between gap-2 pb-3 border-b border-gray-200/70">
            <div>
              <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider">
                {isTodaySelected ? 'Today' : format(selectedDate, 'EEEE')}
              </p>
              <h3 className="text-lg font-bold text-gray-900">
                {format(selectedDate, 'd MMM yyyy')}
              </h3>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-gray-500">Day Total</p>
              <p className={`text-lg font-bold ${selectedData.total > 0 ? 'text-gray-900' : 'text-emerald-600'}`}>
                {formatCurrency(selectedData.total, currency)}
              </p>
            </div>
          </div>

          {/* Expense List for Selected Day */}
          <div className="flex-1 py-2.5 space-y-2 max-h-[210px] overflow-y-auto">
            {selectedData.items.length > 0 ? (
              selectedData.items.map((e) => {
                const cat = CATEGORIES[e.category] || CATEGORIES.other;
                return (
                  <div
                    key={e.id}
                    className="flex items-center gap-3 p-2.5 bg-white rounded-xl border border-gray-100 shadow-sm"
                  >
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0"
                      style={{ backgroundColor: cat.bgColor }}
                    >
                      {cat.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{e.title}</p>
                      <p className="text-[11px] text-gray-400">
                        {cat.label} · {e.paymentMethod?.toUpperCase() || 'UPI'}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-gray-900 flex-shrink-0">
                      {formatCurrency(e.amount, currency)}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="h-full min-h-[180px] flex flex-col items-center justify-center text-center px-4">
                <div className="text-3xl mb-2">{isAfter(selectedDate, today) ? '🗓️' : '🌿'}</div>
                <p className="text-sm font-semibold text-gray-700">
                  {isAfter(selectedDate, today) ? 'Upcoming date' : 'Zero-spend day!'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  No expenses recorded on {format(selectedDate, 'd MMM')}.
                </p>
              </div>
            )}
          </div>

          {/* Quick Add for Selected Date */}
          <Link
            to={`/add-expense?date=${selectedKey}`}
            className="mt-2 w-full py-2.5 px-3 rounded-xl bg-white hover:bg-blue-50 border border-gray-200 hover:border-blue-300 text-xs font-semibold text-blue-600 flex items-center justify-center gap-1.5 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            Add expense for {format(selectedDate, 'd MMM')}
          </Link>
        </div>
      </div>
    </div>
  );
}
