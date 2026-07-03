# Whatsup Bangalore Constitution

Governing principles for the project. Seeded v1 — refine with `/speckit-constitution`.

## Core Principles

### I. Spec-driven, thin slices
Non-trivial features start as a spec (`/speckit-specify`) → plan (`/speckit-plan`) → tasks (`/speckit-tasks`) → implement (`/speckit-implement`). Ship the smallest vertical slice that a real user can touch; defer breadth to the backlog. Small, working increments over big rewrites.

### II. Respect the pinned runtime
This is not the Next.js you know (see `AGENTS.md`). Read the relevant guide in `node_modules/next/dist/docs/` before writing framework code; heed deprecation notices. Match the surrounding code's idiom, naming, and comment density.

### III. Verify in the real app (NON-NEGOTIABLE)
A change is not "done" until observed working. Previewable changes are verified in the browser via the preview tools (console, network, screenshot), not just by a passing build. State outcomes honestly — if something is untested or failing, say so.

### IV. Degrade gracefully, never hard-crash
The app must run without secrets: demo/mock mode when Supabase env is unset (`lib/supabase/client.ts` MOCK_MODE). Missing config, failed fetches, geolocation denials, and realtime drops surface a friendly state — never a blank screen or a silently swallowed action.

### V. Guardrails before scale
Community features (submissions, votes, comments, uploads) ship with an abuse story: RLS enforced server-side, non-admin content moderated, inputs validated, secrets never committed. New user-generated surfaces must address the relevant items in `BACKLOG.md` → "Guardrails & edge cases".

### VI. Simplicity & token discipline
Prefer editing over rewriting. Reuse existing utilities (`lib/ds.ts`, `lib/data.ts`, `lib/format.ts`) over new abstractions. Keep solutions direct; no speculative generality (YAGNI).

## Tech & Security Constraints
- Stack: Next.js (App Router, TS) + Supabase (Postgres, Auth, Storage, Realtime) + MapLibre. Free tiers.
- Row Level Security is the security boundary — the browser only ever holds the publishable/anon key. The service-role/secret key is server-only and never `NEXT_PUBLIC_`.
- Secrets (`.env.local`, `client_secret_*.json`) are gitignored and never committed.
- Schema changes are versioned SQL in `supabase/migrations/`, applied in order; document any that must be run manually.

## Workflow & Quality Gates
- Keep `STATUS.md` current — it is the session-to-session source of truth.
- Before committing: `npx eslint .` clean and `npm run build` green.
- Commit/push only when asked; branch off `main` first if not already on a feature branch.
- Update `BACKLOG.md` when scope is deferred; update this constitution when a principle changes.

## Governance
This constitution guides day-to-day decisions; when a principle blocks progress, surface the tradeoff rather than silently working around it. Amend via `/speckit-constitution`, bumping the version and dating the change below.

**Version**: 1.0.0 | **Ratified**: 2026-07-03 | **Last Amended**: 2026-07-03
