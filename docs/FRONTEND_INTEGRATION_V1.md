# FomoThon Frontend Integration V1

## Design direction

The existing `public/` frontend is retained as the implementation baseline. It already implements the warm cream/orange visual language, a three-column desktop shell (navigation / workspace / Agent trace), role-aware navigation, a mobile layout, and a live execution trace. This phase intentionally avoids replacing it with a generic dashboard or introducing a new framework.

## Current frontend modules

- `public/index.html`: application shell, login shell, navigation, workspace, trace panel.
- `public/styles.css`: design tokens, layout, cards, responsive breakpoints, trace styling.
- `public/app.js`: session bootstrap, role-aware navigation, data loading, trace rendering/export.
- `public/assistant.js`: natural-language task entry, run/auto-step/confirm/cancel loop, result cards.
- `public/pages.js`: profile, invitations, skill catalog, evaluation and admin pages.
- `public/ui.js`: safe DOM builder, API client, error handling and shared UI primitives.

## API contract used by the browser

All API responses use the server envelope `{ success, data }`; errors use `{ success: false, error: { code, message } }`.

| Method | Path | Purpose | Browser caller |
|---|---|---|---|
| GET | `/api/meta` | system metadata and demo flags | `app.js` |
| GET | `/api/me` | current session | `app.js` |
| GET | `/api/personas` | demo login personas | `app.js` |
| POST | `/api/login` | start session | `app.js` |
| POST | `/api/logout` | end session | `app.js` |
| GET | `/api/skills` | shared skill catalog | `app.js` |
| POST | `/api/agent/run` | create a run from `{ goal, faults? }` | `assistant.js` |
| POST | `/api/agent/:id/auto-step` | advance the orchestrator | `assistant.js` |
| POST | `/api/agent/:id/confirm` | submit a pending human decision | `assistant.js` |
| POST | `/api/agent/:id/cancel` | cancel a run | `assistant.js` |
| GET | `/api/agent/:id/evidence` | retrieve trace and metrics | `app.js` |
| GET | `/api/profile` | current user's profile | `pages.js` |
| GET/POST | `/api/invitations...` | list/respond to invitations | `pages.js` |
| POST | `/api/profile/settings` | update own matchmaking consent and availability | `pages.js` |

The server remains authoritative for identity, authorization, run ownership, recommendation eligibility and write permissions. The browser must never construct invitation writes directly from arbitrary candidate data; it can only submit the server-provided pending confirmation payload.

## UX reliability change in this phase

The task start action now locks immediately while the run-creation request is in flight. This prevents rapid double-clicks from creating duplicate runs before the polling loop begins. The button exposes `aria-busy`, and blank goals cannot be submitted.

## Consent and privacy controls

The student profile now exposes `openToMatch`, `looking`, and `hoursPerWeek` settings. Changes are persisted to the signed-in student's own `users.attrs` record, restricted to the student role, validated server-side, and audited. Turning off `openToMatch` also forces `looking` off. The matching agents already filter candidates using `openToMatch`, so the setting takes effect on subsequent searches. Existing invitations are not retroactively cancelled.

## Validation

- `node --check public/app.js`
- `node --check public/assistant.js`
- `node --check public/pages.js`
- `node --check public/ui.js`
- `npm test`

## Deliberate scope limits

This phase does not claim that the frontend is fully browser-E2E tested. The uploaded `demo-site.zip` design reference was not present in the active workspace at implementation time; the project’s existing frontend already contains the warm orange/cream, three-column style described in the conversation, so it was preserved rather than guessed or replaced. Visual pixel-comparison against the reference remains pending until that archive is available in the workspace.
