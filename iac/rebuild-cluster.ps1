<#
.SYNOPSIS
    Destroys and recreates the three cluster nodes, then proves they work (ADR 0004).

.DESCRIPTION
    Runs on Windows. Vagrant runs here, Ansible runs on the dev VM over `ssh dev`.
    The dev VM itself is never destroyed: this script does not know its Vagrantfile.

    Exit code: 0 means all nodes are Ready, Cilium is healthy, and a second playbook
    run changed nothing. Anything else means do not trust the cluster.

.PARAMETER Ref
    The git ref Ansible runs from. It must exist in the dev VM's repo.

.EXAMPLE
    .\iac\rebuild-cluster.ps1

.EXAMPLE
    .\iac\rebuild-cluster.ps1 -Ref origin/my-branch
#>
[CmdletBinding()]
param(
    [string]$Ref = 'origin/main'
)

# Stops on PowerShell errors only. A native program such as ssh or vagrant reports
# failure through $LASTEXITCODE, which this does not look at: see Invoke-Step.
$ErrorActionPreference = 'Stop'

# Third copy of these IPs, after the Vagrantfile and the inventory. A stale one
# fails loudly at the SSH wait.
$Nodes = [ordered]@{
    'k8s-cp-1'     = '192.168.56.10'
    'k8s-worker-1' = '192.168.56.11'
    'k8s-worker-2' = '192.168.56.12'
}

$RepoOnDev = '~/health-tracker'
# A worktree of its own, because $RepoOnDev is where day-to-day work happens and
# can be on any branch, with any edits. A rebuild must test what is committed.
$CheckoutOnDev = '~/rebuild-checkout'
$AnsibleDir = "$CheckoutOnDev/iac/ansible"

# BatchMode: fail instead of waiting for a password nobody is there to type.
# ServerAlive: a dead connection ends in a failure, not a hang.
$SshOptions = @(
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=4'
)

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

# Runs a block of native commands and turns a non-zero exit code into an error.
function Invoke-Step {
    param(
        [string]$Name,
        [scriptblock]$Action
    )
    Write-Step $Name
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

# Remote commands must not contain double quotes: Windows PowerShell 5.1 strips
# them when passing arguments to native programs. The login shell there is zsh, so
# keep them to syntax that zsh and bash share.
#
# $RemoteCommand has a name no other function here uses on purpose: the block below
# runs inside Invoke-Step, and PowerShell looks variables up through the call stack,
# so a parameter of Invoke-Step with the same name would win.
function Invoke-Dev {
    param(
        [string]$Name,
        [string]$RemoteCommand
    )
    Invoke-Step $Name { ssh @SshOptions dev $RemoteCommand }
}

# Retries a command until it exits 0, and reports how many attempts it took, because
# new VMs can refuse or drop the first connections (PR #74).
function Wait-ForSsh {
    param(
        [string]$Name,
        [scriptblock]$Action,
        [int]$MaxAttempts = 24,
        [int]$DelaySeconds = 5
    )
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        & $Action
        if ($LASTEXITCODE -eq 0) {
            Write-Host "$Name accepted SSH on attempt $attempt"
            return
        }
        Start-Sleep -Seconds $DelaySeconds
    }
    throw "$Name did not accept SSH after $MaxAttempts attempts"
}

# Streams the output and also returns it, so the caller can read the recap.
function Invoke-Playbook {
    param([string]$Name)
    Write-Step $Name
    $output = @()
    ssh @SshOptions dev "cd $AnsibleDir && ansible-playbook site.yml" |
        Tee-Object -Variable output | Write-Host
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
    return $output
}

