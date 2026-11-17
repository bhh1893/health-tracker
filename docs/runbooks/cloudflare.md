# Cloudflare

Everything at Cloudflare the app depends on is Terraform in `iac/cloudflare/`: the tunnel and its routes, the `health` record, Always Use HTTPS, HSTS, Bot Fight Mode, the rate limiting rule and the Sign-up brake rule (ADR 0029). This runbook covers the rest, which stays manual: the account, moving DNS hosting for `nibblejiggle.xyz` from Porkbun to Cloudflare, DNSSEC, the API tokens and "Under Attack" mode, plus how to run Terraform. Do them yourself, in a browser and a dev VM terminal. Claude cannot see tokens or run `plan`, by design (ADR 0015, ADR 0029).

Commands below are one per line with no `#` comments: zsh at a prompt passes `#` and the words after it to the command as arguments.

## Four words first

- **Registrar** (Porkbun): who you rent the name from. It tells the `.xyz` registry which nameservers answer for the name. Porkbun stays the registrar.
- **Nameservers** (Cloudflare): the servers that answer "what is `health.nibblejiggle.xyz`?". Whoever runs them is where you edit records.
- **Records:** the rows those nameservers serve, such as `A` (name to IPv4), `CNAME` (name to another name) and `TXT` (free text, used to prove control).
- **Certificate:** a separate thing from DNS. Let's Encrypt signs one for a name after you prove you control it. With DNS-01, the proof is a `TXT` record at `_acme-challenge.health.nibblejiggle.xyz`, which cert-manager writes through the Cloudflare API. That API is the reason for the move.

How a lookup finds the answer: a resolver (such as `1.1.1.1`) asks the root servers who runs `.xyz`, asks the `.xyz` registry who runs `nibblejiggle.xyz` (the NS records Porkbun set), then asks those nameservers for the record. Changing nameservers changes the middle answer. That answer is cached for its TTL, 3600 s at the `.xyz` registry, so a move takes up to an hour to be seen everywhere.

## Move DNS hosting to Cloudflare

Done on 2026-11-16. Before: nameservers `*.ns.porkbun.com`, DNSSEC off, only Porkbun's parking records. After: nameservers `jamie.ns.cloudflare.com` and `luke.ns.cloudflare.com`, DNSSEC on with DS key tag `2371` (algorithm `13`), and an empty zone. Repeat these steps only to move the zone again.

1. **Check DNSSEC is off.** DNSSEC signs the zone's answers; the registry holds a DS record that says which key signs them. If a DS record still points at the old host's key after the new one starts answering, validating resolvers reject every answer and the name stops resolving. So the DS record must be gone before the nameservers change.

   ```
   dig +noall +comments +answer DS nibblejiggle.xyz @x.nic.xyz
   ```

   `status: NOERROR` with nothing under `ANSWER SECTION` means off; go on. `communications error ... timed out` means no reply arrived, which proves nothing: run it again, or ask `@y.nic.xyz`. If it prints a `DS` line, delete DNSSEC at the registrar, wait until the answer section is empty, then wait one more hour so caches drop it.

2. **Create the Cloudflare account** at `dash.cloudflare.com`, with an authenticator app for two-factor. This account holds the zone, the tunnel and the edge rules, so it guards the whole public path.

