# F6 Release Notes — Competition Readiness & CI

## Scope

F6 makes the project's verification process reproducible in a clean CI runner and makes the local browser test launcher portable across managed environments.

## Changes

- Added a GitHub Actions workflow for pushes, pull requests, and manual runs.
- CI provisions Node.js 22, Python 3.12, the optional Anthropic/MCP test SDKs, Playwright, and Chromium, then runs deterministic checks and the browser E2E journey.
- E2E launcher accepts `PLAYWRIGHT_CHROMIUM_EXECUTABLE` for environments that provide a system Chromium binary; defaults to Playwright's managed browser otherwise.
- Added `npm run verify` for deterministic tests, Agent evaluation, data-quality gate, and anonymity scan.
- Updated README test counts and explicitly distinguished verified offline/API results from browser E2E that still requires a successful CI run.

## Verification in the development environment

- `npm test`: 107 tests, 104 passed, 0 failed, 3 skipped.
- `npm run eval`: 27/27 task cases passed; intent recognition 16/18 (88.9%); 0 recommendation violations; 0 duplicate teammate recommendations.
- `npm run dq`: 99.1/100; data-quality gate passed.
- `npm run check:anon`: 102 files scanned; 0 prohibited-string hits (no local denylist supplied).
- `node --check` across JavaScript source, browser, evaluation, and scripts: passed.
- Browser E2E was attempted with system Chromium but navigation was blocked by this execution environment's administrator policy. The new CI workflow is configured to run it on a standard GitHub-hosted runner; it has not yet been run remotely. The CI job installs optional SDKs, so the three optional SDK tests are expected to execute there rather than skip; this still requires a successful remote run.

## Remaining release gates

- Obtain a successful GitHub Actions run including browser E2E.
- Run `npm run eval -- --llm` with a configured real model endpoint and retain latency, cost, and quality results.
- Conduct a supervised pilot with real users and approved institutional data before any production claim.
- Configure production access code, disable demo fault injection, review cookie/TLS/proxy settings, backups, retention, and incident response.

## Safety boundaries

- CI uses synthetic seed data and offline rule mode; it does not send user data to external model providers.
- A green offline evaluation does not establish real-world matching quality.
- A configured workflow is not the same as a passing remote CI run.
