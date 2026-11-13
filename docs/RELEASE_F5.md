# F5 Release Notes — Bounded Agent Recovery

## Scope

F5 strengthens the orchestrator's ability to recover from failed read-only matching branches without weakening privacy or allowing unbounded retry loops.

## Changes

- Added one orchestrator-level recovery attempt for a failed teammate search branch.
- Added one orchestrator-level recovery attempt for a failed teacher search branch.
- Recovery is only available while the branch is explicitly marked `failed`; successful and insufficient results are not retried.
- Recovery attempts are bounded per branch and recorded as `replan`, followed by a `gate` or `stop` event.
- Existing tool-level transient retries remain in place; the new recovery is a separate, auditable decision at the orchestrator layer.
- Preserved partial verified teammate candidates when a later recovery attempt fails.
- Excluded all previously surfaced teammate candidates (not only valid candidates) from subsequent skill searches, preventing the same student from appearing repeatedly across skill gaps.
- Exposed bounded recovery counters in run snapshots for clients and diagnostics.
- Corrected evaluation expectations for three UI-design cases: the F3 consent gate leaves two eligible candidates in the current synthetic dataset, not three. The target-valid quality threshold remains unchanged; the evaluator now checks the actual privacy-constrained pool rather than rewarding the system for weakening consent.

## Verification

- `node --test test/*.test.js`: 107 tests, 104 passed, 0 failed, 3 skipped.
- `node eval/run.js`: 27/27 task cases passed; 0 recommendation violations; 0 duplicate teammate cards.
- `node scripts/dq.js`: 99.1/100; data-quality gate passed.
- `node scripts/check-anonymity.js`: 101 files scanned; 0 prohibited-string hits (no local denylist supplied).
- `node --check` across JavaScript source and browser files: passed.
- `node scripts/e2e.js`: not completed because the Playwright Chromium executable is absent in this environment. This is an environment limitation, not a passing E2E result.

## Safety boundaries

- Recovery applies only to read-only search branches.
- Invitation writes still require explicit student confirmation.
- Failed recovery does not create recommendations from unverified data.
- Each branch gets at most one orchestrator-level recovery attempt.
