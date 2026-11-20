import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Activity, BookOpen, CalendarDays, Check, CheckCheck, ChevronDown, CircleHelp, Coins, Copy, Download, FileSpreadsheet, Files, Filter, Layers3, LayoutDashboard, ListFilter, PanelRightOpen, RotateCcw, Search, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import { bankText, platformText, sampleBank, samplePlatform } from './data';
import { parseCsv, validDate } from './engine/csv';
import { reconcile } from './engine/reconcile';
import type { BankRecord, Issue, IssueKind, PlatformRecord, ReferenceResult } from './engine/types';
import { money, shortDate } from './format';

const labels: Record<IssueKind, string> = {
  duplicate_entry: 'Duplicate entry', orphan_refund: 'Orphan refund', cumulative_rounding_difference: 'Rounding difference',
  cross_month_settlement: 'Cross-month settlement', amount_mismatch: 'Amount mismatch', overdue_settlement: 'Overdue settlement', bank_only: 'Bank-only record',
};
const statusLabels = { matched: 'Matched', pending: 'Pending settlement', overdue: 'Overdue', difference: 'Amount difference', duplicate: 'Duplicate', bank_only: 'Bank only', orphan_refund: 'Orphan refund' };
const iconFor = (kind: IssueKind) => kind === 'duplicate_entry' ? Copy : kind === 'orphan_refund' ? RotateCcw : kind === 'cross_month_settlement' ? CalendarDays : Coins;
const toneFor = (kind: IssueKind) => kind === 'duplicate_entry' ? 'amber' : kind === 'orphan_refund' ? 'red' : kind === 'cross_month_settlement' ? 'blue' : 'purple';

