import { validDate } from './csv';
import type { BankRecord, PlatformRecord, Issue, ReconciliationReport, ReferenceResult } from './types';

type Financial = { amountMinor: string; feeMinor: string };
const sum = (records: Financial[], net = false): bigint => records.reduce((total, row) => total + BigInt(row.amountMinor) - (net ? BigInt(row.feeMinor) : 0n), 0n);
const feeSum = (records: Financial[]) => records.reduce((total, row) => total + BigInt(row.feeMinor), 0n);
function group<T>(records: T[], key: (record: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  records.forEach(row => { const id = key(row); map.set(id, [...(map.get(id) ?? []), row]); });
  return map;
}
function dueDate(day: string, lag: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + lag);
  return date.toISOString().slice(0, 10);
}
const halfUpFee = (gross: bigint, bps: bigint) => (gross * bps + 5000n) / 10000n;

/** Pure reconciliation, exact signed minor-unit arithmetic, no React or I/O.
 * Source rows are retained; totals always include raw duplicates. A separate
 * issue explains their impact without silently treating them as extra cash.
 * One currency per run; normalized date-only inputs; calendar-day settlement.
 */
export function reconcile(
  platformInput: PlatformRecord[], bankInput: BankRecord[],
  options: { asOf: string; maxSettlementDays?: number; feeBasisPoints?: number },
): ReconciliationReport {
  const { asOf, maxSettlementDays = 2, feeBasisPoints = 200 } = options;
  if (!validDate(asOf)) throw new Error('Choose a valid reconciliation date.');
  if (!Number.isSafeInteger(maxSettlementDays) || maxSettlementDays < 0 || maxSettlementDays > 366) throw new Error('Settlement window must be 0–366 calendar days.');
  if (!Number.isSafeInteger(feeBasisPoints) || feeBasisPoints < 0 || feeBasisPoints > 10000) throw new Error('Invalid fee rate.');
  // Validate even callers that bypass CSV parsing.
  for (const row of [...platformInput, ...bankInput]) {
    const day = 'recordedOn' in row ? row.recordedOn : row.settledOn;
    if (!row.id?.trim() || !row.reference?.trim() || !row.batchId?.trim() || !/^[A-Z]{3}$/.test(row.currency) || !validDate(day)
      || !/^-?\d+$/.test(row.amountMinor) || !/^\d+$/.test(row.feeMinor)
      || !['payment', 'refund'].includes(row.type)
      || (row.type === 'refund' && (!row.parentReference || BigInt(row.amountMinor) >= 0n))
      || (row.type === 'payment' && BigInt(row.amountMinor) < 0n)) throw new Error(`Invalid financial record: ${row.id || 'missing ID'}.`);
  }
  const currencies = new Set([...platformInput, ...bankInput].map(row => row.currency));
  if (currencies.size > 1) throw new Error('Reconcile one currency at a time. Currency conversion is not supported.');
  const platform = platformInput.filter(row => row.recordedOn <= asOf);
  const bank = bankInput.filter(row => row.settledOn <= asOf);
  const pg = group(platform, row => row.reference), bg = group(bank, row => row.reference);
  const platformIds = group(platform, row => row.id), bankIds = group(bank, row => row.id);
  const records: ReferenceResult[] = [];
  const issues: Issue[] = [];

  const addIssue = (record: ReferenceResult, details: Pick<Issue, 'kind' | 'title' | 'subtitle' | 'explanation' | 'action'> & Partial<Issue>) => {
    issues.push({ id: `${details.kind}:${record.reference}`, severity: 'review', reference: record.reference,
      batchId: record.platform[0]?.batchId ?? record.bank[0]?.batchId ?? '',
      platform: record.platform, bank: record.bank, expectedMinor: record.expectedMinor,
      actualMinor: record.actualMinor, differenceMinor: record.differenceMinor,
      affectedReferences: [record.reference], facts: [], ...details });
  };

  for (const reference of [...new Set([...pg.keys(), ...bg.keys()])].sort()) {
    const p = pg.get(reference) ?? [], b = bg.get(reference) ?? [];
    const expected = p.length ? sum(p, true) : null, actual = b.length ? sum(b) : null;
    const duplicate = p.length > 1 || b.length > 1 || p.some(row => platformIds.get(row.id)!.length > 1) || b.some(row => bankIds.get(row.id)!.length > 1);
    const delta = (actual ?? 0n) - (expected ?? 0n);
    const parentPresent = b[0]?.parentReference ? platform.some(row => row.reference === b[0].parentReference && row.type === 'payment') : false;
    const status = duplicate ? 'duplicate' : !p.length ? (b[0].type === 'refund' ? 'orphan_refund' : 'bank_only')
      : !b.length ? (asOf > dueDate(p[0].recordedOn, maxSettlementDays) ? 'overdue' : 'pending')
      : p[0].type !== b[0].type || p[0].parentReference !== b[0].parentReference || delta !== 0n ? 'difference' : 'matched';
    const record: ReferenceResult = { reference, platform: p, bank: b, expectedMinor: expected?.toString() ?? null,
      actualMinor: actual?.toString() ?? null, differenceMinor: delta.toString(), status,
      dueOn: p.length ? dueDate(p[0].recordedOn, maxSettlementDays) : undefined,
      crossMonth: p.length === 1 && b.length === 1 && p[0].recordedOn.slice(0, 7) !== b[0].settledOn.slice(0, 7) };
    records.push(record);
    if (duplicate) {
      const exactCopies = b.length > 1 && new Set(b.map(row => JSON.stringify(row))).size === 1 && p.length === 1;
      addIssue(record, { kind: 'duplicate_entry', title: 'Duplicate entry', subtitle: exactCopies ? 'The same bank row was imported twice' : 'Multiple records prevent a unique match',
        explanation: exactCopies ? 'One platform payment is linked to two identical bank-export rows, including the same bank ID. The raw bank total includes the extra occurrence; this is not evidence of a second transfer.' : 'A source ID or payment reference repeats. These records cannot be matched uniquely, so none has been automatically cleared.',
        action: 'Confirm the export duplicate, retain its source evidence, and exclude only the verified excess row from adjusted totals.',
        facts: [{ label: 'Platform occurrences', value: String(p.length) }, { label: 'Bank occurrences', value: String(b.length) }, { label: 'Bank IDs', value: b.map(row => row.id).join(', ') }] });
    } else if (status === 'orphan_refund') {
      addIssue(record, { kind: 'orphan_refund', title: 'Orphan refund', subtitle: 'Bank refund has no platform counterpart',
        explanation: `The bank shows a refund debit with no matching platform refund. ${parentPresent ? 'Its original payment is present, but the refund event is missing.' : 'Its original payment is also absent from the supplied platform extract and may be outside its date coverage.'}`,
        action: 'Check the refund reference and retrieve the original payment or older platform history before clearing this debit.',
        facts: [{ label: 'Parent payment', value: b[0].parentReference }, { label: 'Parent in platform extract', value: parentPresent ? 'Yes' : 'No' }, { label: 'Matching platform refund', value: 'Not found' }] });
    } else if (status === 'overdue' || status === 'bank_only') {
      addIssue(record, { kind: status === 'overdue' ? 'overdue_settlement' : 'bank_only', title: status === 'overdue' ? 'Overdue settlement' : 'Bank-only record', subtitle: 'A matching source record is missing',
        explanation: status === 'overdue' ? `No bank settlement is available after the expected date of ${record.dueOn}.` : 'No platform event has this reference in the supplied extract.',
        action: 'Verify source coverage and the shared reference, then request the missing settlement or transaction.' });
    } else if (record.crossMonth && status === 'matched') {
      addIssue(record, { kind: 'cross_month_settlement', severity: 'timing', title: 'Cross-month settlement', subtitle: 'Payment and cash fall in different months',
        explanation: `The payment was recorded on ${p[0].recordedOn} and settled on ${b[0].settledOn}. The reference, fee-adjusted amount, and currency agree. Different reporting months explain the month-end mismatch.`,
        action: 'Carry the expected net as an outstanding settlement at month-end, then clear it against the following month’s bank receipt.',
        facts: [{ label: 'Platform date', value: p[0].recordedOn }, { label: 'Bank date', value: b[0].settledOn }, { label: 'Expected by', value: record.dueOn! }] });
    }
  }

  const roundingReferences = new Set<string>();
  const bps = BigInt(feeBasisPoints);
  for (const [batchId, p] of group(platform, row => row.batchId)) {
    const b = bank.filter(row => row.batchId === batchId);
    const related = records.filter(row => row.platform.some(item => item.batchId === batchId));
    if (p.length < 2 || b.length !== p.length || related.length !== p.length
      || related.some(row => row.platform.length !== 1 || row.bank.length !== 1 || row.status === 'duplicate' || row.bank[0].batchId !== batchId)
      || p.some(row => row.type !== 'payment' || BigInt(row.feeMinor) !== halfUpFee(BigInt(row.amountMinor), bps))
      || b.some(row => row.type !== 'payment') || related.some(row => row.platform[0].parentReference !== row.bank[0].parentReference)) continue;
    const gross = sum(p), aggregateFee = halfUpFee(gross, bps);
    const allocations = p.map(row => ({ reference: row.reference, fee: BigInt(row.amountMinor) * bps / 10000n, remainder: BigInt(row.amountMinor) * bps % 10000n }));
    let residual = aggregateFee - allocations.reduce((total, row) => total + row.fee, 0n);
    allocations.sort((a, b) => a.remainder === b.remainder ? a.reference.localeCompare(b.reference) : a.remainder > b.remainder ? -1 : 1);
    const allocated = new Map(allocations.map(row => { const fee = row.fee + (residual > 0n ? 1n : 0n); if (residual > 0n) residual--; return [row.reference, fee]; }));
    if (feeSum(b) !== aggregateFee || related.some(row => BigInt(row.bank[0].feeMinor) !== allocated.get(row.reference)
      || BigInt(row.bank[0].amountMinor) !== BigInt(row.platform[0].amountMinor) - BigInt(row.bank[0].feeMinor))) continue;
    const difference = sum(b) - sum(p, true);
    if (difference === 0n) continue;
    const affected = related.filter(row => row.differenceMinor !== '0');
    affected.forEach(row => roundingReferences.add(row.reference));
    issues.push({ id: `rounding:${batchId}`, kind: 'cumulative_rounding_difference', title: 'Cumulative rounding difference',
      subtitle: `${affected.length} small differences in one settlement batch`, severity: 'review', reference: batchId, batchId,
      platform: p, bank: b, expectedMinor: sum(p, true).toString(), actualMinor: sum(b).toString(), differenceMinor: difference.toString(),
      explanation: `The platform rounds each ${feeBasisPoints / 100}% payment fee separately. The bank rounds the batch fee once, then allocates it across payments. The individual differences accumulate into one explainable batch variance. Both rounding policies were verified against the source amounts.`,
      action: 'Confirm the agreed fee-rounding policy and record a rounding adjustment if approved. Review the batch once, rather than treating each paise as an unrelated issue.',
      affectedReferences: affected.map(row => row.reference),
      facts: [{ label: 'Payments in batch', value: String(p.length) }, { label: 'Affected payments', value: String(affected.length) }, { label: 'Platform policy', value: 'Round each fee · half up' }, { label: 'Bank policy', value: 'Round total fee · allocate largest remainders' }] });
  }
  for (const record of records.filter(row => row.status === 'difference' && !roundingReferences.has(row.reference))) {
    addIssue(record, { kind: 'amount_mismatch', title: 'Amount or event mismatch', subtitle: 'The records do not agree', explanation: 'The linked records differ in their expected net amount, event type, or refund parent. No verified rounding policy explains the difference.', action: 'Check the gross amount, fee, and refund lineage with the payment provider.' });
  }
  issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'review' ? -1 : 1) || a.title.localeCompare(b.title));
  const platformNet = sum(platform, true), bankNet = sum(bank);
  return { asOf, currency: [...currencies][0] ?? 'INR', maxSettlementDays, records, issues,
    platformNetMinor: platformNet.toString(), bankNetMinor: bankNet.toString(), differenceMinor: (bankNet - platformNet).toString(),
    platformRows: platform.length, bankRows: bank.length, excludedRows: platformInput.length + bankInput.length - platform.length - bank.length,
    matchedCount: records.filter(row => row.status === 'matched').length, pendingCount: records.filter(row => row.status === 'pending').length,
    duplicateExcessRows: [...platformIds.values(), ...bankIds.values()].reduce((total, rows) => total + Math.max(0, rows.length - 1), 0) };
}
