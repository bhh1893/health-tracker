# Sign-up brake

Two levels for stopping new Sign-ups, in the order to reach for them (ADR 0026). Level 1 stops new Users inside the app and touches nobody else. Level 2 stops sign-in traffic at Cloudflare, before it reaches home, but it also locks out existing Users who need to sign in again. Run everything on the dev VM from the repo root.

Commands below are one per line with no `#` comments: zsh at a prompt passes `#` and the words after it to the command as arguments.

## Which level

- **Pending rows piling up** in `users list` from people you did not invite: level 1.
- **Load on the home connection** (the tunnel or `api` straining, many requests to `/oauth2/`), and level 1 is already on: add level 2. Level 1 runs only after Google sign-in, so it cannot stop the traffic itself.

## Level 1: close Sign-up in the database

```
iac/scripts/users signup close
```

It prints the brake before and after and asks `y/N`. The setting is a row in Postgres, so it takes effect on the next request: no deploy, and Argo CD cannot undo it.

While it is closed, a Google account the app has never seen gets "Sign-up is closed" (`403`, `urn:health-tracker:problem:signup-closed`) and no User row is written. Known Users, Pending ones included, are unaffected: they never read the brake.

**Check:**

```
iac/scripts/users signup status
```

Expect `Sign-up closed since <now>`. `users list` prints the same line above the Users. To check from outside, sign in with a Google account that has never used the app (a private window): it gets the closed message, and `users list` shows no new row.

**Undo:**

```
iac/scripts/users signup open
```

Expect `Sign-up open since <now>` from `signup status`. Anyone turned away while it was closed is still signed in at the proxy: a reload makes them a Pending User.

The state survives a rebuild: `restore-data` brings back the database as backed up, so a brake closed during an incident stays closed. Check `signup status` after any restore.

## Level 2: block sign-in at Cloudflare

Exact steps, check and undo are in `docs/runbooks/cloudflare.md`, section "Sign-up brake, level 2": `apply -var signup_brake_edge=true` through `iac/scripts/cloudflare-terraform`, which you run yourself. It blocks `/oauth2/start`, so nobody can start a new sign-in, existing Users included; anyone whose session is still valid keeps using the app.

Undo level 2 as soon as the flood stops, and leave level 1 closed until you have looked at `users list`.
