# Google OAuth client

The Google Cloud steps for sign-in (ADR 0021, ADR 0015): a project, the consent screen, and the OAuth client whose secret the oauth2-proxy sidecars use. Google has no API or Terraform resource for a regular web OAuth client, so this is by hand, in a browser and a dev VM terminal. Claude cannot see the client secret, by design.

Commands below are one per line with no `#` comments: zsh at a prompt passes `#` and the words after it to the command as arguments.

## Three words first

- **OAuth client:** the app's registration with Google. It says which app is asking ("health-tracker"), where Google may send the browser back, and which scopes it may request.
- **Client ID:** the client's public name. It sits in the browser's address bar on every sign-in, so it is not secret and lives in git (`k8s/components/auth-proxy/`).
- **Client secret:** the client's password. oauth2-proxy sends it, server to server, when it swaps the one-time code from the callback for tokens. With the ID and the secret, anyone can pose as this app to Google. It cannot sign anyone in by itself: Google still sends the code only to the registered redirect URI.

## Create the client

1. **Project.** In `console.cloud.google.com`, the project `health-tracker` (no organization). It already exists; create it only on a new Google account. Everything below is inside it.

2. **Consent screen.** Open "Google Auth Platform" and "Get started".
   - App name `health-tracker`, your email as user support and developer contact.
   - Audience: **External**. Internal means "only my Workspace organization", which a personal account does not have.
   - No logo. A logo makes Google ask for brand verification.

3. **Publish it, when Sign-up opens.** Until then the status stays **Testing**, with your own account under "Audience", "Test users". Testing allows only that list to sign in, and does nothing else to this app: Google's 7-day limit on Testing sign-ins does not cover apps that ask only for `openid email profile`. Before the first person outside the list signs in (ADR 0026), go to "Branding", set the app name `health-tracker` (people see it on Google's sign-in screen) and your email as user support and developer contact, and leave the logo, links and authorized domains empty. Then "Audience", "Publish app", until the status reads **In production**. Publishing needs no Google review, because the app asks only for non-sensitive scopes; a logo would make Google ask for brand verification.

   Testing mode is not the gate: it repeats Approval in `api` as a hand-kept list (ADR 0021).

4. **Scopes.** "Data Access", "Add or remove scopes": tick `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`, nothing else, and save. These are the names behind oauth2-proxy's `openid email profile`.

5. **Client.** "Clients", "Create client".
   - Application type: **Web application**. Name: `health-tracker oauth2-proxy`.
   - Authorized JavaScript origins: **none**. Origins are for browser code that talks to Google itself; here only the proxy does, from the server.
   - Authorized redirect URIs: exactly one, `https://health.nibblejiggle.xyz/oauth2/callback`. Google matches it character for character, so no trailing slash.
   - "Create".

6. **Save the secret.** Google shows the client secret once, in the dialog that follows (verified at build, see below). Copy it and, on the dev VM:

   ```
   iac/scripts/enter-secret google-client-secret
   ```

   Paste at the hidden prompt; nothing shows as you paste. If you lose it before entering it, add a new secret to the client (see Rotate) and delete the one you lost.

7. **Record the client ID.** It is public and goes into `k8s/components/auth-proxy/`. Made 2026-11-17: `664110649375-7893ue4hdvmmn7odfks4gh4i58tfladn.apps.googleusercontent.com`.

8. **Generate the cookie secret and apply both.**

   ```
   ansible-playbook iac/ansible/dev.yml -e dotfiles_repo=git@github.com:bhh1893/dotfiles.git
   iac/scripts/apply-secrets
   kubectl -n health-tracker describe secret auth-proxy
   ```

   `dev.yml` writes `auth-cookie-secret` only if it is missing. `describe` lists the keys `client-secret` and `cookie-secret` with their sizes, never their values; `cookie-secret` is 44 bytes.

## Rotate

Only on suspected exposure, including any `gitleaks` failure. Both values are read as env vars when the sidecar starts, so each rotation ends with a restart.

**Client secret** (no one is signed out):

1. On the client's page, "Add secret". The old one stays enabled, so running pods keep working.
2. Copy the new secret, then `iac/scripts/enter-secret google-client-secret` and `iac/scripts/apply-secrets`.
3. `kubectl -n health-tracker rollout restart deployment/api deployment/web`, then wait until `kubectl -n health-tracker rollout status deployment/api` and the same for `deployment/web` report success.
4. Disable the old secret in the console, then delete it. Disabling first gives you an undo while you check sign-in still works.

**Cookie secret** (signs every User out, because oauth2-proxy accepts only one):

```
rm ~/.config/health-tracker/auth-cookie-secret
ansible-playbook iac/ansible/dev.yml -e dotfiles_repo=git@github.com:bhh1893/dotfiles.git
iac/scripts/apply-secrets
kubectl -n health-tracker rollout restart deployment/api deployment/web
```

While the rollout runs, a request may get `401` from a pod still holding the old secret. Everyone signs in again once.

**Lost dev VM:** the client secret has no second copy. Add a new secret in the console (step 1 above), enter it, and delete the old one. `dev.yml` generates a new cookie secret, so every User signs in again.

## Verify at build

Checked once while building the client, for ADR 0015:

- [x] A Google web client can hold two enabled secrets at once. Checked 2026-11-17.
- [x] Google shows a new client secret only once: after closing the dialog, the client page shows it masked, with no way to reveal it. Checked 2026-11-17.
- [x] oauth2-proxy v7.12.0 starts with a cookie secret in `dev.yml`'s format (44 characters, decoding to 32 bytes) and rejects `openssl rand -hex 32` with `cookie_secret must be 16, 24, or 32 bytes ... but is 64 bytes`. Checked 2026-11-16 with a throwaway value.