function download(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csv(values: unknown[][]) {
  return values.map(row => row.map(value => {
    let text = String(value ?? '');
    if (/^[=+@\-\t\r]/.test(text) && !/^-?\d+$/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
}
function Modal({ children, title, close, wide = false }: { children: ReactNode; title: string; close: () => void; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        const nodes = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, a[href], [tabindex="0"]');
        if (!nodes?.length) { event.preventDefault(); return; }
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handle);
    return () => { document.removeEventListener('keydown', handle); document.body.style.overflow = overflow; previous?.focus(); };
  }, [close]);
  return <div className="overlay" onClick={close}><div className={`drawer ${wide ? 'wide' : ''}`} ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}>
    <div className="drawer-top"><span className="eyebrow">{title}</span><button className="icon-button" aria-label="Close details" onClick={close}><X size={20} /></button></div>{children}
  </div></div>;
}

function SourceEvidence({ platform, bank }: { platform: PlatformRecord[]; bank: BankRecord[] }) {
  return <div className="source-evidence">{[['Platform records', platform], ['Bank records', bank]].map(([title, data]) => {
    const records = data as (PlatformRecord | BankRecord)[];
    return <section key={String(title)}><h3>{String(title)} <span className="count">{records.length}</span></h3>{!records.length ? <div className="missing-source">No matching record in this extract.</div> : <div className="table-scroll"><table className="evidence-table"><thead><tr><th>Source ID / date</th><th>Amount</th><th>Fee</th></tr></thead><tbody>{records.map((row, index) => <tr key={`${row.id}-${index}`}><td><strong>{row.id}</strong><small>{'recordedOn' in row ? row.recordedOn : row.settledOn}</small><small>{row.reference}</small>{row.parentReference && <small>Parent: {row.parentReference}</small>}</td><td className="numeric">{money(row.amountMinor)}</td><td className="numeric">{money(row.feeMinor)}</td></tr>)}</tbody></table></div>}</section>;
  })}</div>;
}

function Detail({ issue, record, close }: { issue?: Issue; record?: ReferenceResult; close: () => void }) {
  const p = issue?.platform ?? record!.platform, b = issue?.bank ?? record!.bank;
  const difference = issue?.differenceMinor ?? record!.differenceMinor;
  const expected = issue ? issue.expectedMinor : record!.expectedMinor, actual = issue ? issue.actualMinor : record!.actualMinor;
  return <Modal title="Reconciliation evidence" close={close}>
    <div className="detail-heading"><span className={`badge ${issue ? toneFor(issue.kind) : 'green'}`}>{issue ? issue.severity === 'timing' ? 'Expected timing' : 'Needs review' : statusLabels[record!.status]}</span><h2>{issue?.title ?? 'Transaction details'}</h2><p className="mono">{issue?.reference ?? record!.reference}</p></div>
    <p className="explanation">{issue?.explanation ?? (record!.status === 'pending' ? `This payment is still within its settlement window. Its expected settlement date is ${record!.dueOn}.` : 'Compare the platform’s gross amount less its stored fee with the bank’s net amount. A shared reference links these source records.')}</p>
    <div className="comparison"><div><span>Platform expected net</span><strong>{money(expected)}</strong></div><div><span>Bank reported net</span><strong>{money(actual)}</strong></div></div>
    <div className={`detail-delta ${difference === '0' ? 'balanced' : ''}`}><span>Bank minus platform</span><strong>{money(difference, true)}</strong></div>
    {issue && <><section className="next-step"><span className="eyebrow">Suggested next step</span><p>{issue.action}</p></section><dl className="facts">{issue.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl></>}
    {issue?.kind === 'cumulative_rounding_difference' && <section><h3>Payment-level comparison</h3><p className="subtle">Bank net minus platform net after each source’s stored fee.</p><div className="table-scroll"><table className="evidence-table"><thead><tr><th>Reference</th><th>Difference</th></tr></thead><tbody>{p.map(row => { const settlement = b.find(item => item.reference === row.reference)!; const delta = BigInt(settlement.amountMinor) - BigInt(row.amountMinor) + BigInt(row.feeMinor); return <tr key={row.id}><td className="mono">{row.reference}</td><td className={`numeric ${delta !== 0n ? 'variance-text' : ''}`}>{money(String(delta), true)}</td></tr>; })}</tbody></table></div></section>}
    <SourceEvidence platform={p} bank={b} />
    <div className="drawer-footer"><ShieldCheck size={16} /> Original source occurrences preserved for review</div>
  </Modal>;
}

const initialData = { platform: samplePlatform, bank: sampleBank, platformText, bankText, platformName: 'platform_transactions.csv', bankName: 'bank_settlements.csv' };
type Dataset = typeof initialData;
function Sources({ data, update, close }: { data: Dataset; update: (data: Dataset) => void; close: () => void }) {
  const [platformFile, setPlatformFile] = useState<File | null>(null), [bankFile, setBankFile] = useState<File | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function apply() {
    if (!platformFile || !bankFile) return;
    setBusy(true); setError('');
    try {
      const [p, b] = await Promise.all([platformFile.text(), bankFile.text()]);
      const next = { platform: parseCsv(p, 'platform'), bank: parseCsv(b, 'bank'), platformText: p, bankText: b, platformName: platformFile.name, bankName: bankFile.name };
      if ([...next.platform, ...next.bank].some(row => row.currency !== 'INR')) throw new Error('This assessment dashboard displays INR. Use INR files with amounts in paise.');
      if (!next.platform.length || !next.bank.length) throw new Error('Each file must contain at least one data row.');
      reconcile(next.platform, next.bank, { asOf: '9999-12-31' });
      update(next); close();
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not read the files.'); }
    finally { setBusy(false); }
  }
  return <Modal title="Source data" close={close}><h2>The records behind the numbers</h2><p className="explanation">Two CSV extracts, matched by their shared payment reference. All amounts are in INR paise.</p>
    {[['Platform transactions', data.platformName, data.platform.length, data.platformText], ['Bank settlements', data.bankName, data.bank.length, data.bankText]].map(([title, name, count, text]) => <div className="source-file" key={String(title)}><FileSpreadsheet size={24} /><div><strong>{String(title)}</strong><small>{String(name)} · {String(count)} rows</small></div><button className="icon-button" aria-label={`Download ${title}`} onClick={() => download(String(name), String(text))}><Download size={18} /></button></div>)}
    <section className="upload-section"><h3>Reconcile another pair of files</h3><p className="subtle">Files are processed in this browser. Use the same columns as the sample files. No records are saved to a server.</p><label className="file-label">Platform CSV<input type="file" accept=".csv,text/csv" onChange={event => setPlatformFile(event.target.files?.[0] ?? null)} /></label><label className="file-label">Bank CSV<input type="file" accept=".csv,text/csv" onChange={event => setBankFile(event.target.files?.[0] ?? null)} /></label>{error && <p className="error" role="alert">{error}</p>}<button className="button primary" disabled={!platformFile || !bankFile || busy} onClick={apply}>{busy ? 'Checking files…' : 'Reconcile files'}</button></section>
    <button className="text-button" onClick={() => { update(initialData); close(); }}>Restore assessment dataset</button>
  </Modal>;
}

export default function App() {
  const [data, setData] = useState(initialData), [asOf, setAsOf] = useState('2026-11-05');
  const [tab, setTab] = useState<'exceptions' | 'records'>('exceptions');
  const [query, setQuery] = useState(''), [kind, setKind] = useState('all'), [severity, setSeverity] = useState('all'), [month, setMonth] = useState('all');
  const [detail, setDetail] = useState<{ issue?: Issue; record?: ReferenceResult } | null>(null);
  const [sources, setSources] = useState(false), [method, setMethod] = useState(false);
  const report = useMemo(() => reconcile(data.platform, data.bank, { asOf }), [data, asOf]);
  const months = useMemo(() => [...new Set([...data.platform.map(row => row.recordedOn.slice(0, 7)), ...data.bank.map(row => row.settledOn.slice(0, 7))])].sort(), [data]);
  const search = query.trim().toLowerCase();
  const issueRows = report.issues.filter(issue => (kind === 'all' || issue.kind === kind) && (severity === 'all' || issue.severity === severity)
    && (month === 'all' || [...issue.platform.map(row => row.recordedOn), ...issue.bank.map(row => row.settledOn)].some(day => day.startsWith(month)))
    && [issue.reference, issue.title, issue.explanation, issue.batchId, ...issue.platform.map(row => `${row.id} ${row.reference}`), ...issue.bank.map(row => `${row.id} ${row.reference}`)].join(' ').toLowerCase().includes(search));
  const recordRows = report.records.filter(record => (month === 'all' || [...record.platform.map(row => row.recordedOn), ...record.bank.map(row => row.settledOn)].some(day => day.startsWith(month)))
    && [record.reference, ...record.platform.map(row => `${row.id} ${row.batchId}`), ...record.bank.map(row => `${row.id} ${row.batchId}`)].join(' ').toLowerCase().includes(search)
    && (severity === 'all' || (severity === 'review' ? !['matched', 'pending'].includes(record.status) : record.crossMonth))
    && (kind === 'all' || report.issues.some(issue => issue.kind === kind && [...issue.platform, ...issue.bank].some(row => row.reference === record.reference))));
  const review = report.issues.filter(issue => issue.severity === 'review').length, timing = report.issues.length - review;
  const matchedPercent = report.platformRows ? Math.round(report.matchedCount / report.platformRows * 1000) / 10 : 0;
  const roundingCount = report.issues.filter(issue => issue.kind === 'cumulative_rounding_difference').reduce((total, issue) => total + issue.affectedReferences.length, 0);
  const activeFilters = kind !== 'all' || severity !== 'all' || month !== 'all' || !!query;
  const clear = () => { setQuery(''); setKind('all'); setSeverity('all'); setMonth('all'); };
  const updateData = (next: Dataset) => { setData(next); clear(); setDetail(null); };
  function exportReport() {
    const header = ['reference', 'classification', 'expected_net_minor', 'bank_net_minor', 'difference_minor', 'currency', 'explanation'];
    const rows = tab === 'exceptions' ? issueRows.map(issue => [issue.reference, issue.kind, issue.expectedMinor, issue.actualMinor, issue.differenceMinor, report.currency, issue.explanation])
      : recordRows.map(row => [row.reference, row.status, row.expectedMinor, row.actualMinor, row.differenceMinor, report.currency, row.crossMonth ? 'Settles in a different reporting month.' : '']);
    download(`reconciliation-${tab}-${asOf}.csv`, csv([header, ...rows]));
  }
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="#overview" aria-label="Clearledger home"><span className="brand-mark"><Layers3 size={24} strokeWidth={1.8} /></span>clearledger<span className="brand-dot">.</span></a><div className="workspace-label">FINANCE WORKSPACE</div><nav aria-label="Main navigation"><button className="nav-item active" onClick={() => { setTab('exceptions'); clear(); document.getElementById('overview')?.scrollIntoView({ behavior: 'smooth' }); }}><LayoutDashboard size={19} />Reconciliation<span className="nav-count">{report.issues.length}</span></button><button className="nav-item" onClick={() => setSources(true)}><Files size={19} />Source data</button><button className="nav-item" onClick={() => setMethod(true)}><BookOpen size={19} />Matching rules</button></nav><div className="sidebar-help"><div className="help-icon"><ShieldCheck size={20} /></div><h3>A clear path to close.</h3><p>Understand the difference before making an adjustment.</p><button onClick={() => setMethod(true)}>How matching works <CircleHelp size={15} /></button></div><div className="sidebar-footer"><span className="avatar">FT</span><div><strong>Finance team</strong><small>Assessment workspace</small></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumbs">Workspace <span>/</span><strong>Finance operations</strong></div><div className="topbar-right"><span className="demo-tag"><span />Synthetic dataset</span><span className="avatar small">FT</span></div></header>
    <main id="overview"><div className="page-heading"><div><div className="eyebrow">PAYMENTS & SETTLEMENTS</div><h1>Reconciliation</h1><p>Every payment accounted for. Every difference explained.</p></div><div className="heading-actions"><label className="date-control"><CalendarDays size={17} /><span>As of</span><input aria-label="Reconciliation as of date" type="date" value={asOf} max="9998-12-31" onInput={event => { if (validDate(event.currentTarget.value)) setAsOf(event.currentTarget.value); }} onChange={event => { if (validDate(event.currentTarget.value)) setAsOf(event.currentTarget.value); }} onBlur={event => { if (validDate(event.currentTarget.value)) setAsOf(event.currentTarget.value); }} /></label><button className="button primary" onClick={exportReport}><Download size={17} />Export report</button></div></div>
    <div className="run-meta"><span><CheckCheck size={15} />{report.platformRows} platform events</span><span>{report.bankRows} bank rows</span><span>{report.maxSettlementDays}-day settlement window</span><button onClick={() => setSources(true)}>View source files <PanelRightOpen size={14} /></button>{report.excludedRows > 0 && <span className="cutoff-note">{report.excludedRows} future rows excluded</span>}</div>
    <section className="metrics" aria-label="Summary metrics"><article className="metric"><div className="metric-label">Platform expected net <FileSpreadsheet size={17} /></div><strong>{money(report.platformNetMinor)}</strong><p>Gross payments less platform fees</p></article><article className="metric"><div className="metric-label">Bank reported net <Activity size={17} /></div><strong>{money(report.bankNetMinor)}</strong><p>Raw export, including duplicate rows</p></article><article className="metric variance"><div className="metric-label">Raw net difference <Coins size={17} /></div><strong>{money(report.differenceMinor, true)}</strong><p>Bank net minus platform expected net</p></article><article className="metric"><div className="metric-label">Needs review <ListFilter size={18} /></div><strong>{review}<span className="metric-unit">exceptions</span></strong><p><span className="timing-dot" />{timing} expected timing {timing === 1 ? 'difference' : 'differences'}</p></article></section>
    <section className="overview-grid"><article className="panel match-panel"><div className="section-top"><h2>Matching overview</h2><span className="badge green"><ShieldCheck size={13} />Source-backed</span></div><div className="match-main"><div className="donut" style={{ background: `conic-gradient(#24695b 0% ${matchedPercent}%, #e8eeec ${matchedPercent}% 100%)` }}><div><strong>{matchedPercent}<span>%</span></strong><small>exact matches</small></div></div><div className="match-copy"><h3>{report.matchedCount} of {report.platformRows} events match exactly</h3><p>Same reference, same currency, and the same net amount after fees.</p><div className="legend"><span><i className="green-dot" />{roundingCount} rounding differences</span><span><i className="amber-dot" />{report.duplicateExcessRows} excess duplicate {report.duplicateExcessRows === 1 ? 'row' : 'rows'}</span>{report.pendingCount > 0 && <span>{report.pendingCount} pending</span>}</div></div></div><div className="panel-foot"><CalendarDays size={15} />Timing differences can be matched without changing an amount.</div></article>
    <article className="panel bridge-panel"><div className="section-top"><h2>What explains the difference?</h2><span className="muted-label">BANK − PLATFORM</span></div><div className="bridge-list">{report.issues.filter(issue => issue.differenceMinor !== '0').map(issue => <button key={issue.id} onClick={() => setDetail({ issue })}><span><i className={`bridge-dot ${toneFor(issue.kind)}`} />{labels[issue.kind]}</span><strong>{money(issue.differenceMinor, true)}</strong></button>)}{!report.issues.some(issue => issue.differenceMinor !== '0') && <div className="subtle">No monetary exceptions at this cutoff.</div>}{report.pendingCount > 0 && <div className="pending-bridge"><span>Awaiting settlement</span><strong>{money(String(report.records.filter(row => row.status === 'pending').reduce((total, row) => total + BigInt(row.differenceMinor), 0n)), true)}</strong></div>}</div><div className="bridge-total"><span>Raw net difference</span><strong>{money(report.differenceMinor, true)}</strong></div></article></section>
    <section className="results-section" aria-label="Reconciliation results"><div className="results-heading"><div><h2>Understand the exceptions</h2><p>Review the cause, check the evidence, then decide the next step.</p></div><span className="muted-label">AS OF {shortDate(asOf).toUpperCase()}</span></div><div className="panel results-panel"><div className="tabs" role="tablist" aria-label="Result view"><button role="tab" aria-selected={tab === 'exceptions'} className={tab === 'exceptions' ? 'selected' : ''} onClick={() => setTab('exceptions')}>Exceptions<span className="count">{report.issues.length}</span></button><button role="tab" aria-selected={tab === 'records'} className={tab === 'records' ? 'selected' : ''} onClick={() => setTab('records')}>All records<span className="count">{report.records.length}</span></button><span className="tabs-note"><Filter size={14} />Showing original source evidence</span></div>
    <div className="filters"><label className="search"><Search size={17} /><input aria-label="Search reconciliation records" placeholder="Search reference, batch, or source ID…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button aria-label="Clear search" className="icon-button" onClick={() => setQuery('')}><X size={14} /></button>}</label><label className="select-wrap"><SlidersHorizontal size={15} /><select aria-label="Filter exception type" value={kind} onChange={event => setKind(event.target.value)}><option value="all">All exception types</option>{[...new Set(report.issues.map(issue => issue.kind))].map(kind => <option key={kind} value={kind}>{labels[kind]}</option>)}</select><ChevronDown size={14} /></label><label className="select-wrap"><select aria-label="Filter review status" value={severity} onChange={event => setSeverity(event.target.value)}><option value="all">All statuses</option><option value="review">Needs review</option><option value="timing">Expected timing</option></select><ChevronDown size={14} /></label><label className="select-wrap"><select aria-label="Filter activity month" value={month} onChange={event => setMonth(event.target.value)}><option value="all">All months</option>{months.map(month => <option key={month} value={month}>{new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</option>)}</select><ChevronDown size={14} /></label></div>
    <div className="table-scroll">{tab === 'exceptions' ? <table className="results-table"><thead><tr><th>Exception / reference</th><th>Net impact</th><th>Why it happened</th><th>Review status</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{issueRows.map(issue => { const Icon = iconFor(issue.kind); return <tr key={issue.id}><td><div className="issue-name"><span className={`issue-icon ${toneFor(issue.kind)}`}><Icon size={19} /></span><div><strong>{issue.title}</strong><small className="mono">{issue.reference}</small></div></div></td><td className={`impact ${issue.severity === 'timing' ? 'neutral' : ''}`}><strong>{money(issue.differenceMinor, true)}</strong><small>{issue.severity === 'timing' ? 'No amount difference' : issue.kind === 'cumulative_rounding_difference' ? 'Across the full batch' : 'In the raw bank export'}</small></td><td className="why-cell">{issue.subtitle}</td><td><span className={`badge ${issue.severity === 'timing' ? 'blue' : 'amber'}`}>{issue.severity === 'timing' ? 'Expected timing' : 'Needs review'}</span></td><td><button className="detail-button" aria-label={`View ${issue.title} details`} onClick={() => setDetail({ issue })}>View details<PanelRightOpen size={15} /></button></td></tr>; })}</tbody></table> : <table className="results-table records-table"><thead><tr><th>Payment reference</th><th>Platform net</th><th>Bank net</th><th>Difference</th><th>Status</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{recordRows.map(row => <tr key={row.reference}><td><strong className="mono">{row.reference}</strong><small>{row.platform[0]?.recordedOn ? shortDate(row.platform[0].recordedOn) : 'No platform record'}{row.crossMonth ? ' · crosses month-end' : ''}</small></td><td className="numeric">{money(row.expectedMinor)}</td><td className="numeric">{money(row.actualMinor)}</td><td className={`numeric ${row.differenceMinor !== '0' ? 'variance-text' : ''}`}>{money(row.differenceMinor, true)}</td><td><span className={`badge ${row.status === 'matched' ? 'green' : row.status === 'pending' ? 'blue' : 'amber'}`}>{statusLabels[row.status]}</span></td><td><button className="icon-button" aria-label={`Inspect ${row.reference}`} onClick={() => setDetail({ record: row })}><PanelRightOpen size={17} /></button></td></tr>)}</tbody></table>}</div>
    {(tab === 'exceptions' ? issueRows.length : recordRows.length) === 0 && <div className="empty-state"><Search size={24} /><h3>No results for these filters</h3><p>Try another reference, month, or review status.</p><button className="button secondary" onClick={clear}>Clear filters</button></div>}
    <div className="table-footer"><span>{tab === 'exceptions' ? `${issueRows.length} of ${report.issues.length} exceptions` : `${recordRows.length} of ${report.records.length} references`}<span className="footer-divider">·</span>{tab === 'exceptions' ? 'Rounding differences grouped by batch' : 'Each reference shown once'}</span>{activeFilters ? <button className="text-button" onClick={clear}>Clear filters</button> : <span><Check size={14} />Exact monetary calculations</span>}</div></div></section>
    <footer className="page-footer"><span><ShieldCheck size={15} />Traceable from summary to source record.</span><span>INR · Asia/Kolkata · Synthetic assessment data</span></footer>
    </main></div>
    {detail && <Detail {...detail} close={() => setDetail(null)} />}{sources && <Sources data={data} update={updateData} close={() => setSources(false)} />}{method && <Modal title="Matching rules" close={() => setMethod(false)}><h2>How the numbers come together</h2><div className="method-list"><section><span className="method-icon"><CheckCheck size={20} /></span><div><h3>Match the reference first</h3><p>Unique shared references link the records. Duplicate IDs or references are held for review. Amount and date alone never create a match.</p></div></section><section><span className="method-icon"><Coins size={20} /></span><div><h3>Compare the expected net</h3><p>Platform gross less its stored fee is compared with bank net. All arithmetic uses exact integer paise. The sample payment fee is 2%.</p></div></section><section><span className="method-icon"><CalendarDays size={20} /></span><div><h3>Give settlement time to arrive</h3><p>Missing bank records remain pending through two calendar days after the payment date. A matched receipt in the next month is a timing exception.</p></div></section><section><span className="method-icon"><Layers3 size={20} /></span><div><h3>Explain rounding at batch level</h3><p>The engine checks per-payment half-up fees against a fee rounded once per batch, allocated using largest remainders. Only a verified policy difference is classified as rounding.</p></div></section><section><span className="method-icon"><RotateCcw size={20} /></span><div><h3>Trace refunds to their origin</h3><p>Refunds are signed negative events with their own references. A bank refund without a platform refund needs investigation; older parent payments may be outside the extract.</p></div></section></div><div className="next-step"><p>Raw totals retain duplicate rows. An explanation is evidence for review, not approval to post an adjustment. Source files are processed locally in your browser.</p></div></Modal>}
  </div>;
}
