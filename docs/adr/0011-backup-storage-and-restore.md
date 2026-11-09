---
status: accepted
---

# Backup storage and restore: Garage on the dev VM, daily base backup plus continuous WAL, restore by script

CNPG backs up to an S3-compatible bucket served by Garage on the dev VM. Postgres ships its change log (WAL) continuously and takes one base backup a day at 21:00, keeping 7 days. Restore is a bash script on the dev VM that deletes the `pg` Cluster and recreates it from the newest backup; `rebuild-cluster.ps1` calls the same step, so every rebuild is also a restore drill ([Backup storage and restore](https://github.com/bhh1893/health-tracker/issues/22)). This answers the open question in ADR 0005.

## Shape

- **Target:** Garage installed by `iac/ansible/dev.yml` (role `garage`) as one pinned binary under systemd (no Docker needed for it), data in `/var/lib/garage`, listening on `192.168.56.20:3900` over plain HTTP on the host-only network. Pods reach it through their node; it never crosses Wi-Fi. Originally MinIO; see "Amendment: MinIO replaced by Garage" below.
- **Durability settings:** one node means no second copy to repair from, so Garage runs SQLite metadata with `metadata_fsync` and `data_fsync` on and a metadata snapshot every 6 hours. This trades write speed, which backups do not need, for surviving an unclean stop.
- **Credential:** a dedicated Garage access key (`cnpg-backup`) with read and write on the `backups` bucket only: no owner flag, and it cannot create buckets. `dev.yml` generates it once into `~/.config/health-tracker/backup.env` (mode 600, outside the repo). `apply-secrets` reads that file and creates the Kubernetes Secret (ADR 0015).
- **Schedule and retention:** continuous WAL archiving (a base backup is only restorable together with its WAL, so this is not optional) plus a CNPG `ScheduledBackup` at 21:00. Retention policy 7 days. A run missed because the machines were off is skipped, not caught up. Data-loss window while everything is up: about a minute.
- **Two overlays:** `fresh` bootstraps with `initdb` (empty database); `restore` bootstraps with `recovery` from the newest backup. A recovered cluster cannot archive into its parent's folder, so each generation writes to a new `serverName`, `pg-<timestamp>`, and reads from the newest existing folder. The bucket is the only record of generations; nothing is stored in the cluster, which is what gets destroyed.
- **Choosing an overlay:** the script lists the bucket. A backup found means `restore`; an empty bucket is an error and the script stops. `fresh` happens only with an explicit `-Fresh` flag, including on first install (amended by ADR 0015: a missing backup must never trigger a destructive default).
- **`restore-data` (bash, `iac/scripts/`, run on the dev VM):** run `apply-secrets` (ADR 0015), stop `api`, delete `pg`, apply the `restore` overlay (optional `--at <time>` for point-in-time recovery), wait for healthy, check row counts, restart `api`. It needs only `kubectl`, not Vagrant, so it is not PowerShell. `docs/runbooks/backup-restore.md` explains every step.
- **Rebuild:** `rebuild-cluster.ps1` (ADR 0004) ends by calling `restore-data` over `ssh dev`.
- **`backup-status` (bash):** prints the last base backup's age and WAL archive health; exits non-zero if the last backup is over 36 hours old or archiving is failing. The runbook says to run it weekly. No alerting in v1.
- **Acceptance for build tickets:** one full restore drill passes before the setup is trusted, and Garage is pinned.

## Amendment: MinIO replaced by Garage

Checked at build, 2026-11-04 ([#49](https://github.com/bhh1893/health-tracker/issues/49)). `minio/minio` is archived, its README says it is no longer maintained, and `dl.min.io` answers `410 Gone` for the server binary, so the original "one pinned binary" could not be installed. The cluster side is unchanged, as this ADR predicted.

- **Why Garage over SeaweedFS:** both are maintained. Garage is one binary built for small self-hosted setups, with a documented single-node mode and bucket-scoped keys built in. SeaweedFS has a wider S3 feature set this project does not use.
- **Tested before choosing:** Barman Cloud against Garage had no public evidence either way, and Garage's docs tell you to test. A throwaway run with Barman 3.20.1 and boto3 1.43.124 passed a base backup, WAL archive and restore, and an extract of the base backup. Starting Postgres from a restored backup is left to the restore drill.
- **Rejected: building the archived MinIO source.** It would hold the only backups on software with no security fixes.
- **Rejected: AIStor Free.** A different product under a free license, where this ADR assumed open source.
- **Weaker pin:** Garage publishes no checksum file we could find, so the committed sha256 is one we computed. It detects a changed download, not a binary that was bad from the start.

## Amendment: settings confirmed at build

Checked at build, 2026-11-06 ([#51](https://github.com/bhh1893/health-tracker/issues/51)).

- **Data-loss window:** CNPG defaults `archive_timeout` to 5 minutes, and at this write volume the timeout, not the 16 MB segment size, decides when WAL ships. `pg` sets it to `1min`, so "about a minute" above holds. A forced switch only happens after writes, so an idle database ships nothing extra.
- **cert-manager:** the Barman Cloud plugin needs it for the mTLS certificates between the operator and the plugin. Ansible installs both from `k8s/platform/`, as ADR 0016 does for other platform charts. Rejected: creating those certificates by hand, which leaves their renewal to us.
- **Schedule clock:** the operator runs in UTC, so 21:00 means 21:00 UTC.
- **Locale:** `initdb` uses `C.UTF-8`. CNPG's default `C` splits `jalapeño` at the `ñ` in `pg_trgm` (tested), which hurts typeahead. Rejected: `en_US.UTF-8`, which matches the test image but whose sort order can shift with glibc, and a physical restore carries indexes across images.

## Amendment: restore details settled at build

Checked at build, 2026-11-09 ([#52](https://github.com/bhh1893/health-tracker/issues/52)).

- **"Newest" means newest with a finished base backup.** A generation with only WAL (a restore that failed before its first backup) has nothing to replay onto, so `restore-data` skips it. With `--at`, the generation must also hold a base backup from before the target.
- **A base backup right after every restore.** Otherwise the new generation is not restorable by itself until 21:00, and losing it before then would mean restoring the previous generation and losing every write since.
- **No loss on a planned restore.** With `api` stopped, `restore-data` closes the current WAL segment and waits for it to reach the bucket before deleting `pg`. The one-minute window applies to unplanned losses only.
- **Checks:** row counts must match before and after a full restore, and both roles must log in over the network with their Secrets (ADR 0015's rotation case).
- **Listing the bucket:** `curl --aws-sigv4`, which signs S3 requests itself, rather than installing an S3 client on the dev VM. Rejected: reading generations from the `ObjectStore` status, which lives in the cluster a rebuild destroys.
- **`backup-status`** reads the Barman Cloud plugin's `ObjectStore` status for this generation's last base backup, and CNPG's `ContinuousArchiving` condition. A generation with no base backup yet fails too.
- **PITR** is a third overlay, `restore-pitr`, on top of `restore`, so each overlay still reads on its own.
- **Drill passed, 2026-11-09:** a base backup, a rotation of `api_rw`'s password, then a point-in-time restore to before the rotation. The restored database held the old password and CNPG set the new one from the Secret; both roles logged in. Then a full restore from that new generation, with matching row counts. Each took about 90 seconds, which is the measured RTO.
- **Found by the drill:** `pg_walfile_name(pg_switch_wal())` names the segment after the one just closed, so the wait never ended; the script uses `pg_switch_wal() - 1`. A re-run after a failure did not restart `api` or resume sync; annotations now record what to restore. Also found: `pg-daily` stopped firing after 2026-11-06 ([#130](https://github.com/bhh1893/health-tracker/issues/130)).

## Considered Options

- **A cloud bucket (Backblaze B2, R2, S3) from the start.** Better durability (survives losing the PC) and no WAL-pileup risk, but an account and a credential to manage in v1. Deferred to v2, where it is a swap of endpoint and credentials, since the S3 API is the same.
- **The object store on the Windows host.** Rejected: same disk as the VMs, and a service outside the Vagrant/Ansible stack that the runbook cannot rebuild.
- **The object store in the cluster.** Rejected: a rebuild would destroy the backups it exists to survive.
- **Daily base backup only.** Not possible: CNPG backups require WAL archiving.
- **One script for fresh install and restore, templating one manifest.** Rejected for two overlays: each is readable on its own and the choice is one visible branch in the script.
- **A manual `kubectl` runbook only.** Rejected: restore is six steps with exact YAML, a typo while deleting `pg` loses the database, and "one command" is part of v1's definition of done. The runbook remains so every step is understood.

## Consequences

- **Amends ADR 0009:** the dev VM now holds the backups, so it is no longer stateless. Destroying it destroys the only backup copy; its runbook gets a warning and the "no unique state" line is corrected.
- Backups share the PC's disk and do not survive losing it. Accepted for v1; fixed by the v2 cloud bucket.
- If only the dev VM is halted while the cluster runs, WAL piles up on the 5 Gi Postgres volume and can eventually stop the database. Powering off the whole PC is safe. `backup-status` is the mitigation.
- `dev.yml` gains a `garage` role, bucket and key creation; CNPG needs the Barman Cloud plugin installed from `k8s/platform/`.
- Every rebuild exercises restore, but rebuilds are occasional, hence the weekly `backup-status` check.
