import { describe, expect, it } from 'vitest';
import { sampleBank, samplePlatform } from '../data';
import expected from '../data/expected_results.json';
import { reconcile } from './reconcile';
import type { BankRecord, PlatformRecord, ReconciliationReport } from './types';

// Independent hand-calculated examples. Do not use the implementation's helpers
// to calculate expected amounts or import React/the dashboard for these tests.
function payment(overrides: Partial<PlatformRecord> = {}): PlatformRecord {
  return { id: 'p1', reference: 'PAY-001', type: 'payment', parentReference: '',
    amountMinor: '10000', feeMinor: '200', currency: 'INR',
    recordedOn: '2026-10-28', batchId: 'BATCH-001', ...overrides };
}
function settlement(overrides: Partial<BankRecord> = {}): BankRecord {
  return { id: 'b1', reference: 'PAY-001', type: 'payment', parentReference: '',
    amountMinor: '9800', feeMinor: '200', currency: 'INR',
    settledOn: '2026-10-29', batchId: 'BATCH-001', ...overrides };
}
const run = (p: PlatformRecord[], b: BankRecord[], asOf = '2026-11-05') => reconcile(p, b, { asOf });
const evidence = (report: ReconciliationReport) => JSON.stringify({
  references: report.records.map(row => ({ reference: row.reference, status: row.status, dueOn: row.dueOn })),
  issues: report.issues.map(issue => ({ kind: issue.kind, severity: issue.severity })),
  platformNetMinor: report.platformNetMinor, bankNetMinor: report.bankNetMinor,
});

describe('Normal transactions', () => {
  it.each(expected.controlReferences)('matches normal control %s without exceptions', reference => {
    const p = samplePlatform.filter(row => row.reference === reference);
    const b = sampleBank.filter(row => row.reference === reference);
    const report = run(p, b);
    expect(report.matchedCount).toBe(1);
    expect(report.issues).toEqual([]);
    expect(report.differenceMinor).toBe('0');
    expect(report.records[0].platform).toEqual(p);
    expect(report.records[0].bank).toEqual(b);
  });
  it('matches zero amounts without confusing zero with a missing bank record', () => {
    const report = run([payment({ amountMinor: '0', feeMinor: '0' })], [settlement({ amountMinor: '0', feeMinor: '0' })]);
    expect(report.records[0].status).toBe('matched');
    expect(report.records[0].actualMinor).toBe('0');
    expect(report.issues).toEqual([]);
  });
  it('keeps an exact match precise above Number.MAX_SAFE_INTEGER', () => {
    const report = run([payment({ amountMinor: '900719925474099301', feeMinor: '1' })],
      [settlement({ amountMinor: '900719925474099300', feeMinor: '1' })]);
    expect(report.platformNetMinor).toBe('900719925474099300');
    expect(report.differenceMinor).toBe('0');
    expect(report.matchedCount).toBe(1);
  });
  it('allows the same source ID in different source systems', () => {
    expect(run([payment({ id: 'shared-id' })], [settlement({ id: 'shared-id' })]).issues).toEqual([]);
  });
  it('does not match unrelated payments merely because their amounts agree', () => {
    const report = run([payment()], [settlement({ reference: 'PAY-OTHER' })]);
    expect(report.matchedCount).toBe(0);
    expect(report.issues.map(issue => issue.kind).sort()).toEqual(['bank_only', 'overdue_settlement']);
  });
  it('preserves every eligible source occurrence exactly once in reference results', () => {
    const report = run(samplePlatform, sampleBank);
    expect(report.records.reduce((count, row) => count + row.platform.length, 0)).toBe(23);
    expect(report.records.reduce((count, row) => count + row.bank.length, 0)).toBe(25);
    expect(report.records.map(row => row.reference).length).toBe(new Set(report.records.map(row => row.reference)).size);
  });
});

