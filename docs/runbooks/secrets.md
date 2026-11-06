# Secrets

Every secret value lives in `~/.config/health-tracker/` on the dev VM, and `iac/scripts/apply-secrets` copies them into the cluster (ADR 0015). Git holds names, never values. Run commands on the VM unless a step says Windows.

| File | Kubernetes Secret | Namespace | Used by |
| --- | --- | --- | --- |
| `api-token` | `api-token` (key `token`) | `health-tracker` | nginx sidecar |
| `db-owner.env` | `db-owner` | `health-tracker` | Migration Job, CNPG role `app` |
| `db-api.env` | `db-api` | `health-tracker` | `api`, CNPG role `api_rw` |
| `backup.env` | `backup-key` | `health-tracker` | CNPG Barman Cloud plugin |
| `argocd-deploy-key` | `repo-health-tracker` | `argocd` | Argo CD |

`TAG_BUMP_DEPLOY_KEY` is the exception: it lives only in GitHub Actions secrets and has no file here (ADR 0018).

## First install

1. Generate the values. A file that already exists is left alone.

   ```
   cd ~/health-tracker
   ansible-playbook iac/ansible/dev.yml -e dotfiles_repo=git@github.com:bhh1893/dotfiles.git
   ```

2. Register the deploy key on GitHub, from a Windows terminal. Read-only is the default; never add `--allow-write` to this key. The key is tied to your `gh` login, so de-authorizing `gh` removes it.

   ```
   cd ~
   scp dev:.config/health-tracker/argocd-deploy-key.pub argocd-deploy-key.pub
   gh repo deploy-key add argocd-deploy-key.pub --repo bhh1893/health-tracker --title "health-tracker argocd"
   rm argocd-deploy-key.pub
   ```

3. Copy the values into the cluster.

   ```
   iac/scripts/apply-secrets
   ```

   A second run prints `unchanged` for every Secret.

4. Put the token on the phone. Run this yourself in a terminal: it refuses to print anywhere else.

   ```
   iac/scripts/show-token
   ```

   Scan the QR code, copy the text, and paste it into the app's "enter secret" screen.

## CI tag bump key

The one deploy key with write access: CI uses it to commit image tags to `main` past the PR rule (ADR 0018). Run this yourself, not through Claude. The private key goes straight into GitHub and is then deleted, so there is nothing to back up. To rotate, delete the old key on GitHub and repeat these steps.

```
ssh-keygen -q -t ed25519 -N '' -C 'health-tracker tag bump' -f ~/tag-bump-key
gh repo deploy-key add ~/tag-bump-key.pub --repo bhh1893/health-tracker --allow-write --title "health-tracker tag bump"
gh secret set TAG_BUMP_DEPLOY_KEY --repo bhh1893/health-tracker < ~/tag-bump-key
rm ~/tag-bump-key ~/tag-bump-key.pub
```

## Rotate a secret

Rotate only on suspected exposure, including any `gitleaks` failure: the repo is public (ADR 0017), so deleting a commit does not take a leaked value back. Each rotation is the same shape: replace the value, run `apply-secrets`, restart whatever read the old one, because env vars and nginx's file read do not update a running process.

Delete the file, then regenerate and apply:

```
rm ~/.config/health-tracker/<file>
ansible-playbook iac/ansible/dev.yml -e dotfiles_repo=git@github.com:bhh1893/dotfiles.git
iac/scripts/apply-secrets
```

Then finish for the secret you rotated:

- **`api-token`:** `kubectl -n health-tracker rollout restart deployment/api`, then `show-token` and re-paste on the phone.
- **`db-api.env`:** `kubectl -n health-tracker rollout restart deployment/api`. CNPG changes the role's password by itself, through the `cnpg.io/reload` label. `api` fails to connect until the restart finishes.
- **`db-owner.env`:** nothing to restart; the next migration Job reads the new value.
- **`backup.env`:** this file is a copy of the key held by Garage, so delete the key too, before the steps above: `sudo garage key delete --yes cnpg-backup`. Then confirm backups still work with `backup-status`.
- **`argocd-deploy-key`:** delete `argocd-deploy-key.pub` as well. Register the new key as in first install step 2, then delete the old one from Windows with `gh repo deploy-key list` and `gh repo deploy-key delete <id>`.

## Claude guardrail

`.claude/settings.json` denies, for any session started in this repo:

- `Read(~/.config/health-tracker/**)`: the file tools, plus shell commands Claude Code recognizes as reads, such as `cat`.
- `Bash(*.config/health-tracker*)`: any other command that names the directory, such as `grep` or `python`.
- `Bash(kubectl *get*secret*)`: reading Secrets, including with flags before `get` and in lists such as `pods,secrets`.

This stops accidents, not a determined process: Claude runs as the same Linux user, and a script that builds the path itself gets past all three (ADR 0015). `show-token` is covered separately by refusing to run without a terminal. Anything that reads a value, including `argocd-initial-admin-secret`, is yours to run by hand.
