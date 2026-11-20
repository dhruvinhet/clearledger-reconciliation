# Clearledger reconciliation dashboard

React + TypeScript assessment dashboard with a pure engine in
`src/engine/reconcile.ts`, CSV validation, filters, source evidence, and exports.
The dashboard uses this TypeScript engine; the earlier Python prototype is separate.

## Run locally

Use Node.js 24 (`.nvmrc` and `package.json` agree).

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

The production bundle is `dist/`. Uploaded CSVs stay in browser memory. No
environment variables, database, or bank credentials are needed.

## Vercel deployment

Import this project's Git repository into Vercel. Use root directory `.` when
the repository starts with this README; use `dashboard` if importing its parent
workspace. `vercel.json` sets **Vite**, **npm ci**, **npm run build**, and **dist**;
`engines.node` selects **24.x**. Commit the lockfile and the new test file too.

This prepares a static deployment; it does not create a Vercel project or deploy
one. Existing Sites access controls do not configure Vercel access. This demo
bundles synthetic data only.

## Assumptions

- INR amounts are integer paise strings, calculated with `bigint`. Platform
  amount is gross; bank amount is net. Fees are explicit deductions.
- Successful payments and negative refunds have unique, case-sensitive shared
  references. Refunds carry a parent reference. Matching is one-to-one;
  duplicates block automatic clearing and remain in raw totals.
- Dates are normalized to Asia/Kolkata before import. The as-of date includes
  that whole day; future rows are excluded. Settlement takes up to two calendar
  days, with a missing receipt still pending on its due date.
- Payment fees default to 2%. Platform fees round half up per payment; bank fees
  round half up per batch, then use largest-remainder allocation with ascending
  reference tie-breaks. Only a verified policy difference is labelled rounding.
- Extracts must cover earlier payments and refund parents. An orphan means a
  record is missing from this extract; it does not prove an invalid refund.

## Verification status

`npm run build` compiles TypeScript and produces the static app. It does **not**
run tests. The latest suite has **54 tests: 48 pass and 6 fail**. Normal controls
and all four planted anomaly cases pass. The six failing safeguard tests expose
reversed settlement dates (two cases), late timing classification, conflicting
fees, missing refund lineage, and numeric money accepted by direct engine calls.
No fixes have been applied or failures skipped. CSV amounts are parsed as strings.
Resolve these failures before approving production use. Test/build logs are
saved locally under `verification/` and excluded from Vercel CLI uploads.

## Three production limitations

1. **Incomplete validation:** the six known failures can clear inconsistent
   records or mislabel timing; these safeguards and a passing test gate are
   needed before operational use.
2. **Restricted settlement model:** INR, calendar days, one-to-one references,
   and one fee-allocation policy. FX, holiday cutoffs, partial settlements, and
   consolidated payouts need additional rules and supporting bank detail.
3. **Browser-only workflow:** no application authentication, durable audit trail,
   or reviewer approvals. Files are processed synchronously in memory, so large
   extracts need a backend job pipeline and persistent storage.

## Two-minute demo

| Time | Show and explain |
| --- | --- |
| 0:00–0:20 | Use November 5, 2026. Show 23 platform events, 25 bank rows, and 17 exact matches. Platform net is INR 28,037.08; bank net is INR 28,105.15. |
| 0:20–0:40 | Explain the INR 68.07 difference: duplicate +1567.02, orphan refund -1499.00, rounding +0.05. Separate three review items from the expected timing exception. |
| 0:40–1:00 | Open rounding evidence: ten payments, five one-paise differences, one grouped exception. Show stored fees and expected versus actual net. |
| 1:00–1:20 | Open duplicate and refund details. Show both duplicate occurrences and the refund's missing parent, then suggested next steps. |
| 1:20–1:40 | Set the cutoff to October 31: the November receipt is excluded and the cross-month payment is pending. Restore November 5. |
| 1:40–2:00 | Search `BS-014`, inspect the orphan refund, and export the filtered CSV. Close with the separate engine, actual test status, and production limitations. |

Configuration references: [Vercel settings](https://vercel.com/docs/project-configuration/vercel-json)
and [Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
