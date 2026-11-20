export function money(minor: string | null, signed = false, currency = 'INR'): string {
  if (minor === null) return '—';
  const number = BigInt(minor), negative = number < 0n, absolute = negative ? -number : number;
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${negative ? '−' : signed && number > 0n ? '+' : ''}${symbol}${(absolute / 100n).toLocaleString('en-IN')}.${(absolute % 100n).toString().padStart(2, '0')}`;
}
export function shortDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}
