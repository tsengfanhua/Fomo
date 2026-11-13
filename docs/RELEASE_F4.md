# F4 Release Notes — Matching Consent UX

## Scope

F4 makes the matching eligibility rules visible in the student profile and makes insufficient-candidate outcomes actionable without weakening privacy requirements.

## Changes

- Added a three-part eligibility panel for matching consent, confirmed/non-stale skill profile, and positive weekly availability.
- Added explicit blocker explanations for each unmet condition.
- Added a direct navigation action to the assistant for profile inventory/reconfirmation when the profile is draft or stale.
- Clarified that exact skill scores remain private and that matching eligibility requires all three independent conditions.
- Added exclusion counts and a no-valid-candidate explanation to teammate Agent results.
- Added responsive styling for the consent panel and no-result state.
- Corrected the profile view to read matching settings from the API response's top-level `settings` object rather than the nested skill profile. This avoids dereferencing a field that the inventory profile does not contain.

## Verification

- `node --check public/app.js`
- `node --check public/pages.js`
- `node --check public/assistant.js`
- `node --test test/*.test.js`

Latest test run: 103 passed, 0 failed, 3 skipped (optional SDK dependencies not installed).

Browser E2E remains a separate verification item because the current environment does not include the Playwright browser runtime.