describe('Cross-month settlement', () => {
  it.each([
    ['2026-01-31', '2026-02-01'],
    ['2026-12-31', '2027-01-02'],
    ['2028-02-28', '2028-03-01'],
  ])('explains a legitimate boundary from %s to %s', (recordedOn, settledOn) => {
    const report = run([payment({ recordedOn })], [settlement({ settledOn })], settledOn);
    expect(report.records[0].status).toBe('matched');
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({ kind: 'cross_month_settlement', severity: 'timing', differenceMinor: '0' });
    expect(report.issues[0].facts.map(fact => fact.value)).toEqual(expect.arrayContaining([recordedOn, settledOn]));
  });
  it('is pending at October close and matched when the November receipt arrives', () => {
    const p = [payment({ recordedOn: '2026-10-31' })], b = [settlement({ settledOn: '2026-11-02' })];
    const before = run(p, b, '2026-10-31'), after = run(p, b, '2026-11-02');
    expect(before.records[0].status).toBe('pending');
    expect(before.records[0].dueOn).toBe('2026-11-02');
    expect(before.excludedRows).toBe(1);
    expect(before.issues).toEqual([]);
    expect(after.records[0].status).toBe('matched');
    expect(after.excludedRows).toBe(0);
  });
  it('does not call a cross-month amount discrepancy a clean timing exception', () => {
    const report = run([payment({ recordedOn: '2026-10-31' })], [settlement({ settledOn: '2026-11-02', amountMinor: '9799' })]);
    expect(report.records[0].status).toBe('difference');
    expect(report.issues.map(issue => issue.kind)).toEqual(['amount_mismatch']);
    expect(report.issues[0].differenceMinor).toBe('-1');
  });
});

describe('Cumulative rounding difference', () => {
  // Three payments: exact 2% fees 200.5, 250.5, 300.5 paise.
  // Platform rounds to 753 paise total. Bank rounds 751.5 to 752,
  // giving the two residual paise to the first two reference tie-breaks.
  const p = [
    payment({ id: 'p1', reference: 'R1', amountMinor: '10025', feeMinor: '201' }),
    payment({ id: 'p2', reference: 'R2', amountMinor: '12525', feeMinor: '251' }),
    payment({ id: 'p3', reference: 'R3', amountMinor: '15025', feeMinor: '301' }),
  ];
  const b = [
    settlement({ id: 'b1', reference: 'R1', amountMinor: '9824', feeMinor: '201' }),
    settlement({ id: 'b2', reference: 'R2', amountMinor: '12274', feeMinor: '251' }),
    settlement({ id: 'b3', reference: 'R3', amountMinor: '14725', feeMinor: '300' }),
  ];
  it('detects rounding on a new batch, independently of the ten-row fixture', () => {
    const report = run(p, b);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({ kind: 'cumulative_rounding_difference',
      expectedMinor: '36822', actualMinor: '36823', differenceMinor: '1', affectedReferences: ['R3'] });
    expect(report.issues[0].platform).toHaveLength(3);
    expect(report.issues[0].bank).toHaveLength(3);
  });
  it('preserves monetary classifications when input rows are reordered', () => {
    const forward = run(p, b), reversed = run([...p].reverse(), [...b].reverse());
    expect(reversed.differenceMinor).toBe(forward.differenceMinor);
    expect(reversed.records.map(row => [row.reference, row.status, row.differenceMinor])).toEqual(forward.records.map(row => [row.reference, row.status, row.differenceMinor]));
    expect(reversed.issues.map(issue => [issue.kind, issue.differenceMinor, issue.affectedReferences])).toEqual(forward.issues.map(issue => [issue.kind, issue.differenceMinor, issue.affectedReferences]));
  });
  it('rejects a plausible total when individual fee allocations do not follow the policy', () => {
    const wrong = b.map(row => row.reference === 'R1' ? { ...row, feeMinor: '200', amountMinor: '9825' }
      : row.reference === 'R3' ? { ...row, feeMinor: '301', amountMinor: '14724' } : row);
    const report = run(p, wrong);
    expect(report.differenceMinor).toBe('1');
    expect(report.issues.some(issue => issue.kind === 'cumulative_rounding_difference')).toBe(false);
    expect(report.issues[0].kind).toBe('amount_mismatch');
  });
  it('does not explain an incomplete settlement batch as rounding', () => {
    const report = run(p, b.slice(1));
    expect(report.issues.some(issue => issue.kind === 'cumulative_rounding_difference')).toBe(false);
    expect(report.records.find(row => row.reference === 'R1')?.status).toBe('overdue');
  });
});

