# Terms

Tech terms defined while teaching, one line each. Domain language lives in `GLOSSARY.md`.

- **Modular monolith**: one deployable service whose code is split into internal modules that talk only through defined interfaces.
- **Distributed monolith**: separately deployed services that still must change and deploy together, paying microservice costs without the benefits.
- **Conway's law**: systems tend to mirror the communication structure of the org that builds them.
- **Origin**: scheme + host + port of a URL (`https://app.example.com:443`); the unit browsers use for security isolation.
- **Same-origin policy**: browser rule that blocks a page's JavaScript from reading responses from a different origin unless that server opts in.
- **CORS** (Cross-Origin Resource Sharing): the opt-in headers a server sends to let pages from other origins call it.
- **Path routing**: a gateway rule that picks the backend service by URL path, e.g. `/api/*` to one service and `/` to another.
- **Three-tier architecture**: presentation (web client), application (API), and data (database) layers, each deployed and scaled separately.
- **Platform component**: infrastructure the app depends on but the team configures rather than writes (gateway, database, cert-manager).
- **Schema migration**: a versioned, ordered script that changes the database schema (add table, add column) so every environment converges on the same shape.
- **Alembic**: the standard migration tool for SQLAlchemy (Python); each migration is a file with `upgrade()` and optional `downgrade()`.
- **Kubernetes Job**: a resource that runs a pod to completion once (exit 0 = success) instead of keeping it running like a Deployment.
- **Rolling update**: Kubernetes' default deploy, replacing old pods with new ones gradually, so old and new code run at the same time for a while.
- **Expand/contract** (parallel change): make schema changes in backward-compatible steps (expand, migrate code, then contract) so old and new code both work mid-rollout.
- **Shared database anti-pattern**: several services reading/writing the same tables, which couples them through the schema.
