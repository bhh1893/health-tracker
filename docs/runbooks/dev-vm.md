# Rebuild the dev VM

Destroys the dev VM and recreates it from git (ADR 0009). The commands work in PowerShell and Git Bash on Windows; run them one line at a time.

## Before you start

> **Warning: `vagrant destroy` permanently deletes data that exists nowhere else.**
>
> - **MinIO database backups** run on this VM, so the bucket is lost (ADR 0011). Step 6 takes a new base backup.
> - **Generated secrets** in `~/.config/health-tracker/` are lost and replaced by new values (ADR 0015).
> - **Unpushed commits** are lost. On the VM, run `git status` and `git log --branches --not --remotes` in every checkout, and push anything you need.

## 1. Recreate the machine

On Windows, from the repo root:

```
ssh-keygen -R 192.168.56.20
cd iac/vagrant/dev
vagrant destroy -f
vagrant up
```

## 2. Register the VM's GitHub key

The VM generated a new key, so GitHub must learn it. On Windows, list your keys:

```
gh ssh-key list
```

If a key titled `health-tracker dev VM` is listed, it belonged to the old VM. Delete it, using the ID from the list:

```
gh ssh-key delete <id> --yes
```

Add the new key:

```
ssh dev cat ~/.ssh/id_ed25519.pub | gh ssh-key add - --title "health-tracker dev VM"
```

## 3. Clone the repo

Connect to the VM, and stay on it for the rest of this runbook:

```
ssh dev
git clone git@github.com:bhh1893/health-tracker.git
cd health-tracker
```

On first contact, SSH shows GitHub's host key fingerprint. Check it against [GitHub's published fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints) before answering `yes`.

## 4. Run the playbook

```
ansible-playbook iac/ansible/dev.yml -e dotfiles_repo=git@github.com:bhh1893/dotfiles.git
```

Omit `-e dotfiles_repo=...` to skip personal setup. The recap must show `failed=0`. Two `[WARNING]` lines about the inventory and implicit localhost are expected: this playbook only targets the machine it runs on.

Log out and back in, so the `docker` group and `~/.local/bin` on your `PATH` take effect:

```
exit
ssh dev
```

## 5. Log in to GitHub and Claude

```
gh auth login
claude
```

## 6. Restore cluster access (only if the cluster is running)

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
```

The playbook recap must show `changed=0`, and Docker must print its hello message without `sudo`.