describe('Duplicate entry', () => {
  it.each(['bank', 'platform'] as const)('holds exact duplicates from the %s source', source => {
    const p = payment(), b = settlement();
    const report = run(source === 'platform' ? [p, { ...p }] : [p], source === 'bank' ? [b, { ...b }] : [b]);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].kind).toBe('duplicate_entry');
    expect(report.records[0].status).toBe('duplicate');
    expect(report.matchedCount).toBe(0);
    expect(report.duplicateExcessRows).toBe(1);
    expect(report.differenceMinor).toBe(source === 'bank' ? '9800' : '-9800');
    expect(report.records[0][source === 'bank' ? 'bank' : 'platform']).toHaveLength(2);
  });
  it('holds repeated references even when source IDs are different', () => {
    const report = run([payment()], [settlement(), settlement({ id: 'b2' })]);
    expect(report.records[0].status).toBe('duplicate');
    expect(report.issues[0].kind).toBe('duplicate_entry');
    expect(report.issues[0].bank.map(row => row.id)).toEqual(['b1', 'b2']);
    expect(report.matchedCount).toBe(0);
  });
  it('gives ambiguity precedence over an amount discrepancy', () => {
    const report = run([payment()], [settlement(), settlement({ amountMinor: '1234' })]);
    expect(report.issues.map(issue => issue.kind)).toEqual(['duplicate_entry']);
    expect(report.differenceMinor).toBe('1234');
  });
});

describe('Orphan refund', () => {
  const refund = settlement({ id: 'refund-bank', reference: 'REFUND-001', type: 'refund',
    parentReference: 'PAY-001', amountMinor: '-2000', feeMinor: '0' });
  it('identifies a bank refund with no refund or parent in the platform extract', () => {
    const report = run([], [refund]);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({ kind: 'orphan_refund', expectedMinor: null, actualMinor: '-2000', differenceMinor: '-2000' });
    expect(report.issues[0].facts).toContainEqual({ label: 'Parent in platform extract', value: 'No' });
  });
  it('distinguishes a missing refund record from a missing original payment', () => {
    const report = run([payment()], [settlement(), refund]);
    const issue = report.issues.find(issue => issue.kind === 'orphan_refund')!;
    expect(issue.facts).toContainEqual({ label: 'Parent in platform extract', value: 'Yes' });
    expect(issue.facts).toContainEqual({ label: 'Matching platform refund', value: 'Not found' });
    expect(report.matchedCount).toBe(1);
  });
  it('matches a valid partial refund while retaining its negative sign', () => {
    const pRefund = payment({ id: 'refund-platform', reference: refund.reference, type: 'refund',
      parentReference: 'PAY-001', amountMinor: '-2000', feeMinor: '0' });
    const report = run([payment(), pRefund], [settlement(), refund]);
    expect(report.matchedCount).toBe(2);
    expect(report.issues).toEqual([]);
    expect(report.platformNetMinor).toBe('7800');
    expect(report.bankNetMinor).toBe('7800');
  });
});

// These tests express review expectations for dangerous boundary cases. Leave
// failures visible: this verification step must not change production behavior.
describe('Boundary weaknesses — expected safeguards', () => {
  it.each([
    ['same month', '2026-10-28', '2026-10-27'],
    ['reversed month boundary', '2026-11-01', '2026-10-31'],
  ])('does not automatically clear a settlement before its payment: %s', (_name, recordedOn, settledOn) => {
    const report = run([payment({ recordedOn })], [settlement({ settledOn })]);
    expect(report.issues.some(issue => issue.severity === 'review'), evidence(report)).toBe(true);
  });
  it('escalates a late cross-month settlement rather than presenting it as expected timing', () => {
    const report = run([payment({ recordedOn: '2026-10-31' })], [settlement({ settledOn: '2026-11-05' })]);
    expect(report.records[0].dueOn).toBe('2026-11-02');
    expect(report.issues.some(issue => issue.severity === 'review'), evidence(report)).toBe(true);
  });
  it('does not silently clear equal net amounts with conflicting source fees', () => {
    const report = run([payment()], [settlement({ feeMinor: '999' })]);
    expect(report.issues.some(issue => issue.severity === 'review'), evidence(report)).toBe(true);
  });
  it('flags missing refund lineage even when both refund events agree', () => {
    const p = payment({ type: 'refund', reference: 'REFUND-001', parentReference: 'MISSING-PARENT', amountMinor: '-2000', feeMinor: '0' });
    const b = settlement({ type: 'refund', reference: p.reference, parentReference: p.parentReference, amountMinor: '-2000', feeMinor: '0' });
    const report = run([p], [b]);
    expect(report.issues.some(issue => issue.kind === 'orphan_refund'), evidence(report)).toBe(true);
  });
  it('rejects numeric money at the public engine boundary before BigInt conversion', () => {
    // Demonstrates a JavaScript/JSON caller violating the declared string type.
    // Number has already rounded the intended 9007199254740993 paise value.
    const unsafe = Number('9007199254740993') as unknown as string;
    expect(() => run([payment({ amountMinor: unsafe, feeMinor: '0' })], []),
      `Intended 9007199254740993 paise was already rounded to ${String(unsafe)}; numeric input must be rejected.`).toThrow();
  });
});
