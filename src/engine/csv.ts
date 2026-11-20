import type { BankRecord, BaseRecord, PlatformRecord } from './types';

// Small RFC 4180 reader: quoted fields, escaped quotes, CRLF and embedded newlines.
function rows(text: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === '"') {
      if (field || closed) throw new Error('Unexpected quote in CSV field.');
      quoted = true;
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(field); field = ''; closed = false;
      if (char !== ',') {
        if (char === '\r' && text[i + 1] === '\n') i++;
        if (row.some(value => value !== '')) result.push(row);
        row = [];
      }
    } else {
      if (closed) throw new Error('Unexpected text after a quoted CSV field.');
      field += char;
    }
  }
  if (quoted) throw new Error('Unclosed quoted CSV field.');
  if (field || row.length || closed) { row.push(field); result.push(row); }
  return result;
}

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseCsv(text: string, source: 'platform'): PlatformRecord[];
export function parseCsv(text: string, source: 'bank'): BankRecord[];
export function parseCsv(text: string, source: 'platform' | 'bank'): (PlatformRecord | BankRecord)[] {
  const [headers, ...data] = rows(text);
  const dateField = source === 'platform' ? 'recordedOn' : 'settledOn';
  const required = ['id', 'reference', 'type', 'parentReference', 'amountMinor', 'feeMinor', 'currency', dateField, 'batchId'];
  if (!headers || new Set(headers).size !== headers.length || required.some(name => !headers.includes(name))) {
    throw new Error(`${source}: CSV must include unique headers: ${required.join(', ')}.`);
  }
  return data.map((values, index) => {
    const fail = (message: string): never => { throw new Error(`${source}, row ${index + 2}: ${message}`); };
    if (values.length !== headers.length) fail('Column count does not match the header.');
    const row = Object.fromEntries(headers.map((header, i) => [header, values[i].trim()]));
    for (const field of ['id', 'reference', 'currency', dateField, 'batchId']) if (!row[field]) fail(`Missing ${field}.`);
    if (row.type !== 'payment' && row.type !== 'refund') fail('Type must be payment or refund.');
    if (!/^-?\d+$/.test(row.amountMinor) || !/^\d+$/.test(row.feeMinor)) fail('Amounts must be integer minor units; fees cannot be negative.');
    if (!validDate(row[dateField])) fail(`Invalid ${dateField}.`);
    if (!/^[A-Za-z]{3}$/.test(row.currency)) fail('Currency must be a three-letter code.');
    if (row.type === 'refund' && (!row.parentReference || BigInt(row.amountMinor) >= 0n)) fail('Refunds require a parent reference and a negative amount.');
    if (row.type === 'payment' && BigInt(row.amountMinor) < 0n) fail('Payment amounts cannot be negative.');
    row.currency = row.currency.toUpperCase();
    return row as unknown as BaseRecord & (PlatformRecord | BankRecord);
  });
}
