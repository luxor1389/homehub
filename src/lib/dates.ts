// Plain calendar dates are handled as 'YYYY-MM-DD' strings to avoid time-zone drift.
export type ISODate = string;

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): ISODate {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export function parseISODate(s: ISODate): Date {
  return new Date(`${s}T12:00:00Z`);
}
/** Today in the given IANA time zone (e.g. the household's Europe/Belgrade). */
export function todayIn(timeZone: string): ISODate {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function addDays(s: ISODate, n: number): ISODate {
  const d = parseISODate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toISODate(d);
}
export function addMonths(s: ISODate, n: number): ISODate {
  const d = parseISODate(s);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return toISODate(d);
}
/** ISO weekday 1 = Monday … 7 = Sunday */
export function isoWeekday(s: ISODate): number {
  const w = parseISODate(s).getUTCDay();
  return w === 0 ? 7 : w;
}
export function startOfWeek(s: ISODate): ISODate {
  return addDays(s, 1 - isoWeekday(s));
}
export function startOfMonth(s: ISODate): ISODate {
  return `${s.slice(0, 7)}-01`;
}
export function endOfMonth(s: ISODate): ISODate {
  return addDays(addMonths(startOfMonth(s), 1), -1);
}
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86400000);
}
/** 6-week grid (Monday first) covering the month of `s`. */
export function monthGrid(s: ISODate): ISODate[] {
  const first = startOfWeek(startOfMonth(s));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

export function intlLocale(locale: string): string {
  return locale === 'en' ? 'en-GB' : 'sr-Latn-RS';
}
export function formatDate(s: ISODate | null | undefined, locale: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  if (!s) return '';
  return new Intl.DateTimeFormat(intlLocale(locale), { ...opts, timeZone: 'UTC' }).format(parseISODate(s.slice(0, 10)));
}
export function formatDateTime(ts: string | null | undefined, locale: string, timeZone: string): string {
  if (!ts) return '';
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(ts));
}
export function formatTime(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : '';
}
export function weekdayName(isoDow: number, locale: string, width: 'short' | 'long' = 'short'): string {
  // 2024-01-01 was a Monday
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: width, timeZone: 'UTC' }).format(parseISODate(addDays('2024-01-01', isoDow - 1)));
}
export function monthTitle(s: ISODate, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parseISODate(s));
}
export function formatMoney(amount: number | null | undefined, currency: string, locale: string): string {
  if (amount == null) return '';
  try {
    return new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
export function formatNumber(n: number | null | undefined, locale: string, digits = 2): string {
  if (n == null) return '';
  return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: digits }).format(n);
}
export function relativeDays(target: ISODate, today: ISODate): number {
  return daysBetween(today, target);
}
