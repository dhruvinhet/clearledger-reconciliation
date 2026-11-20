export type EventType = 'payment' | 'refund';
export interface BaseRecord {
  id: string; reference: string; type: EventType; parentReference: string;
  amountMinor: string; feeMinor: string; currency: string; batchId: string;
}
export interface PlatformRecord extends BaseRecord { recordedOn: string }
export interface BankRecord extends BaseRecord { settledOn: string }
export type RecordStatus = 'matched' | 'pending' | 'overdue' | 'difference' | 'duplicate' | 'bank_only' | 'orphan_refund';
export type IssueKind = 'cross_month_settlement' | 'cumulative_rounding_difference' | 'duplicate_entry' | 'orphan_refund' | 'amount_mismatch' | 'overdue_settlement' | 'bank_only';
export interface ReferenceResult {
  reference: string; status: RecordStatus; platform: PlatformRecord[]; bank: BankRecord[];
  expectedMinor: string | null; actualMinor: string | null; differenceMinor: string;
  dueOn?: string; crossMonth: boolean;
}
export interface Issue {
  id: string; kind: IssueKind; title: string; subtitle: string;
  severity: 'review' | 'timing'; reference: string; batchId: string;
  platform: PlatformRecord[]; bank: BankRecord[];
  expectedMinor: string | null; actualMinor: string | null; differenceMinor: string;
  explanation: string; action: string; affectedReferences: string[];
  facts: { label: string; value: string }[];
}
export interface ReconciliationReport {
  asOf: string; currency: string; maxSettlementDays: number;
  records: ReferenceResult[]; issues: Issue[];
  platformNetMinor: string; bankNetMinor: string; differenceMinor: string;
  platformRows: number; bankRows: number; excludedRows: number;
  matchedCount: number; pendingCount: number; duplicateExcessRows: number;
}
