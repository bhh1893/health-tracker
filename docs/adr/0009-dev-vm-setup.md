---
status: accepted
---

# Dev VM setup: Claude Code inside the VM, configured by a local Ansible playbook, holding no unique state (except backups, ADR 0011, and secrets, ADR 0015)

The Ubuntu dev VM (ADR 0004) is the daily workstation. Claude Code, the repo checkout, Docker, kubectl and Ansible all live on it, so the agent works on the same Linux the nodes and CI run. It is reached from Windows Terminal with `ssh dev` and worked in tmux, so sessions survive a disconnect; VS Code Remote-SSH is optional for reading diffs. The VM is configured by a committed Ansible playbook run against itself, and it holds nothing that cannot be rebuilt from git, the Windows host and two logins, except the database backups (ADR 0011) ([Dev VM setup](https://github.com/bhh1893/health-tracker/issues/15)).

## Shape

- **Machine:** `iac/vagrant/dev/`, Ubuntu 26.04, host-only `192.168.56.20`, **4 vCPU, 4 GB** (raise to 6 GB only if builds hit swap). Synced folders off.
- **Vagrant bootstrap** (the cloud-init equivalent, amends ADR 0004): install `ansible-core`, place the ops private key, and generate a per-machine GitHub ed25519 key if none exists. Nothing else.
- **Playbook:** `iac/ansible/dev.yml`, one role `dev_workstation`, `connection: local` (Ansible runs the tasks on the machine it is invoked on, no SSH). Same `ansible-lint` / `yamllint` CI and the same `changed=0` contract as the cluster roles.
- **Toolchain (project tools only), every version pinned:**
  - Python via `uv`, version from a committed `.python-version`; lint CLIs (`ansible-lint`, `yamllint`) via `uv tool install`. No system pip.
  - Node LTS from the NodeSource apt repo, one pinned major matching `engines` in `services/web/package.json`.
  - Docker Engine + buildx from Docker's apt repo; the user joins the `docker` group.
  - kubectl 1.36 from `pkgs.k8s.io` (same pin as the nodes), `helm`, `gh`, `git`.
  - Claude Code from Anthropic's native installer, auto-updating, not pinned: a workstation tool, never in images or CI, and independent of the project's Node version.
  - Argo CD CLI and Terraform are added when their tickets decide them.
- **Personal setup stays out of this repo.** `dev.yml` takes an optional `dotfiles_repo` variable; when set it clones that repo and runs its `install.sh`, which owns shell, editor, prompt, Claude global config and agent skills. The `install.sh` contract `dev.yml` relies on:
  - non-interactive, runs as the target user with passwordless sudo, exits non-zero on failure;
  - idempotent; prints `DOTFILES_CHANGED` only when it changed something (the task's `changed_when`);
  - needs Node (`npx`) for skill restore, so `dev.yml` runs it after installing Node.
- **GitHub access:** the per-machine key from the bootstrap, registered from Windows with `gh ssh-key add` (titled "health-tracker dev VM") so it can be revoked alone; `gh auth login` by hand.
- **`ssh dev` alias on Windows:** `HostName 192.168.56.20`, user `vagrant`, the Vagrant-generated key under `iac/vagrant/dev/.vagrant/`, `StrictHostKeyChecking accept-new`. Dev servers bind `0.0.0.0` and are browsed at `http://192.168.56.20:<port>`; no port forwarding.
- **Almost no unique state:** destroying the dev VM loses unpushed commits **and the database backups**, because MinIO runs here (amended by ADR 0011; the runbook warns before `vagrant destroy`). It also loses the generated secrets in `~/.config/health-tracker/`, which are replaced by new values (ADR 0015). Everything else is rebuildable. Project knowledge lives in the repo (CLAUDE.md, ADRs, terms), not Claude's per-machine memory; the ops key's source of truth is Windows (`~/.ssh/health-tracker-ops`); the kubeconfig comes from Ansible.
- **Rebuild:** a runbook, `docs/runbooks/dev-vm.md`, no script:
  1. `ssh-keygen -R 192.168.56.20`, then `vagrant destroy -f && vagrant up` in `iac/vagrant/dev/`.
  2. On Windows: `ssh dev cat ~/.ssh/id_ed25519.pub | gh ssh-key add - --title "health-tracker dev VM"` (delete the old VM's key on GitHub).
  3. `ssh dev`, `git clone` the repo over SSH.
  4. `ansible-playbook iac/ansible/dev.yml -e dotfiles_repo=<url>`.
  5. `gh auth login`, then `claude` and log in.
  6. If the cluster is running (ADR 0015): run `apply-secrets`, restart the pods, re-paste the token on the phone, and take a base backup straight away, because the bucket is now empty.

## Considered Options

- **Claude Code on Windows driving the VM over `ssh dev '...'`.** Rejected: every command crosses SSH, and file tools need an SSHFS mount with its latency and file-watching quirks; the agent would work on Windows while the code runs on Linux.
- **A bash script instead of Ansible.** Rejected: not idempotent without hand-written guards, and a second tool next to the one already being learned.
- **Copying the Windows `id_github` key, or SSH agent forwarding.** Rejected: a copied key cannot be revoked per machine; a forwarded agent disappears when the SSH session ends, breaking long tmux and Claude sessions.
- **Cloning over HTTPS with a token.** Rejected: the repo is private, so this only moves the bootstrap secret; a per-machine key is revocable and needs no stored token.
- **Claude Code from npm.** Rejected: couples the agent to the project's Node version.
- **A `rebuild-dev.ps1` script.** Deferred: the dev VM is rebuilt rarely and two steps are interactive logins; script it if two rebuilds prove the runbook tedious.
- **Dotfiles installed by `dev.yml` itself.** Rejected: puts personal preferences in the project; another developer could not use the playbook as-is.

## Consequences

- The dotfiles repo needs a stow-based, Linux-capable `install.sh` meeting the contract above before the dev VM is fully usable; that is work in the dotfiles repo, outside this map.
- The Windows `~/.ssh/config` `dev` entry (old prior-art VM on `127.0.0.1:2222`, host key checking off) is replaced.
- Claude memory and session history do not survive a dev VM rebuild by design; anything worth keeping is written to the repo.
- Moving the workstation to a cloud VM later changes only the Vagrant layer; `dev.yml` and the runbook steps 3-5 carry over.
