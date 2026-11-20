import { describe, expect, it } from 'vitest';
import { sampleBank as bank, samplePlatform as platform } from '../data';
import expected from '../data/expected_results.json';
import { parseCsv } from './csv';
import { reconcile } from './reconcile';
import { money } from '../format';

const run = () => reconcile(platform, bank, { asOf: expected.asOf });
describe('fixture reconciliation, independently of React', () => {
  it('identifies exactly the four planted case types', () => {
    const report = run();
    expect(report.issues.map(issue => issue.kind).sort()).toEqual(expected.anomalies.map(issue => issue.type).sort());
    expect(report.platformRows).toBe(23);
    expect(report.bankRows).toBe(25);
    expect(report.records).toHaveLength(24);
    expect(report.matchedCount).toBe(17);
    expect(report.platformNetMinor).toBe('2803708');
    expect(report.bankNetMinor).toBe('2810515');
    expect(report.differenceMinor).toBe('6807');
    expect(report.issues.reduce((total, issue) => total + BigInt(issue.differenceMinor), 0n).toString()).toBe(report.differenceMinor);
  });
  it('matches all normal controls, including the valid partial refund', () => {
    const report = run();
    for (const reference of expected.controlReferences) {
      expect(report.records.find(record => record.reference === reference)?.status).toBe('matched');
      expect(report.issues.some(issue => issue.affectedReferences.includes(reference))).toBe(false);
    }
  });
  it('classifies cross-month settlement as timing with zero monetary impact', () => {
    const issue = run().issues.find(issue => issue.kind === 'cross_month_settlement')!;
    expect(issue.reference).toBe('PAY-20261031-012');
    expect(issue.severity).toBe('timing');
    expect(issue.differenceMinor).toBe('0');
    expect(issue.expectedMinor).toBe('269500');
    const october = reconcile(platform, bank, { asOf: '2026-10-31' });
    expect(october.records.find(row => row.reference === issue.reference)?.status).toBe('pending');
    expect(october.excludedRows).toBe(8);
  });
  it('groups five one-paise differences into a verified rounding batch', () => {
    const issue = run().issues.find(issue => issue.kind === 'cumulative_rounding_difference')!;
    expect(issue.batchId).toBe('SET-20261031-R01');
    expect(issue.platform).toHaveLength(10);
    expect(issue.bank).toHaveLength(10);
    expect(issue.affectedReferences).toEqual(Array.from({ length: 5 }, (_, i) => `PAY-20261030-R${String(i + 6).padStart(3, '0')}`));
    expect(issue.expectedMinor).toBe('208490');
    expect(issue.actualMinor).toBe('208495');
    expect(issue.differenceMinor).toBe('5');
  });
  it('does not label an arbitrary small mismatch as rounding', () => {
    const changed = bank.map(row => row.reference === 'PAY-20261030-R010' ? { ...row, amountMinor: String(BigInt(row.amountMinor) + 1n) } : row);
    const report = reconcile(platform, changed, { asOf: expected.asOf });
    expect(report.issues.some(issue => issue.kind === 'cumulative_rounding_difference')).toBe(false);
    expect(report.issues.filter(issue => issue.kind === 'amount_mismatch')).toHaveLength(5);
  });
  it('retains both duplicate occurrences and does not automatically clear them', () => {
    const report = run(), issue = report.issues.find(issue => issue.kind === 'duplicate_entry')!;
    expect(issue.bank.map(row => row.id)).toEqual(['BS-013', 'BS-013']);
    expect(issue.platform).toHaveLength(1);
    expect(issue.differenceMinor).toBe('156702');
    expect(report.records.find(row => row.reference === issue.reference)?.status).toBe('duplicate');
    expect(report.duplicateExcessRows).toBe(1);
  });
  it('does not confuse an orphan refund with a normal negative event', () => {
    const issue = run().issues.find(issue => issue.kind === 'orphan_refund')!;
    expect(issue.reference).toBe('RFD-20261102-002');
    expect(issue.platform).toHaveLength(0);
    expect(issue.bank[0].parentReference).toBe('PAY-20261015-999');
    expect(issue.differenceMinor).toBe('-149900');
    expect(run().records.find(row => row.reference === 'RFD-20261102-001')?.status).toBe('matched');
  });
  it('keeps absent settlements pending through their due date', () => {
    const [payment] = platform;
    expect(reconcile([payment], [], { asOf: '2026-10-30' }).records[0].status).toBe('pending');
    expect(reconcile([payment], [], { asOf: '2026-10-31' }).records[0].status).toBe('overdue');
  });
  it('flags reused source IDs even when the references differ', () => {
    const payments = platform.slice(0, 2).map(row => ({ ...row, id: 'reused' }));
    expect(reconcile(payments, [], { asOf: expected.asOf }).records.every(row => row.status === 'duplicate')).toBe(true);
  });
  it('never matches identical amounts with unrelated references', () => {
    const [payment] = platform;
    const settlement = { ...bank.find(row => row.reference === payment.reference)!, reference: 'unrelated' };
    const report = reconcile([payment], [settlement], { asOf: expected.asOf });
    expect(report.records.map(row => row.status).sort()).toEqual(['bank_only', 'overdue']);
  });
  it('uses exact money well above JavaScript’s safe integer limit', () => {
    const payment = { ...platform[0], amountMinor: '90071992547409930001', feeMinor: '1' };
    const settlement = { ...bank[0], reference: payment.reference, amountMinor: '90071992547409929999', feeMinor: '1' };
    const result = reconcile([payment], [settlement], { asOf: expected.asOf });
    expect(result.differenceMinor).toBe('-1');
    expect(result.issues[0].kind).toBe('amount_mismatch');
    expect(money('90071992547409930001')).toBe('₹9,00,71,99,25,47,40,99,300.01');
    expect(money('-1')).toBe('−₹0.01');
  });
  it('rejects invalid direct inputs and mixed currencies', () => {
    expect(() => reconcile([{ ...platform[0], amountMinor: '0.10' }], [], { asOf: expected.asOf })).toThrow('Invalid financial record');
    expect(() => reconcile(platform, [{ ...bank[0], currency: 'USD' }], { asOf: expected.asOf })).toThrow('one currency');
    expect(() => reconcile([], [], { asOf: '2026-02-30' })).toThrow('valid reconciliation date');
  });
  it('does not mutate source arrays or objects', () => {
    const before = JSON.stringify([platform, bank]);
    run();
    expect(JSON.stringify([platform, bank])).toBe(before);
    expect(() => JSON.stringify(run())).not.toThrow();
  });
  it('returns an empty, balanced report when nothing is eligible', () => {
    const result = reconcile(platform, bank, { asOf: '2026-01-01' });
    expect(result.records).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.differenceMinor).toBe('0');
    expect(result.excludedRows).toBe(48);
  });
});

describe('CSV input contract', () => {
  const header = 'id,reference,type,parentReference,amountMinor,feeMinor,currency,recordedOn,batchId';
  it('handles BOM, CRLF, quoted commas and escaped quotes', () => {
    const result = parseCsv(`\uFEFF${header}\r\npt1,"ref,""quoted""",payment,,12345,10,INR,2026-11-01,batch\r\n`, 'platform');
    expect(result[0].reference).toBe('ref,"quoted"');
    expect(result[0].amountMinor).toBe('12345');
  });
  it('rejects malformed CSV, dates, refunds, and fractional minor units', () => {
    for (const row of [
      'pt1,ref,payment,,12.34,0,INR,2026-11-01,batch',
      'pt1,ref,payment,,1234,0,INR,2026-02-30,batch',
      'pt1,ref,refund,,-1234,0,INR,2026-11-01,batch',
      'pt1,ref,payment,,1234,0,INR,2026-11-01',
      'pt1,"unclosed,payment,,1234,0,INR,2026-11-01,batch',
    ]) expect(() => parseCsv(`${header}\n${row}`, 'platform')).toThrow();
  });
});
