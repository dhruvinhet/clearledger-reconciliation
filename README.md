# Clearledger reconciliation dashboard

React and TypeScript dashboard for the synthetic assessment datasets.

```sh
npm ci
npm run dev
npm test
npm run build
```

`src/engine/reconcile.ts` is a pure function with no React or I/O dependencies.
It returns source records, reference classifications, grouped exceptions, and
raw totals as serializable integer strings. `src/engine/csv.ts` validates inputs.
React components consume the returned report and do not implement matching rules.

Use the supplied November 5, 2026 cutoff. The report has 17 exact platform
matches, three exceptions requiring review, and one expected timing exception.
Bank minus platform net is INR 68.07: duplicate INR 1567.02, orphan refund
INR -1499.00, and rounding INR 0.05. The rounding batch retains all ten source
payments and groups its five one-paise differences into one exception.

Search by source ID, reference, or batch. Filters apply to the exception table
or all-record view and to the CSV export; headline metrics retain the full run.
The month filter includes activity on either source date. Change the as-of date
to inspect a historical cutoff; later rows are explicitly counted as excluded.
View source files to download the inputs, upload a replacement pair, or restore
the samples. Uploaded files are processed in memory in the browser and are not
persisted. Export reports use integer minor units to preserve precision.

Assessment scope: INR, normalized Asia/Kolkata date-only values, two calendar
days for settlement, one-to-one transaction references, and a configured 2%
payment fee for recognizing the documented rounding policy. The bank’s batch
fee must match half-up rounding and largest-remainder allocation. Unknown fee
differences remain amount mismatches. No fuzzy matching, currency conversion,
posting adjustments, authentication flow, database, or bank integration.

The four required cases are cross-month settlement, cumulative rounding,
duplicate entry, and orphan refund. Additional missing and amount-mismatch
results are supported so imported files do not silently lose unresolved records.
Duplicate rows remain in raw totals and source evidence. No adjustment is posted
automatically. The orphan refund is unresolved within the supplied coverage;
its parent payment may exist in older history.

The earlier Python implementation remains separate. This dashboard uses the
TypeScript engine, tested directly against the fixture expectation manifest.

React setup follows the [official React guide](https://react.dev/learn/build-a-react-app-from-scratch).
