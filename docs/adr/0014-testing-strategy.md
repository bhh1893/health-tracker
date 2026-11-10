---
status: accepted
---

# Testing strategy: integration-heavy `api` on real Postgres, Vitest + MSW for `web`, one gated PR bar

`api` is tested mostly through HTTP against a real Postgres built by its own migrations; `web` is tested with Vitest, Testing Library and a mocked network; there is no browser end-to-end suite in v1; and one always-running CI job is the only required check on a PR ([Testing strategy](https://github.com/bhh1893/health-tracker/issues/33)). This completes the CI hooks left by ADR 0003 (path filters, drift check), ADR 0004 (IaC lint), ADR 0006 (`operationId` lint), ADR 0007 (`schema.d.ts` drift) and ADR 0012 (plan assertions).

## Shape

- **`api` tests (`pytest`):** about 80% are integration tests through FastAPI's `TestClient` into a real Postgres. Plain unit tests only for pure logic (timezone and `day` math, validation edge cases). The database is never mocked: the risk lives in SQL, composite FKs, the DB-enforced Meal kind and `pg_trgm` thresholds.
- **Real Postgres:** `testcontainers-python` starts `postgres:18` from inside pytest; the schema is built by `alembic upgrade head` (so every run tests the migrations); each test runs in a transaction that is rolled back. Migrations run as the owner role and tests connect as the limited `api_rw` role, so a missing grant fails here and not in production (ADR 0015). Same command on the dev VM (Docker is already in ADR 0009) and on GitHub-hosted runners.
- **Contract fuzzing:** Schemathesis reads the contract and fuzzes every endpoint against the real `api` + Postgres, checking responses match the schema, schema-invalid input is refused and nothing returns 5xx. One CI job, `pytest -m fuzz`, on the same fixtures as the other tests and left out of plain `pytest`. A hook fills valid requests with real timezones and seeded rows, or they would stop at validation. Schema-valid input may still be refused, because the schema cannot state rules like "this Food exists". The seed is fixed in CI, so the gate cannot fail a PR at random; a local run draws new inputs.
- **`web` tests:** Vitest + React Testing Library, API calls intercepted by MSW (Mock Service Worker) with handlers typed from `schema.d.ts`, so a contract change breaks compilation. Aimed at the risky UI: Meal bottom sheet, ComboBox, one-tap repeat Set, Day pager URL behavior. `tsc --noEmit` is required. No snapshot tests.
- **End-to-end:** no Playwright in v1. A post-deploy **smoke script** runs against the real cluster with the real token: `PUT` a Meal, read it back, check a missing token gives 401, delete the Meal. The 7-day phone trial is the UI end-to-end test. Revisit Playwright in v2 if UI regressions hurt.
- **Index plans (ADR 0012's hand-off):** a separate workflow, manual plus weekly schedule and **not** on every PR, loads the full 100-user seed and runs `EXPLAIN (FORMAT JSON)` per v1 query. It asserts plan shape only: the expected index name appears and there is no `Seq Scan` on the entry tables. No timings. A PR that touches `migrations/` or query code includes the latest run's result in its description (PR template line).
- **PR bar**, enforced by branch protection through one required job, `ci-gate`:
  - `api`: `ruff` lint and format, `pyright` strict, `pytest`, `openapi.json` drift, `operationId` lint, Schemathesis, `docker build` (no push).
  - `web`: ESLint, Prettier, `tsc`, Vitest, `schema.d.ts` drift, `vite build`, `docker build`.
  - Platform: `kustomize build` + `kubeconform` on every overlay including `fresh` and `restore`; `ansible-lint` and `yamllint` (ADR 0004).
  - Repo-wide: `gitleaks` secret scan (ADR 0015).
  - Jobs are path-filtered (ADR 0003, ADR 0007's cross-trigger). `ci-gate` always runs and passes when every filtered job passed or was skipped.
  - No numeric coverage threshold. Failing or flaky checks are fixed when found, even if unrelated.
- **Config location:** test and lint config lives inside each service (ADR 0003); no root workspace.

## Amendment: shellcheck

Added 2026-11-09, after #52 added `restore-data` and `backup-status`. Those scripts delete the database and handle secrets, yet no linter checked them.

- **`shellcheck` joins `ci-gate`.** It runs on every PR with no path filter, like `gitleaks`. Scripts are found by their first line (`#!` naming `sh`, `bash` or `dash`) or a `.sh`/`.bash` name, not by folder, so a new script anywhere is covered. If it finds no scripts at all, it fails.
- **Pinned** to `shellcheck-py` 0.11.0.1 in both CI and the `dev_workstation` role, so a local run matches CI.
- **A finding is fixed, or silenced on that one line** with a `# shellcheck disable=` directive and a comment saying why. No repo-wide disable list.

## Considered Options

- **Mocked repositories under a classic test pyramid.** Rejected: fast, but proves nothing about the SQL, constraints or trigram behavior where the bugs would be.
- **GitHub Actions `services:` Postgres container.** Rejected: CI and local runs would differ.
- **Testing against the CNPG cluster.** Rejected: slow, couples tests to cluster state, and hosted runners cannot reach it.
- **Jest for `web`.** Rejected: older, more config on a Vite project.
- **Playwright end-to-end in CI.** Deferred: needs the whole stack up on a runner; a smoke script plus the dogfood week covers v1.
- **Index-plan or timing assertions on every PR.** Rejected: on small data the planner rightly picks sequential scans, and timings are flaky.
- **Coverage percentage gate.** Rejected: gets gamed, and tests here are chosen by risk.
- **Requiring each filtered job directly.** Rejected: a path-filtered job that never runs leaves a required check pending forever; the single `ci-gate` avoids it.

## Consequences

- Test runs need Docker and pull `postgres:18`: slower than mocks (seconds per suite start), cached on runners.
- Rolled-back transactions cannot test code that commits itself (the migration Job, concurrent writers); those get dedicated tests with a fresh container.
- Schemathesis can surface many validation gaps on first run; budget build time to fix them.
- The weekly plan workflow can fail with no PR open; that is intended, it catches planner or data-shape drift.
- A smoke script is another thing to maintain; it also becomes the deploy verification step for the CI/CD ticket.