3. **Connect the domain.** "Connect a domain" (not "Transfer", which moves the registrar to Cloudflare, nor "Buy"), enter `nibblejiggle.xyz`.
   - "Import DNS records": off.
   - "Additional configuration" (AI search, training and agent policies): leave every crawler on "Allow", "I monetize pages that serve ads" unchecked, and "Bot Preference Sync" off. "Block" is an edge rule outside Terraform (ADR 0029), and crawlers only reach the Sign-in page anyway.
   - Free plan.
   - Add no records, and ignore the warning that the zone has none. `health` comes with the tunnel, from Terraform ([Tunnel config, credential and rebuild](https://github.com/bhh1893/health-tracker/issues/180)); cert-manager writes its own `TXT` records.

4. **Change the nameservers at Porkbun.** Cloudflare shows two nameservers. In Porkbun, open the domain, "Nameservers", replace all of Porkbun's with Cloudflare's two (keeping one would send some lookups to the old host), and save. Leave the rest of the page alone: Porkbun's own DNS records stop being asked, glue records are only for nameservers inside your own domain, and "connect Cloudflare" would only add an account link nothing uses.

5. **Wait for the change to reach each layer.** Each step has its own delay: Porkbun to the registry's database (minutes), the database to the registry's published zone (minutes, in batches), then resolver caches (up to the 3600 s TTL). Cloudflare marks the zone Active once it sees the registry change; "Check nameservers" asks again.

   ```
   curl -s https://rdap.centralnic.com/xyz/domain/nibblejiggle.xyz | jq '.nameservers[].ldhName'
   dig +noall +authority NS nibblejiggle.xyz @x.nic.xyz
   dig +short NS nibblejiggle.xyz @1.1.1.1
   ```

   The first asks the registry's database (RDAP, the structured successor to whois), the second its published zone, the third a resolver. The registry does not hold the zone itself, so it replies with a referral ("ask these servers"): the NS records sit in the authority section, and `+short` would print nothing.

6. **Turn DNSSEC on through Cloudflare.** In the zone: DNS, Settings, "Enable DNSSEC". In Porkbun, open the domain, "DNSSEC", and fill in the DS data only: Key Tag, Algorithm `13`, Digest Type `2` (SHA-256), and the Digest, from Cloudflare. Leave Key Data (Flags, Protocol, Public Key) empty: it is the public key itself, an alternative to its hash, and resolvers fetch it from Cloudflare anyway. Cloudflare holds the signing key; Porkbun only passes the DS record to the registry.

7. **Check the chain of trust.**

   ```
   dig +short DS nibblejiggle.xyz @x.nic.xyz
   delv @1.1.1.1 nibblejiggle.xyz SOA
   ```

   The first prints one line starting `2371 13 2`. The second prints `; fully validated`: root vouches for `.xyz`, `.xyz` vouches for this zone's key, and that key signed the answer. Cloudflare's DNSSEC panel says "Success" once it sees the DS record too.

If the name stops resolving after step 4 or 6, the usual cause is a DS record that does not match the key signing the zone. Delete the DS record at Porkbun first: an unsigned zone resolves, a wrongly signed one does not.

## DNS-01 token for cert-manager

cert-manager uses this token to write and delete the `_acme-challenge` TXT record. It is scoped to one zone and used for nothing else, not Terraform (ADR 0025). Made on 2026-11-16.

1. My Profile, "API Tokens", "Create Token".
2. Name: `cert-manager dns01 nibblejiggle.xyz`.
3. Zone policy: `Include`, the specific zone `nibblejiggle.xyz`, with permissions `DNS Write` and `Zone Read`. The second lets cert-manager look up the zone's ID from its name; it can change nothing.
4. No expiration and no client IP filter: renewals run unattended about every 60 days (certificates last 90; cert-manager renews at two thirds), and an expired token or a changed home IP would make them fail silently. The narrow scope is the control instead.
5. "Continue to summary", check it lists exactly those two permissions on the one zone, "Create Token". Cloudflare shows the token once. On the dev VM:

   ```
   iac/scripts/enter-secret cloudflare-dns01-token
   ```

   Paste at the hidden prompt; nothing shows as you paste. If you lose it before entering it, roll the token in the dashboard and enter the new value.

**Rotate** (only on suspected exposure): "Roll" the token in the dashboard, run `enter-secret` again, then `iac/scripts/apply-secrets`. cert-manager reads the Secret on each use, so nothing needs a restart.

## Terraform token

Terraform uses this token to manage the edge. It is a separate token from the DNS-01 one, and never enters the cluster or CI (ADR 0029).

1. My Profile, "API Tokens", "Create Token", "Create Custom Token".
2. Name: `terraform nibblejiggle.xyz`.
3. Add two permission policies. The dashboard groups permissions by category, and a group lists only the permissions for the scope you picked. Zone permissions do not appear until the policy is scoped to a zone.
   - **Account policy,** Include, your account: `Cloudflare Tunnel: Edit` (the tunnel and its routes).
   - **Zone policy,** Include, specific zone `nibblejiggle.xyz`: `Zone: Read` (looking the zone up by name), `DNS: Edit` (the `health` record), `Zone Settings: Edit` (Always Use HTTPS, HSTS), `Zone WAF: Edit` (both rulesets), `Bot Management: Edit` (Bot Fight Mode). The first three are in "DNS & Zones"; the other two are in a security group.
4. Check the scopes: the summary must name your account and `nibblejiggle.xyz`, or the token can also edit any zone you add later.
5. No client IP filter and no expiration, as for the DNS-01 token. It is used only from the dev VM, a few times a year.
6. "Continue to summary": it must list exactly these 6 permissions on your account and the one zone. "Create Token". On the dev VM:

   ```
   iac/scripts/enter-secret cloudflare-terraform-token
   ```

**Rotate** (on suspected exposure, or after a dev VM rebuild, which loses the file): "Roll" it in the dashboard and run `enter-secret` again. Nothing else uses it.

## Tunnel token

`cloudflared` runs on this token alone, because the tunnel is remotely managed (ADR 0029). Terraform creates the tunnel but never reads the token, so the state holds no secret.

1. Zero Trust, "Networks", "Connectors", the `health-tracker` tunnel, "Add a replica" (or "Install connector"). The install command shown ends with the token, a long string starting `eyJ`. Copy only that string.
2. On the dev VM:

   ```
   iac/scripts/enter-secret cloudflare-tunnel-token
   ```

The dashboard keeps showing it, so after a dev VM rebuild copy it again from there.

## Plan and apply

### Where to run it

Run Terraform only from `~/health-tracker-main`, a checkout that always matches `origin/main`, so you apply only what has been merged. Never run it from `~/health-tracker`: Claude sessions switch branches there, so the `.tf` files can change between your `plan` and your `apply`. A branch made before a change merged would also plan to undo that change.

Create it once, and again after a dev VM rebuild:

```
git -C ~/health-tracker worktree add --detach ~/health-tracker-main origin/main
```

`--detach` puts the checkout on a commit, not a branch, so nothing can be committed there by mistake and refreshing it never needs a merge. Before each session, bring it up to date and go there:

```
git -C ~/health-tracker-main fetch -q origin
git -C ~/health-tracker-main checkout -q --detach origin/main
cd ~/health-tracker-main
```

Every command below starts from there. To change the edge, edit the `.tf` files on a branch in another checkout, merge the PR, then refresh this one and `apply`.

### Running it

`iac/scripts/cloudflare-terraform` reads the token into `CLOUDFLARE_API_TOKEN`, keeps the state at `~/.config/health-tracker/terraform/cloudflare.tfstate` (mode 600) and passes everything else to `terraform`. It refuses to run without a terminal, so Claude cannot run it.

```
iac/scripts/cloudflare-terraform plan
iac/scripts/cloudflare-terraform apply
```

`apply` shows the plan again and asks for `yes`. Read it first: `~` changes in place, `+` creates, `-` destroys, `-/+` replaces. A replace of the tunnel is refused by `prevent_destroy`; if you see that, stop and find out why.

After an apply, `plan` must say "No changes". Run `plan` before each change and now and then: anything it wants to change that you did not edit is drift, usually a dashboard click. Undo it with `apply`, or put the change in the `.tf` files if you meant it.

Check the state holds no secret, after the first apply and after any change to `tunnel.tf`:

```
jq '[.. | objects | select(has("tunnel_secret")) | .tunnel_secret] | all(. == null)' ~/.config/health-tracker/terraform/cloudflare.tfstate
jq '(.resources[].instances[] | select(.private) | .private) |= @base64d | [.. | strings | select(contains("eyJ"))] | length' ~/.config/health-tracker/terraform/cloudflare.tfstate
stat -c '%a %n' ~/.config/health-tracker/terraform/*
```

- The first must print `true`: no tunnel secret is stored.
- The second must print `0`: no string starts a token (`eyJ`, base64 for `{"`). It decodes each resource's `private` field first. That field is the provider's own bookkeeping, stored as base64 JSON, so undecoded it always begins with `eyJ` and a plain `grep` reports it as a token.
- The third must print `600` for each file.

An error such as `Could not open file` is a failed check, not a pass.

## Sign-up brake, level 2

For a traffic flood on the sign-in path, when `users signup close` (level 1, ADR 0026) is not enough. It blocks `/oauth2/start` at Cloudflare, before the tunnel, so existing Users cannot sign in again either while it is on.

```
iac/scripts/cloudflare-terraform apply -var signup_brake_edge=true
```

Check from a browser: `https://health.nibblejiggle.xyz/oauth2/start` shows Cloudflare's block page. Undo:

```
iac/scripts/cloudflare-terraform apply
```

The variable defaults to `false`, so a plain `apply` turns it off, and `plan` afterwards says "No changes". While it is on, a plain `plan` shows the rule as a change: that is the reminder it is still on.

## "Under Attack" mode

The emergency lever for a flood the rules above do not stop (ADR 0027). It is a dashboard click, not Terraform, and must be undone afterwards. It shows every visitor a JavaScript challenge first, which breaks the SPA's API calls for anyone already on a page: they reload once it passes.

On: the zone's Overview, "Under Attack Mode", on. Off: the same switch. Note in your own log when and why.

## Lost state

When the dev VM is rebuilt, the state file is gone but everything at Cloudflare keeps serving. Do not `apply` from an empty state: it would try to create a second tunnel and fail on the existing record and rulesets. Re-adopt the live objects instead (ADR 0029). Make a new Terraform token first (above).

```
cd iac/cloudflare
cp import.tf.example import.tf
../scripts/cloudflare-terraform plan
```

The plan must say "8 to import, 0 to add, 0 to change, 0 to destroy". Then:

```
../scripts/cloudflare-terraform apply
rm import.tf
../scripts/cloudflare-terraform plan
cd ../..
```

The last `plan` must say "No changes". `import.tf.example` looks up each object by name and explains why it uses `import` blocks rather than one `terraform import` per resource.

## Bumping Terraform or the provider

Done by [Patching internet-facing components](https://github.com/bhh1893/health-tracker/issues/178). Terraform: change the version and sha256 in the `dev_workstation` role defaults and the `terraform` job in `.github/workflows/ci.yml` (same values), plus `required_version` in `iac/cloudflare/versions.tf`; take the sha256 from HashiCorp's `SHA256SUMS` after checking its signature. Provider: change the version in `versions.tf`, then

```
terraform -chdir=iac/cloudflare init -backend=false -upgrade
```

which rewrites `.terraform.lock.hcl`; commit both. Then `plan` before merging: a new provider can read the same objects differently.
