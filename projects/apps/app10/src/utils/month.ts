const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function getCurrentMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function formatMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) return monthKey;
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function getSeasonForMonthKey(monthKey: string): string {
  const month = Number(monthKey.split('-')[1]);
  if (month === 12 || month <= 2) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'autumn';
}

export function getCurrentMonthLabel(date = new Date()): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}
