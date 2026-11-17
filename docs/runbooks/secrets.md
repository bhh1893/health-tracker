# Secrets

Every secret value lives in `~/.config/health-tracker/` on the dev VM, and `iac/scripts/apply-secrets` copies them into the cluster (ADR 0015). Git holds names, never values. Run commands on the VM unless a step says Windows.

| File | Made by | Kubernetes Secret | Namespace | Used by |
| --- | --- | --- | --- | --- |
| `api-token` | `dev.yml` | `api-token` (key `token`) | `health-tracker` | nginx sidecar |
| `db-owner.env` | `dev.yml` | `db-owner` | `health-tracker` | Migration Job, CNPG role `app` |
| `db-api.env` | `dev.yml` | `db-api` | `health-tracker` | `api`, CNPG role `api_rw` |
| `backup.env` | `dev.yml` | `backup-key` | `health-tracker` | CNPG Barman Cloud plugin |
| `argocd-deploy-key` | `dev.yml` | `repo-health-tracker` | `argocd` | Argo CD |
| `cloudflare-dns01-token` | Cloudflare dashboard, then `enter-secret` (`cloudflare.md`) | `cloudflare-dns01-token` (key `api-token`) | `cert-manager` | Let's Encrypt ClusterIssuers (DNS-01) |
| `cloudflare-tunnel-token` | Cloudflare dashboard, then `enter-secret` (`cloudflare.md`) | `cloudflared` (key `token`) | `edge` | `cloudflared`, as `TUNNEL_TOKEN` (ADR 0029) |
| `google-client-secret` | Google Cloud console, then `enter-secret` (`google-oauth.md`) | `auth-proxy` (key `client-secret`) | `health-tracker` | oauth2-proxy sidecars in `api` and `web` |
| `auth-cookie-secret` | `dev.yml` | `auth-proxy` (key `cookie-secret`) | `health-tracker` | oauth2-proxy sidecars in `api` and `web` |
| `health-tls.json` (optional) | cert-manager, then `save-tls` | `health-tls` | `edge` | Gateway `https` listener |
| `cloudflare-terraform-token` | Cloudflare dashboard, then `enter-secret` (`cloudflare.md`) | none: `CLOUDFLARE_API_TOKEN` at apply time | - | Terraform, through `cloudflare-terraform` (ADR 0029) |

A value made by hand in a web console goes in with `iac/scripts/enter-secret <file>`, run yourself in a terminal: it reads the value at a hidden prompt, so it never reaches the screen, shell history, `ps` or Claude. `apply-secrets` stops if any file above is missing, except `health-tls.json` and `cloudflare-terraform-token`, which it does not use.

`terraform/cloudflare.tfstate` sits here too, for the guardrail below and mode 600, though it holds no secret (ADR 0029).

## Gateway certificate

cert-manager issues the Gateway's certificate itself (ADR 0025). The copy on the dev VM exists only so a rebuild restores it instead of asking Let's Encrypt again, which allows 5 certificates per name per 7 days. `apply-secrets` creates the Secret only if it is missing; it never replaces a live one, because after a renewal the cluster's copy is the newer one.

