# Tailnet

The tailnet's access rules live in `iac/tailscale/policy.hujson`. CI tests the file on a pull request (`tailnet-policy-test`) and applies it on merge to `main` (`tailnet-policy-apply`) (ADR 0020). The admin console is at `https://login.tailscale.com/admin`. Menu names below are as of November 2026.

| Task | Where | Section |
| --- | --- | --- |
| Create or rotate the CI credential | Admin console, then `gh secret set` | "CI credential" |
| Change who can reach what | A pull request that edits `policy.hujson` | "Change the policy" |
| Let a new person in | Admin console | "Invite a person" |
| Remove a person | Admin console, then the app | "Remove a person" |

## First setup

Do these once, in this order. The order matters: the policy must be applied before the console is locked, and both before anything in the cluster joins the tailnet.

1. Create the CI credential (next section).
2. Merge the pull request that adds `policy.hujson`. Its `tailnet-policy-test` job must be green first; after the merge, `tailnet-policy-apply` must be green too.
3. In the admin console, open **Access controls** and confirm the policy shown is the file from the repo.
4. Lock the console editor: **Settings > Policy file management**, select **Prevent edits in the admin console**, and set **External reference** to `https://github.com/bhh1893/health-tracker/blob/main/iac/tailscale/policy.hujson`. Access controls now shows the repo as the source. "Edit anyway" still exists for an emergency, but the next apply overwrites whatever was typed there.
5. Turn on device approval: **Settings > Device management > Device approval**. This is a tailnet setting, not part of the policy file, so it is not in git. From now on a new device waits on the **Machines** page until you approve it.

## CI credential

A Tailscale OAuth client with the `policy_file` scope. It can read and replace the policy; the scope also brings read access to the device list and write access to device posture attributes, which Tailscale requires with it. It cannot add devices or create keys. Run this yourself, not through Claude.

1. Admin console: **Settings > Trust credentials** (`https://login.tailscale.com/admin/settings/trust-credentials`). Select **Credential**, then **OAuth**. Select **Write** on the policy file scope and accept the device scopes it depends on; leave everything else off. Select **Generate credential**.
2. The **Credential created** page shows the client ID and the secret, and the secret cannot be shown again after **Done**. From a Windows terminal, paste each value when prompted:

   ```
   gh secret set TS_OAUTH_ID --repo bhh1893/health-tracker
   gh secret set TS_OAUTH_SECRET --repo bhh1893/health-tracker
   gh secret set TS_TAILNET --repo bhh1893/health-tracker
   ```

   `TS_TAILNET` is the tailnet's name, shown under **Settings > General** as "Tailnet ID". It is a secret only because on a personal account it can be an email address, and the repo's logs are public.

There is no copy on the dev VM, so there is nothing to back up. To rotate: revoke the client on the same page, then repeat both steps. Rotate on suspicion only.

## Change the policy

Edit `iac/tailscale/policy.hujson` in a pull request. `tailnet-policy-test` sends the file to Tailscale, which checks the syntax and runs the `tests` block without changing anything. Merge applies it within a minute or two.

To undo a change, revert the pull request. Do not fix it in the console.

A pull request from a fork gets no secrets, so the test job fails there. That is intended: only the owner changes the policy.

## Invite a person

The free plan allows 6 users including the owner (ADR 0020).

1. Admin console: **Users** page, then the invite button. Send the link.
2. They install Tailscale on their phone and sign in through the link.
3. Their device appears on the **Machines** page as waiting. Check it is theirs, then approve it.
4. They open `https://health.nibblejiggle.xyz` and sign up. They are still Pending in the app until approved there (ADR 0022): being on the tailnet only lets them reach the sign-in page.

The policy needs no change. The person lands in `autogroup:member`, which may reach `svc:health` on ports 443 and 80 and nothing else.

## Remove a person

Two independent steps; do both (ADR 0020).

1. Admin console: **Users**, then remove the user. Their devices leave the tailnet with them.
2. Demote their Role in the app (ADR 0022).
