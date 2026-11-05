---
status: accepted
---

# Secrets management: values generated on the dev VM, nothing secret in git, re-applied on every restore

Every secret value is generated once on the dev VM into files outside the repo, and one script copies them into Kubernetes Secrets. Git holds only Secret names, never values, not even encrypted. CNPG does not back up Kubernetes Secrets, so a restore brings data back but not credentials; the dev VM files are what survive a cluster rebuild ([Secrets management](https://github.com/bhh1893/health-tracker/issues/34)). This answers the open questions in ADR 0005, ADR 0010 and ADR 0011.

## Threat model

- **In scope:** a secret leaking through git (history is permanent, even in a private repo), through an image, CI log or app log, or into Claude's context on the dev VM.
- **Out of scope:** someone with access to the Windows PC or the VM disks. They already own everything, backups included. Consistent with ADR 0010 accepting a cleartext token on home Wi-Fi.
- **So:** no etcd encryption at rest in v1. Kubernetes Secrets are only base64-encoded in etcd, and reaching etcd takes the access ruled out above.

## Shape

- **Source of truth:** `~/.config/health-tracker/` on the dev VM, mode 600, outside the repo. `dev.yml` generates each value only if absent, which keeps the `changed=0` contract. This extends ADR 0011's `backup.env`.
- **Inventory:**

  | Secret | Holds | Used by |
  | --- | --- | --- |
  | `api-token` | Bearer token, at least 32 random bytes | nginx sidecar, as a mounted file (ADR 0010) |
  | `db-owner` | Role `app`: `username`, `password`, `DATABASE_URL` | Migration Job |
  | `db-api` | Role `api_rw`: `username`, `password`, `DATABASE_URL` | `api` |
  | backup key | Garage access key (ADR 0011) | CNPG Barman Cloud plugin |

  The GitHub key and ops SSH key are unchanged (ADR 0009, ADR 0004); they never enter the cluster.
- **`apply-secrets` (bash, `iac/scripts/`, run on the dev VM):** creates the namespace if needed and applies every Secret. Safe to re-run. Values go through stdin, never command-line arguments, which `ps` can read. It is the first step of `restore-data`, so `rebuild-cluster.ps1` gets it too and no path can forget it. If `api` starts first it waits in `CreateContainerConfigError` and recovers by itself.
- **Database roles:** `app` owns the tables and does DDL, used only by the short-lived migration Job. `api_rw` reads and writes rows only (`SELECT`, `INSERT`, `UPDATE`, `DELETE`), so a bug or injection in `api` cannot drop a table.
- **Role management:** both roles are inline `.spec.managed.roles` on the `Cluster`, with their Secrets typed `kubernetes.io/basic-auth` and labelled `cnpg.io/reload: "true"` so a password change applies immediately. Passwords are hex, so `DATABASE_URL` needs no escaping. Both overlays (`fresh`, `restore`) share this. CNPG superuser access stays off.
- **Grants:** in the first Alembic migration, including `ALTER DEFAULT PRIVILEGES` so tables created later are covered. CNPG has no table-level grants, and its `postInit*` hooks run on `initdb` only. Grants live in the database catalog, so a restore brings them back. `api_rw` must exist before the migration Job runs.
- **Token to the phone:** `show-token` draws a QR code of the plain token in the terminal; scan it, copy the text, paste it once into the SPA's "enter secret" screen. This is the one deliberate exception to scripts never printing secrets, and it is run by hand, not through Claude.
- **Secret scanning:** `gitleaks` runs in CI and feeds `ci-gate` (ADR 0014). No pre-commit hook in v1. It catches a leak after the push, so the response is to rotate the secret, not only delete the commit.
- **Rotation:** only on suspected exposure, no schedule. Steps live in `docs/runbooks/secrets.md`: replace the value, run `apply-secrets`, restart the pods (env vars and nginx's file read do not update a running process), and re-paste on the phone for the token.
- **Claude guardrail:** committed `.claude/settings.json` denies reading `~/.config/health-tracker/**` and running `kubectl get secret`. This is a guardrail, not a boundary: Claude runs as the same Linux user, so it stops accidents, not a determined process.
- **Acceptance for build tickets:** rehearse one rotation. In the restore drill, rotate a password, restore a backup from before the rotation, then log in as both roles. At build, use whichever role password field the pinned CNPG version supports (`passwordSecret` at v1.30.1; `main` docs mark it deprecated for a `password` stanza) and verify a basic-auth Secret may carry the extra `DATABASE_URL` key.

## Considered Options

- **SOPS + age (encrypted values in git).** The closest alternative and common on real teams. Rejected for v1: the age key must still be stored somewhere, Argo CD would need a plugin to decrypt, and the dev VM stays the single point of failure.
- **SealedSecrets.** Rejected: the controller's private key lives in the cluster a rebuild destroys, so it needs its own backup and a chicken-and-egg restore step.
- **External manager (Vault).** Rejected: another stateful service to run and back up, for about five values.
- **One database role for both.** Rejected: simpler, but `api` could drop tables, and the split costs one role and one Secret.
- **`DatabaseRole` resources, which CNPG's docs recommend.** Rejected: one is applied only when its spec or Secret changes. Our inference, not documented: after rotating a password then restoring an older backup, the database holds the old hash, nothing has changed from the resource's view, and `api` cannot log in. Its selling point is a role lifecycle separate from the cluster; we want the opposite, roles reset with each `Cluster` generation. Inline roles are periodically compared with the database and recreated with the `Cluster`.
- **Letting CNPG generate `pg-app`.** Rejected: a new value per bootstrap, while a restored database keeps its old roles until recovery ends.
- **Grants in `postInitApplicationSQL`.** Rejected: never runs on `restore`, and is not versioned with the schema.
- **QR code of a link with the token in the fragment.** Rejected: one tap, but needs SPA code and iOS may keep home-screen storage apart from Safari's.
- **Scheduled rotation.** Rejected: chores that match no threat in scope.
- **A separate Linux user and restricted kubeconfig for Claude.** Deferred to v2: a real boundary, but it needs careful scoping to keep `kubectl` useful for debugging.

## Consequences

- **Amends ADR 0005:** two roles, each with its own Secret; `pg-app` is no longer used. `api` still sees only `DATABASE_URL`.
- **Amends ADR 0011:** an empty bucket is now an error, and `fresh` needs an explicit `-Fresh` flag, including on first install. Previously a dev VM rebuild emptied the bucket, and a later cluster rebuild would destroy the live database, see nothing to restore, start empty and report success.
- **Amends ADR 0014:** integration tests connect as the limited role, so a missing grant fails in CI rather than in production; `gitleaks` joins `ci-gate`.
- **Amends ADR 0009:** the dev VM holds secrets as well as backups. After a dev VM rebuild new values are generated: run `apply-secrets`, restart the pods, re-paste the token, and take a base backup straight away.
- Secret values have no version history and live on one machine. Accepted: that machine already holds the only backups, so losing it loses the data those passwords protect anyway.
- Secrets sit outside Git, so a GitOps tool does not manage them. The CI/CD ticket must accept this; any image pull credential uses the same mechanism, and the smoke script (ADR 0014) can read the token only on the dev VM.
- v2: External Secrets Operator can fill the same Secret names from a cloud secret store, with no service changes. A managed database replaces `managed.roles`; the grants stay in Alembic.
