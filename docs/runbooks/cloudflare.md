# Cloudflare

The Cloudflare steps that cannot be Terraform (ADR 0025, ADR 0029): the account, moving DNS hosting for `nibblejiggle.xyz` from Porkbun to Cloudflare, DNSSEC, and the API tokens. Do them yourself, in a browser and a dev VM terminal. Claude cannot see tokens, by design (ADR 0015).

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
