---
status: accepted
---

# Meal Photos are copied hourly to the Windows host and put back after Postgres on restore

The Windows host pulls the `meal-photos` bucket into a local folder every hour with `rclone sync`, through a read-only Garage key. Photos it would delete are kept for 8 days. On any restore, Postgres decides which photos exist: Postgres is restored first, then missing bytes are copied back from the host, then rows whose bytes exist nowhere are deleted, and only then does the orphan sweep resume. Decided in [Backing up and restoring Meal Photos](https://github.com/bhh1893/health-tracker/issues/301), on the map [Health Tracker v1: Meal Photos](https://github.com/bhh1893/health-tracker/issues/292). Builds on ADR 0011, ADR 0036 and ADR 0038.

## Shape

- **Postgres is the source of truth.** After a restore, the set of photos is the set of `meal_photos` rows. Garage holds bytes and has no restore point of its own to pair with Postgres. A point-in-time restore therefore means "the photos whose rows existed at that time": photos added later become orphans and the sweep removes them, and photos deleted later get their bytes back from the copy.
- **The copy:** a PowerShell script in the repo registers a Windows Task Scheduler task that runs `rclone sync` from `meal-photos` (S3 at `192.168.56.20:3900`, over the host-only network) into `%LOCALAPPDATA%\health-tracker\meal-photos\current\`. The folder is outside OneDrive, so other Users' photos never land in a personal cloud account. `rclone` is pinned like Garage.
- **Credential:** a new Garage key, `photo-backup`, with read only on `meal-photos`. `dev.yml` generates it, as it does the other keys. Read only means a sync run with source and destination swapped fails instead of emptying the bucket.
- **Schedule:** hourly, with "run as soon as possible after a scheduled start is missed", so it catches up after the PC was off. Each run only compares file lists. The photo loss window while the host runs is about an hour. Meals lose about a minute (ADR 0011).
- **Deleted photos kept 8 days:** `--backup-dir` moves every file the sync would delete into `deleted\<UTC hour>\`, and the same job removes folders older than 8 days. That covers ADR 0011's 7-day point-in-time window plus a day. A photo uploaded and deleted between two runs is never copied.
- **Freshness:** on success the job runs `ssh dev touch ~/.local/state/health-tracker/photo-copy-ok`. `backup-status` fails if that file is missing or older than 36 hours, the same threshold as base backups, so the weekly check stays one command.
- **Sweep brake:** `restore-data` suspends the orphan sweep CronJob together with `api`, and resumes it only after the photo step and its checks pass. Separately, a sweep run that would delete more than 100 objects deletes none and exits non-zero. Either guard alone stops an empty or wrong database from erasing every photo within the hour.
- **`restore-photos.ps1` (host, after `restore-data`):**
  1. `rclone copy --ignore-existing` from `current\` and then every `deleted\*` folder, newest first, into Garage. It only adds missing objects. It uses `api`'s key, read over `ssh dev`, so `photo-backup` stays read only.
  2. Over `ssh dev`, find rows whose object is still missing, delete them, and print each Meal ID and photo ID removed. A row whose bytes exist nowhere counts against the 10-photo cap and can never load, so keeping it buys nothing.
  3. Resume the sweep. Objects copied back without a row become orphans and are swept within about two hours.

  It is idempotent. `rebuild-cluster.ps1` always runs it after `restore-data`, so every rebuild exercises it.
- **Losing the dev VM:** after `vagrant up dev` and `dev.yml`, Garage is empty and every key is new. The runbook order is `apply-secrets`, then `restore-photos.ps1`, then the sweep. The brake covers a skipped step.
- **Drill (acceptance for the build ticket):** (a) add photo A, note the time, delete A, add photo B, wait for a copy, `restore-data --at` that time, `restore-photos.ps1`: A shows, B goes on a manual sweep run, nothing is reported as dangling. (b) Delete every object in `meal-photos`, run `restore-photos.ps1`: every row has its bytes.

## Considered Options

- **A systemd timer on the dev VM writing to a host folder.** It would live in Ansible like the rest of the stack. Rejected: the dev VM has synced folders disabled, so it has nowhere off itself to write. Pushing to the host would need an SSH server on Windows.
- **Daily, matching the base backup.** Rejected: an hourly run costs seconds, and daily would widen photo loss from about an hour to about a day.
- **Plain `sync` with no kept deletes.** Rejected: a point-in-time restore to yesterday would bring back rows for photos deleted today with their bytes gone everywhere.
- **Keep dangling rows and show a placeholder.** Rejected: nothing could ever fill them, and they would hold slots under the cap.
- **A read-write `photo-backup` key used for both copy and restore.** Rejected: the unattended job is where a swapped-argument mistake would happen, so it gets the narrowest key, and the rare manual restore borrows `api`'s.
- **A OneDrive-synced folder.** It would put the copy off the PC for free. Rejected: other Users' private photos would move into the owner's personal cloud account.
- **Restoring Garage to a point in time.** Rejected: Garage has no object versioning to restore from, and with Postgres as the single source of truth, a restore only has to reconcile in one direction.

## Consequences

- **Amends ADR 0011:** `restore-data` suspends and resumes the sweep, `rebuild-cluster.ps1` gains a photo step, `backup-status` checks the photo copy, and the drill grows two cases.
- **Amends ADR 0036:** the recovery promise is now concrete: about an hour, while the host's task runs.
- **Amends ADR 0038:** the sweep gets a 100-object brake.
- `docs/runbooks/dev-vm.md`'s warning becomes "loses photos since the last hourly copy" and lists the rebuild order. `docs/runbooks/backup-restore.md` covers `restore-photos.ps1`.
- The copy shares the PC's disk, like the DB backups. It survives losing the dev VM, not losing the PC. A v2 cloud bucket fixes both.
- The host folder holds every User's photos unencrypted on the owner's PC, and its size is bounded by the bucket quota plus 8 days of deletes. Both are inputs to [Meal Photo limits, quotas and threat model](https://github.com/bhh1893/health-tracker/issues/300).
- The scheduled task lives on the host, outside Vagrant and Ansible. A repo script registers it, so a new PC can recreate it.
- The DB backups in the `backups` bucket still have no copy off the dev VM. That is outside this ADR.
