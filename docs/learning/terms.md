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
- **`.gitattributes`**: a committed file that tells Git how to treat paths (line endings, binary vs text, diff drivers) the same way on every machine.
- **`core.autocrlf`**: a per-machine Git setting that converts LF to CRLF on checkout; `.gitattributes` overrides it so the repo, not each laptop, decides.
- **UUIDv7**: a 128-bit ID whose leading bits are a timestamp, so it is unguessable yet sorts roughly by creation time (index-friendly, unlike random UUIDv4).
- **IDOR** (Insecure Direct Object Reference): a bug where changing an ID in a URL lets one user read or edit another user's row because ownership is not checked.
- **Single-table inheritance**: storing several related entity kinds in one table with a type column and nullable columns for each kind.
- **Polymorphic table**: one table holding rows of several kinds (e.g. all Catalog items with a `type` column); foreign keys can no longer guarantee they point at the right kind.
- **IANA timezone**: a named region with its full DST history, e.g. `America/Los_Angeles`; unlike a fixed offset like `-08:00`, it stays correct across daylight saving changes.
- **Generated column**: a column Postgres computes from other columns on write; only immutable expressions are allowed.
- **Soft delete**: marking a row deleted (`deleted_at`) instead of removing it; every query must then filter it out.
- **`ON DELETE CASCADE` / `RESTRICT`**: foreign key rules: deleting the parent deletes children automatically, or the database refuses while children exist.
- **CHECK constraint**: a boolean rule the database evaluates on every insert/update, rejecting rows that violate it.
- **Composite foreign key**: a foreign key over several columns, e.g. `(meal_id, meal_kind)` referencing `meals(id, kind)`, used to enforce cross-table rules.
- **Normalization**: structuring tables so each fact is stored once; duplication is only a problem when copies must stay in sync.

- **Denormalization**: deliberately storing a derivable fact a second time (e.g. a Sessions table) for speed or convenience, at the cost of keeping the copies in sync.
- **Materialized view**: a query result Postgres stores as a table and refreshes on demand; the read-speed step before hand-maintained denormalized tables.
- **Row-Level Security (RLS)**: Postgres policies that automatically filter which rows a session can read or write, e.g. only rows whose `user_id` matches the current user.
- **Immutable function**: a Postgres function guaranteed to return the same output for the same input forever; only these may feed generated columns and indexes.
