---
status: accepted
---

# Users keyed by `(issuer, subject)`, Role as checked text, and an approval command shipped in the `api` image

Each User has an internal UUID that Entries point at, plus the OIDC identity that signs in as them. A Role change is made by a command that runs inside a live `api` pod as `api_rw`, and each change is recorded in an append-only `role_changes` table. Decided in [Users, Roles and the approval command](https://github.com/bhh1893/health-tracker/issues/125). This builds on ADR 0021 and amends it (the email header).

## Shape

### `users`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK, `uuidv7()` | Unchanged. Every Entry and Catalog row points here (ADR 0002). |
| `issuer` | `text`, nullable | OIDC `iss`, e.g. `https://accounts.google.com`. |
| `subject` | `text`, nullable | OIDC `sub`. Never changes and is never reused at one issuer. |
| `role` | `text NOT NULL DEFAULT 'pending'` | `CHECK (role IN ('pending','member','admin'))`. |
| `name` | `text`, nullable | Display only: `GET /api/me` returns it. |
| `email` | `text`, nullable | Display only: how the Admin recognises a Pending person. Never used for lookup. |
| `created_at` | `timestamptz` | Unchanged. |

- `UNIQUE (issuer, subject)`, plus `CHECK ((issuer IS NULL) = (subject IS NULL))`.
- The seeded User (`019a0000-0000-7000-8000-000000000001`) has no identity and Role Pending until `claim-seeded` runs. Nobody can sign in as a row with no identity, so it cannot be reached before then.
- **Lookup is by `(issuer, subject)`, never by email.** A non-Gmail Google account can change its address, which would orphan the person's history. An address can also be recycled, which would hand one person's Entries to another. `issuer` is part of the key because `sub` is unique only within one provider, and this design has already changed provider once.
- **Freshness:** `current_user` sets `name` and `email` at Sign-up and updates them only when the header value differs (`WHERE ... IS DISTINCT FROM ...`), so normal requests write nothing. No `last_seen_at`: it would mean a write on every request, with no v1 use.

### `role_changes`

Append-only (rows are only ever inserted): `id`, `user_id` (FK `users`), `from_role` (nullable), `to_role`, `reason` (`approve` | `set-role` | `claim-seeded`), `changed_at`. It is written in the same transaction as the Role change it records. There is no "changed by" column: only the owner on the dev VM can run the command. Sign-up writes no row, because every User's first Role is Pending and `users.created_at` already records when.

### The command

`iac/scripts/users <subcommand>` is a few lines that run `kubectl exec deploy/api -c api -- python -m health_api.users <subcommand>`. The module uses the pod's own `DATABASE_URL`, so it connects as `api_rw`.

- `list`: every User with id, Role, name, email and `created_at`, Pending first.
- `approve <user-id>`: Pending to Member only; refuses any other starting Role.
- `set-role <user-id> <role>`: any change, including back to Pending to take someone's access away. Refuses to remove the last Admin.
- `claim-seeded <user-id>`: the target must be Pending and own no Entries or Catalog items, and the seeded User must have no identity yet. In one transaction it moves `issuer`, `subject`, `name` and `email` onto the seeded User, sets it to Admin, deletes the Pending User and writes the audit rows.
- Every subcommand that writes prints the row before and after and asks `y/N`.
- Deleting a User and their data is out of scope for v1.

## Considered Options

- **Key on email.** Rejected: addresses change and get recycled. The OIDC spec says to key on `sub`.
- **Postgres `ENUM` or a `roles` lookup table for Role.** Rejected: an `ENUM` cannot drop a value and adding one is awkward; a lookup table is machinery for three fixed values.
- **A bash script running SQL through `psql` as the superuser**, like `restore-data`. Rejected: the Role rules would live in untested SQL strings, separate from `current_user`'s copy, and run with power to do anything. Restore needs superuser; approval only changes rows.
- **No audit table: rely on terminal output, or `approved_at` columns.** Rejected: terminal output is gone once the terminal closes, and columns keep only the latest change.

## Consequences

- **Amends ADR 0021:** the proxy also injects the `email` claim as a trusted header. Add it to the "Verify at build" list.
- Approval needs a running `api` pod. If `api` is down, nobody can use the app anyway.
- A fix to the command ships through the normal image build and deploy (ADR 0016), and its tests run in CI against a real Postgres (ADR 0014).
- The `users` and `role_changes` tables contain names and emails: personal data, kept only in the database and its backups, never in the repo.
