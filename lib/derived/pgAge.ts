/**
 * A faithful TypeScript port of PostgreSQL's `age(timestamp, timestamp)` for
 * plain dates, plus `extract(year|month|day from …)` on the result.
 *
 * FROZEN CONTRACT (Wave 1). This exists because the derived columns live in
 * two places that must agree: `v_employees` computes them in SQL for lists and
 * for the API, and the UI recomputes them client-side for a row it already has
 * (PRD #6, ARCHITECTURE.md §6 "kolom turunan dihitung di view / lib/derived").
 * If the two disagree, a Karyawan's masa kerja changes when you open their
 * detail page — which is exactly the sort of quiet wrongness nobody reports.
 *
 * Postgres builds a *symbolic* difference rather than counting days:
 *
 *   1. subtract field by field — year, month, day;
 *   2. while the day field is negative, add the number of days in the month of
 *      the **earlier** date and borrow one month;
 *   3. while the month field is negative, add 12 and borrow one year.
 *
 * That borrow rule is why `age('2024-03-01','2024-01-31')` is `1 mon 1 day`
 * and not `1 mon 2 days`: January's 31 days are borrowed, not February's 29.
 * Counting days and dividing by 365.25 gets this wrong several days a year,
 * every year, so it is not done here.
 */

/** A calendar date with a 1-based month, the way Postgres thinks of one. */
export type CalendarDate = {
  year: number;
  /** 1 = January. */
  month: number;
  day: number;
};

/** The three fields of the interval `age()` returns. */
export type PgAgeInterval = {
  years: number;
  /** Residual months after whole years: 0–11 (negative for a future date). */
  months: number;
  /** Residual days after whole months. */
  days: number;
};

/** Anything a date column can arrive as. */
export type DateInput = string | Date | null | undefined;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in a 1-based month, matching Postgres's `day_tab`. */
export function daysInMonth(year: number, month: number): number {
  const table = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) return 29;
  return table[month - 1];
}

/**
 * Parse a date column value.
 *
 * Accepts `"YYYY-MM-DD"` (what PostgREST returns for a `date`, and what
 * `<input type="date">` submits) and `Date`, whose **local** fields are read —
 * on Vercel and in Postgres "local" is UTC, and in a browser it is the user's
 * own day, which is the day they mean. Returns `null` for null, undefined,
 * empty, or an unparseable value, because a Karyawan with no
 * `original_start_date` has no masa kerja, not a masa kerja of zero.
 */
export function parseCalendarDate(value: DateInput): CalendarDate | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
    };
  }

  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** Today, as the runtime's local date — the counterpart of `current_date`. */
export function today(): CalendarDate {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function compare(a: CalendarDate, b: CalendarDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

/**
 * `age(a, b)` — the symbolic difference between two dates.
 *
 * Positive when `a` is later than `b`. When `a` is earlier, Postgres computes
 * the difference the other way round and negates every field, so a date in the
 * future yields negative years/months, and this does the same.
 */
export function pgAge(a: CalendarDate, b: CalendarDate): PgAgeInterval {
  const negative = compare(a, b) < 0;
  const later = negative ? b : a;
  const earlier = negative ? a : b;

  let years = later.year - earlier.year;
  let months = later.month - earlier.month;
  let days = later.day - earlier.day;

  // Borrow from the EARLIER date's own month — Postgres's
  // `day_tab[isleap(tm2->tm_year)][tm2->tm_mon - 1]`, which stays fixed across
  // iterations. Day fields are 1–31, so their difference is at worst -30 and
  // the loop can only ever run once; it is a `while` because Postgres's is.
  while (days < 0) {
    days += daysInMonth(earlier.year, earlier.month);
    months -= 1;
  }

  while (months < 0) {
    months += 12;
    years -= 1;
  }

  // `negate(0)` is 0, not -0: Postgres reports a zero field as 0, and -0 would
  // quietly fail an `Object.is` comparison in a test or a memo.
  return negative
    ? { years: negate(years), months: negate(months), days: negate(days) }
    : { years, months, days };
}

function negate(value: number): number {
  return value === 0 ? 0 : -value;
}

/**
 * `extract(year from age(asOf, value))` — whole years, or `null`.
 *
 * `null` in, `null` out: that is what the view does too, because `extract`
 * from a NULL interval is NULL.
 */
export function yearsSince(value: DateInput, asOf?: DateInput): number | null {
  const interval = ageSince(value, asOf);
  return interval ? interval.years : null;
}

/** The whole `age()` interval between `value` and `asOf` (default: today). */
export function ageSince(value: DateInput, asOf?: DateInput): PgAgeInterval | null {
  const from = parseCalendarDate(value);
  if (!from) return null;
  const to = asOf === undefined ? today() : parseCalendarDate(asOf);
  if (!to) return null;
  return pgAge(to, from);
}
