---
status: accepted
---

# Two app services: one modular API and a static web client

v1 runs on Kubernetes, which invites splitting the backend into microservices. We build exactly two app services: `api`, one FastAPI modular monolith (internal modules for Meals/Food, Exercise, Catalogs), and `web`, static HTML/JS in its own container. The edge (Cilium Gateway API) and Postgres are platform components we configure, not services we write. We did not split the API by noun because a Meal and its Food Entries must save in one transaction, there is one user so nothing scales independently, there is no team boundary to mirror, and the pieces would always release together: a distributed monolith.

## Considered Options

- **Food service + Exercise service.** Rejected: shared transaction, shared Day and auth logic, coupled releases.
- **FastAPI serves the web client's static files.** Rejected: couples UX iteration to the service that holds data; one process doing two jobs.
- **Web and API on separate subdomains.** Rejected: needs CORS and preflight requests for no benefit.

## Consequences

- One origin with path routing at the edge: `/api/*` to `api`, everything else to `web`. One TLS cert, one place to enforce the shared secret.
- `api` is the sole owner of the database. Nothing else reads or writes tables; one-command queries go through the API. Migrations and backups are database operations, not app access.
- Schema migrations run as an Alembic Kubernetes Job built from the `api` image, before rollout. Old and new `api` pods overlap during a rolling update, so every migration must be expand/contract-safe; we roll forward, not back.
- A module is extracted into its own service only when a concrete reason appears (independent scaling, a different runtime, an external dependency with its own failure mode).