Nothing alerts if a renewal fails; that is v2 observability work ("Out of scope" on [Health Tracker v1](https://github.com/bhh1893/health-tracker/issues/2)). Until then, check by hand after each renewal date (below) that `kubectl -n edge get certificate health-tls` shows `READY True` with a later `notAfter`; otherwise a failed renewal shows up only as the certificate expiring 30 days later.

Save it after the first issuance and after each renewal (about every 60 days; `kubectl -n edge get certificate health-tls -o jsonpath='{.status.renewalTime}'` says when). Run it yourself: it reads the private key.

```
iac/scripts/save-tls
```

It prints the certificate's subject, issuer and end date. A stale copy is not dangerous: after a rebuild, cert-manager sees it is past its renewal time (or expired) and issues a new one, which costs one certificate from the weekly limit and, if expired, a couple of minutes of `:443` refusing handshakes.

Two credentials are the exception: they live only in GitHub Actions secrets and have no file here.

| GitHub Actions secret | What it is | Used by | Set up in |
| --- | --- | --- | --- |
| `TAG_BUMP_DEPLOY_KEY` | Deploy key with write access (ADR 0018) | `bump-tags` job | "CI tag bump key" below |
| `TS_OAUTH_ID`, `TS_OAUTH_SECRET`, `TS_TAILNET` | Tailscale OAuth client with the `policy_file` scope, and the tailnet's name (ADR 0020) | `tailnet-policy-test`, `tailnet-policy-apply` jobs | `docs/runbooks/tailnet.md` |

## First install

1. Generate the values. A file that already exists is left alone.

   ```
   cd ~/health-tracker
   ansible-playbook iac/ansible/dev.yml -e dotfiles_repo=git@github.com:bhh1893/dotfiles.git
   ```

2. Enter the values made in a web console: the DNS-01 token and the tunnel token (`cloudflare.md`), and the Google client secret (`google-oauth.md`). `apply-secrets` stops until all three exist.

3. Register the deploy key on GitHub, from a Windows terminal. Read-only is the default; never add `--allow-write` to this key. The key is tied to your `gh` login, so de-authorizing `gh` removes it.

   ```
   cd ~
   scp dev:.config/health-tracker/argocd-deploy-key.pub argocd-deploy-key.pub
   gh repo deploy-key add argocd-deploy-key.pub --repo bhh1893/health-tracker --title "health-tracker argocd"
   rm argocd-deploy-key.pub
   ```

4. Copy the values into the cluster.

   ```
   iac/scripts/apply-secrets
   ```

   A second run prints `unchanged` for every Secret.

5. Put the token on the phone. Run this yourself in a terminal: it refuses to print anywhere else.

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
- **`cloudflare-dns01-token`:** not generated, so skip the `dev.yml` step: roll the token in Cloudflare and enter it again (`cloudflare.md`, "Rotate"), then `apply-secrets`. Nothing to restart.
- **`cloudflare-tunnel-token`:** not generated, so skip the `dev.yml` step. Also check the tunnel's connectors monthly (ADR 0030): exactly two, both from the home IP. Steps below.
- **`auth-cookie-secret`:** `kubectl -n health-tracker rollout restart deployment/api deployment/web`. Every User is signed out and signs in again (`google-oauth.md`, "Rotate").
- **`google-client-secret`:** not generated, so skip the `dev.yml` step: add a second secret to the client, enter it, apply, restart, then delete the old one (`google-oauth.md`, "Rotate"). No one is signed out.
- **`backup.env`:** this file is a copy of the key held by Garage, so delete the key too, before the steps above: `sudo garage key delete --yes cnpg-backup`. Then confirm backups still work with `backup-status`.
- **`TS_OAUTH_SECRET`:** revoke the OAuth client in the Tailscale admin console and create a new one (`docs/runbooks/tailnet.md`, "CI credential"). Nothing to restart.
- **`argocd-deploy-key`:** delete `argocd-deploy-key.pub` as well. Register the new key as in first install step 2, then delete the old one from Windows with `gh repo deploy-key list` and `gh repo deploy-key delete <id>`.

### Tunnel token

Anyone holding this token can run their own connector, and Cloudflare sends them a share of real requests, session cookies included (ADR 0030). Rotating gives the tunnel a new secret, but connectors already running keep their connections until they restart, so the last step cuts them off.

1. Zero Trust, "Networks", "Connectors", the `health-tracker` tunnel, "Rotate token" (or "Refresh token"). Copy the new token from the install command, as in `cloudflare.md`, "Tunnel token".
2. Enter it, apply it and restart `cloudflared` on it:

   ```
   iac/scripts/enter-secret cloudflare-tunnel-token
   iac/scripts/apply-secrets
   kubectl -n edge rollout restart deployment/cloudflared
   kubectl -n edge rollout status deployment/cloudflared
   ```

   The rollout replaces one pod at a time, so the tunnel stays up.
3. Drop every connection to the tunnel. This also drops the two new ones for a moment; they reconnect on the new token within seconds, and a connector still on the old one cannot. Uses the Terraform token, which has `Cloudflare Tunnel: Edit`; `printf` is a shell builtin, so the token never appears in `ps`.

   ```
   account_id=$(iac/scripts/cloudflare-terraform output -raw account_id)
   tunnel_id=$(iac/scripts/cloudflare-terraform output -raw tunnel_id)
   curl -sS -X DELETE \
     -H @<(printf 'Authorization: Bearer %s' "$(<~/.config/health-tracker/cloudflare-terraform-token)") \
     "https://api.cloudflare.com/client/v4/accounts/$account_id/cfd_tunnel/$tunnel_id/connections"
   ```

   `"success": true` means done.
4. Check: the connectors list shows exactly two, both from the home IP, and `https://health.nibblejiggle.xyz/` loads.

## Claude guardrail

`.claude/settings.json` denies, for any session started in this repo:

- `Read(~/.config/health-tracker/**)`: the file tools, plus shell commands Claude Code recognizes as reads, such as `cat`.
- `Bash(*.config/health-tracker*)`: any other command that names the directory, such as `grep` or `python`.
- `Bash(kubectl *get*secret*)`: reading Secrets, including with flags before `get` and in lists such as `pods,secrets`.

This stops accidents, not a determined process: Claude runs as the same Linux user, and a script that builds the path itself gets past all three (ADR 0015). `show-token` is covered separately by refusing to run without a terminal. Anything that reads a value, including `argocd-initial-admin-secret`, is yours to run by hand.
