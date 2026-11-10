# Backup and restore

`pg` ships its WAL to the `backups` bucket on the dev VM within about a minute of each write and takes a base backup every day at 21:00 UTC (ADR 0011). Two scripts cover the rest: `iac/scripts/backup-status` says whether backups are healthy, and `iac/scripts/restore-data` rebuilds `pg` from them. Run both on the dev VM. A backup nobody has restored is only a hope, so do a drill (below) after any change to this setup.

## How the bucket is laid out

```
s3://backups/
  pg-20261106T010900Z/        one generation: one pg Cluster's lifetime
    base/20261106T011129/     a base backup: a full copy of the data files
    wals/...                  every change since, in 16 MB segments
  pg-20261109T061500Z/        the next generation, after a restore
```

A base backup alone is a copy from one moment. To restore, Postgres copies a base backup, then replays WAL from that moment onward. That replay is also what makes point-in-time recovery possible: stop replaying at a chosen moment.

Each restore starts a new generation, because a restored cluster may not write into the folder it read from. The folder name is the `serverName` on the `Cluster`, and the timestamp in it means sorting the folders sorts them by age.

## Check backups: `backup-status`

Run it weekly, after every restore, and after rotating `backup.env`.

```
iac/scripts/backup-status
```

```
generation:      pg-20261109T061500Z
last backup:     2026-11-09T06:19:40Z (2h ago)
restorable from: 2026-11-09T06:19:40Z
WAL archiving:   True Continuous archiving is working
last archived:   2026-11-09 08:01:12+00 (failures: 0, last never)
OK
```

It exits 1 if:

- **The last base backup is over 36 hours old.** A missed daily run is normal when the PCs were off at 21:00 UTC. Take one by hand (`docs/runbooks/postgres.md`, "Take a backup now"). If they were on, the `ScheduledBackup` is not firing: check `kubectl -n health-tracker get scheduledbackup pg-daily -o yaml` for `nextScheduleTime`.
- **This generation has no base backup yet.** Its WAL has nothing to replay onto. `restore-data` takes one at the end, so this should only appear after a `--fresh` install or an interrupted restore.
- **WAL archiving is failing.** Is Garage running (`systemctl status garage` on the dev VM)? Then read the primary's log for `archive`. While it fails, WAL piles up on the 5 Gi volume (ADR 0011).

`failures` counts every archive attempt that ever failed. A freshly restored cluster starts at about 15, all dated in the first seconds after recovery, before its first `Archived WAL file` log line. Seen in both 2026-11-09 drill restores; the cause is not confirmed, because the recovery pod and its logs are gone by then. One right after a failover is expected (`docs/runbooks/postgres.md`, "Test failover"). Only a failure newer than `last archived` means archiving is broken now.

## Restore: `restore-data`

```
iac/scripts/restore-data --dry-run              # what it would do; changes nothing
iac/scripts/restore-data                        # newest data
iac/scripts/restore-data --at 2026-11-09T05:00:00Z   # data as it was at that moment (UTC)
iac/scripts/restore-data --fresh                # first install only: empty database
```

Expect about 90 seconds of downtime for `api` (measured in the 2026-11-09 drill). `web` keeps serving the page, but every request fails.

### What it does, step by step

