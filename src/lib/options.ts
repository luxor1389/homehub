export function timeZones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
    if (list?.length) return list.includes('Europe/Belgrade') ? list : ['Europe/Belgrade', ...list];
  } catch { /* older browsers */ }
  return ['Europe/Belgrade', 'Europe/Ljubljana', 'Europe/Zagreb', 'Europe/Sarajevo', 'Europe/Podgorica', 'Europe/Skopje', 'Europe/Vienna', 'Europe/Berlin', 'Europe/London', 'UTC', 'America/New_York'];
}
export const CURRENCIES = ['RSD', 'EUR', 'USD', 'CHF', 'GBP', 'BAM', 'HRK', 'MKD', 'HUF'];