function Assert-NoChanges {
    param([string[]]$PlaybookOutput)
    $recap = @($PlaybookOutput | Where-Object { $_ -match '\bunreachable=\d+' })
    # Without this, output with no recap in it would count as "nothing changed".
    if ($recap.Count -eq 0) {
        throw 'The second playbook run printed no recap'
    }
    $changed = @($recap | Where-Object { $_ -match '\bchanged=[1-9]' })
    if ($changed.Count -gt 0) {
        throw "The second playbook run changed something, so a role is not idempotent:`n$($changed -join "`n")"
    }
}

function Assert-NodeCount {
    Write-Step 'Check every node joined'
    # `kubectl wait --all` only covers nodes that exist, so it cannot see a missing one.
    $names = @(ssh @SshOptions dev 'kubectl get nodes --output=name')
    if ($LASTEXITCODE -ne 0) {
        throw "kubectl get nodes failed with exit code $LASTEXITCODE"
    }
    if ($names.Count -ne $Nodes.Count) {
        throw "Expected $($Nodes.Count) nodes, found $($names.Count): $($names -join ', ')"
    }
}

function Invoke-Rebuild {
    # Everything before `vagrant destroy` can fail without costing anything, so
    # check all of it there.
    Write-Step 'Reach the dev VM'
    Wait-ForSsh 'dev' { ssh @SshOptions dev true }

    Invoke-Dev 'Check the dev VM has the tools' (
        'for tool in git ansible-playbook ansible-galaxy helm kubectl cilium; do ' +
        'command -v $tool > /dev/null || { echo missing: $tool; exit 1; }; done; ' +
        'test -r ~/.ssh/health-tracker-ops || { echo missing: ops key; exit 1; }'
    )

    Invoke-Dev "Check out $Ref on the dev VM" (
        "git -C $RepoOnDev fetch --prune origin && " +
        "git -C $RepoOnDev worktree prune && " +
        "{ test -e $CheckoutOnDev || git -C $RepoOnDev worktree add --detach $CheckoutOnDev; } && " +
        "git -C $CheckoutOnDev checkout --force --detach $Ref && " +
        "git -C $CheckoutOnDev clean -ffdx && " +
        "git -C $CheckoutOnDev log -1 --oneline"
    )

    Invoke-Dev 'Install Ansible collections' (
        "cd $AnsibleDir && ansible-galaxy collection install -r requirements.yml"
    )

    Invoke-Dev 'Check the playbook parses' (
        "cd $AnsibleDir && ansible-playbook site.yml --syntax-check"
    )

    Push-Location (Join-Path $PSScriptRoot 'vagrant/cluster')
    try {
        Invoke-Step 'Destroy the nodes' { vagrant destroy --force }
        Invoke-Step 'Create the nodes' { vagrant up }
    }
    finally {
        Pop-Location
    }

    # touch: ssh-keygen -R exits non-zero if the file does not exist.
    foreach ($ip in $Nodes.Values) {
        Invoke-Dev "Clear the old host key for $ip" (
            "touch ~/.ssh/known_hosts && ssh-keygen -R $ip"
        )
    }

    Write-Step 'Wait for the nodes to accept SSH from the dev VM'
    foreach ($node in $Nodes.GetEnumerator()) {
        $probe = 'ssh -n -o BatchMode=yes -o ConnectTimeout=5 ' +
            '-o StrictHostKeyChecking=accept-new -i ~/.ssh/health-tracker-ops ' +
            "vagrant@$($node.Value) true"
        Wait-ForSsh $node.Key { ssh @SshOptions dev $probe }
    }

    Invoke-Playbook 'Run the playbook' | Out-Null
    Assert-NoChanges (Invoke-Playbook 'Run the playbook again, expecting no changes')

    Assert-NodeCount
    Invoke-Dev 'Wait for all nodes to be Ready' (
        'kubectl wait --for=condition=Ready nodes --all --timeout=5m'
    )
    Invoke-Dev 'Wait for Cilium to be healthy' (
        'cilium status --wait --wait-duration=5m'
    )
}

$timer = [System.Diagnostics.Stopwatch]::StartNew()
try {
    Invoke-Rebuild
}
catch {
    # Explicit, because how an uncaught error maps to an exit code depends on how
    # PowerShell was started.
    Write-Host "`nREBUILD FAILED after $($timer.Elapsed.ToString('hh\:mm\:ss')): $_" -ForegroundColor Red
    exit 1
}
Write-Host "`nREBUILD OK in $($timer.Elapsed.ToString('hh\:mm\:ss'))" -ForegroundColor Green
exit 0