1. **Pick a generation.** It lists the bucket and takes the newest generation that holds a finished base backup, so a generation with only WAL is skipped. With `--at`, the generation must hold a base backup from before that moment. With no backup at all, it stops: an empty database must never be the fallback (ADR 0015). `--fresh` is refused if the bucket holds a backup.
2. **`apply-secrets`.** The roles' passwords come from these Secrets, and backups do not include Secrets (ADR 0015).
3. **Suspend Argo CD auto-sync** if it is on. Otherwise Argo's self-heal starts `api` again while `pg` is gone (ADR 0016).
4. **Stop `api`** by scaling it to 0, so nothing writes from here on.
5. **Ship the last WAL.** If `pg` is healthy: count the rows in every table, close the current WAL segment (`pg_switch_wal()`), and wait until it is in the bucket. With nothing writing, the bucket now holds everything, so the restore loses no data. If `pg` is not healthy this step is skipped and up to a minute of writes is lost.
6. **Delete `pg`.** Its pods and volumes go with it. The bucket is untouched.
7. **Create `pg` from the `restore` overlay** (`k8s/envs/vagrant/pg/restore/`): `bootstrap.recovery` reads the chosen generation as `externalClusters: origin` and writes to a new `pg-<now>` generation. `--at` uses `restore-pitr`, which adds `recoveryTarget.targetTime`. It waits up to 15 minutes for `Ready`.
8. **Check.** It logs in over the network as `app` and as `api_rw`, using the Secrets just as `api` and the migration Job do. It prints row counts and, for a full restore, fails if they differ from step 5.
9. **Take a base backup** of the new generation, so it can be restored from by itself straight away instead of only after 21:00.
10. **Start `api`** with its old replica count, then **resume auto-sync**. On a rebuild, sync was never on and `api` was never deployed, so both are skipped: `deploy-app` turns sync on afterwards.

### If it fails

It stops at the failed step and leaves `api` stopped and auto-sync off on purpose: starting `api` against a broken database helps nobody. Everything before step 6 leaves `pg` untouched, and after it the data is in the bucket. Read the message, fix the cause, and run `restore-data` again. It starts from the top and handles a missing `pg`.

Steps 2 and 3 record what they changed in a `health-tracker/restore-data` annotation: on the Argo `Application` (`sync-suspended`) and on the `api` Deployment (its replica count). That is how a re-run knows to start `api` with 2 replicas and turn sync back on, even though it finds them at 0 and off. The last step removes both annotations.

Common causes:

- **`pg` never becomes Ready.** `kubectl -n health-tracker get pods` and the logs of the `pg-1-full-recovery` pod. A missing WAL segment in the bucket shows up there.
- **Login check fails.** The role's password did not match its Secret. Check `kubectl -n health-tracker get cluster pg -o jsonpath='{.status.managedRolesStatus}'`.
- **Row counts differ.** Something wrote after step 5, or WAL is missing. Do not start `api`; look before you write more.

To bring the app back by hand after a failure, without restoring:

```
kubectl -n health-tracker scale deployment api --replicas=2
kubectl -n health-tracker annotate deployment api health-tracker/restore-data-
kubectl -n argocd patch application health-tracker --type=merge \
  -p '{"spec": {"syncPolicy": {"automated": {"prune": true, "selfHeal": true}}}}'
kubectl -n argocd annotate application health-tracker health-tracker/restore-data-
```

## RPO and RTO

- **RPO (how much data a disaster can cost):** about a minute, since `archive_timeout` is `1min`. A planned restore of a healthy `pg` costs nothing (step 5). Losing the dev VM's disk costs everything, because the bucket lives there (ADR 0011, fixed in v2 with a cloud bucket).
- **RTO (how long until the app is back):** about 90 seconds, measured in the 2026-11-09 drill on a 10-row database restored from a base backup minutes old. It grows with the database size and with the time since the last base backup, because all WAL since then is replayed. A restore after a cluster rebuild adds the rebuild itself (`docs/runbooks/rebuild.md`, which calls `restore-data` and then `deploy-app`).

## Drill

Do it after changing anything in this setup, and at least once per version. It covers ADR 0011's restore and ADR 0015's rotation check: a backup from before a password rotation must still let both roles log in.

1. `iac/scripts/backup-status`. Take a backup by hand if it is old.
2. Note the time: `date -u +%Y-%m-%dT%H:%M:%SZ`. This is the target.
3. Rotate the `db-api.env` password (`docs/runbooks/secrets.md`, "Rotate a secret"). Run it yourself: the files are off limits to Claude.
4. `iac/scripts/restore-data --at <target>`. The database now holds `api_rw`'s password from before the rotation, and the Secret holds the new one. CNPG must set the new one, and the login check proves it did.
5. `iac/scripts/restore-data`. A full restore from the generation the last step made, which proves a restored generation can itself be restored.
6. `iac/scripts/backup-status` returns OK. Log a meal on the phone.
