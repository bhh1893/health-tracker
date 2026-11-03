---
status: accepted
---

# Web client: React + TypeScript SPA, types-only OpenAPI client, served by unprivileged nginx

`web` (ADR 0001) is a single-page app in strict TypeScript, built with React + Vite into static files and served by `nginx-unprivileged` from a multi-stage image. It talks to the API through `openapi-fetch`, typed by `openapi-typescript` output generated from `services/api/openapi.json` and committed in `services/web`. We chose React because it is the best-documented, most-hired-for option: when stuck, answers exist. The contract is consumed as types only, so a breaking API change fails the `web` build instead of reaching the phone.

## Shape

- **Stack:** TypeScript (strict), React, Vite, React Router (history URLs: `/log`, `/day/{day}`, `/exercises/{id}`), TanStack Query for every API call; plain React state only for the form being edited (the client holds the whole Meal, ADR 0006). ESLint + Prettier run in CI.
- **Contract:** `services/web/src/api/schema.d.ts` is generated from `../api/openapi.json` by a script and committed. CI regenerates it and fails on drift, triggered by changes under `services/web/**` **or** to `services/api/openapi.json`. A contract change lands in one PR as three visible diffs: Pydantic models, `openapi.json`, `schema.d.ts`.
- **Calls:** relative `/api/v1/...` only. One origin (ADR 0001) means no API URL, no CORS, and no per-environment config: one image runs on Vagrant and in any cloud. If runtime config is ever needed, the container serves a `config.json`; nothing is baked in at build time.
- **Image:** stage 1 (Node) runs `vite build`; stage 2 copies `dist/` into `nginxinc/nginx-unprivileged` (non-root, port 8080). Node never ships.
- **nginx rules:** unknown paths fall back to `index.html` (deep links survive refresh); hashed `assets/*` are `Cache-Control: immutable`, one year; `index.html` is `no-cache` so a deploy is visible on next load.
- **PWA:** a web app manifest only (home-screen icon, full-screen launch). No service worker.
- **Retries:** TanStack Query may retry writes, because every write is an idempotent `PUT` to a client-generated UUIDv7.

## Considered Options

- **Svelte / SvelteKit.** Not chosen: less code, but a smaller ecosystem and fewer answers to learn from.
- **No framework (vanilla TS).** Rejected: hand-rolls state-to-DOM syncing, the problem frameworks exist to solve.
- **Next.js.** Rejected: built around a Node server for server rendering; we serve static files.
- **Full client codegen (`openapi-generator`, `orval`).** Rejected: a large generated layer to read and maintain for the same type safety a single `.d.ts` plus a 6 KB wrapper gives.
- **Widen the `web` build context to the repo root, or copy `openapi.json` in from CI.** Rejected: breaks ADR 0003's self-contained builds, or makes a local `docker build services/web` fail.
- **Hash routing (`/#/day/...`).** Rejected: avoids the server fallback, which is three lines of nginx.
- **Service worker with an offline write queue.** Deferred: v1 is home Wi-Fi only. Client IDs and idempotent `PUT` make it addable later with no API change.

## Consequences

- `web` CI must watch `services/api/openapi.json`, amending ADR 0003's "filter by path" to include that cross-service trigger.
- Styling, component library and the accessible typeahead combobox are decided by the Form UX prototype; how the browser presents the shared secret is decided by Edge design.
- Without a service worker, logging needs a connection; a failed save stays in the form for retry.
