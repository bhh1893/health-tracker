# Rebuild the dev VM

Destroys the dev VM and recreates it from git (ADR 0009). Steps 1 and 2 run on Windows, in PowerShell or Git Bash. Steps 3 to 6 run on the VM. Run commands one line at a time.

## Before you start

> **Warning: `vagrant destroy` permanently deletes data that exists nowhere else.**
>
> - **MinIO database backups** run on this VM, so the bucket is lost (ADR 0011). Step 6 takes a new base backup.
> - **Generated secrets** in `~/.config/health-tracker/` are lost and replaced by new values (ADR 0015).
> - **Unpushed commits** are lost. On the VM, run `git status` and `git log --branches --not --remotes` in every checkout, and push anything you need.

## 1. Recreate the machine (Windows)

From the repo root:

```
ssh-keygen -R 192.168.56.20
cd iac/vagrant/dev
vagrant destroy -f
vagrant up
```

## 2. Register the VM's GitHub key (Windows)

The VM generated its own key during `vagrant up`, separate from your Windows keys, so it can be revoked alone. GitHub must learn it. List your keys:

```
gh ssh-key list
```

A warning about the `admin:ssh_signing_key` scope is harmless: this runbook does not use signing keys.

If a key titled `health-tracker dev VM` is listed, it belonged to the old VM. Delete it, using the ID from the list:

```
gh ssh-key delete <id> --yes
```

Add the new key:

```
ssh dev cat ~/.ssh/id_ed25519.pub | gh ssh-key add - --title "health-tracker dev VM"
```

## 3. Clone the repo (VM)

Connect to the VM, and stay on it for the rest of this runbook:

```
ssh dev
```

Your prompt must now read `vagrant@dev`. If it does not, you are still on Windows and the clone would land in the wrong place.

```
git clone git@github.com:bhh1893/health-tracker.git
cd health-tracker
```

On first contact, SSH shows GitHub's host key fingerprint. Check it against [GitHub's published fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints) before answering `yes`.

## 4. Run the playbook (VM)

```
ansible-playbook iac/ansible/dev.yml -e dotfiles_repo=git@github.com:bhh1893/dotfiles.git
```

Omit `-e dotfiles_repo=...` to skip personal setup. The recap must show `failed=0`. Two `[WARNING]` lines about the inventory and implicit localhost are expected: this playbook only targets the machine it runs on.

Log out and back in, so the `docker` group and `~/.local/bin` on your `PATH` take effect:

```
exit
ssh dev
```

## 5. Log in and set your git identity (VM)

The SSH key from step 2 covers `git`. The `gh` CLI needs its own login, because it talks to the GitHub API:

```
gh auth login
```

| Prompt | Answer |
| --- | --- |
| Where do you use GitHub? | GitHub.com |
| Preferred protocol for Git operations? | SSH |
| Upload your SSH public key? | Skip (step 2 already registered it) |
| How would you like to authenticate? | Login with a web browser |

The VM has no browser, so `gh` prints a one-time code and a URL. Open the URL on Windows and enter the code.

Log in to Claude:

```
claude
```

Set the identity for your commits. Use the values that `git config --global user.name` and `git config --global user.email` print on Windows:

```
git config --global user.name "<name>"
git config --global user.email "<email>"
```

## 6. Restore cluster access (VM, only if the cluster is running)

Skip this step if the cluster does not exist yet.

1. Run `apply-secrets` (ADR 0015).
2. Restart the pods.
3. Re-paste the token on the phone.
4. Take a base backup straight away, because the bucket is now empty.

## Check it worked

```
cd ~/health-tracker
ansible-playbook iac/ansible/dev.yml -e dotfiles_repo=git@github.com:bhh1893/dotfiles.git
docker run --rm hello-world
gh auth status
git config user.email
```

The playbook recap must show `changed=0`, Docker must print its hello message without `sudo`, `gh` must show you logged in, and git must print your email.
