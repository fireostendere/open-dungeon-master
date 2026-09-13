#Requires -Version 5.1
<# Standalone Windows 10/11 installer. Uses Linux containers in Docker Desktop.
   Existing Docker/Git/Python/restic installs are reused. No GPU driver or firewall changes.
   -Plan is safe and works without administrator permissions or installed dependencies.
#>
[CmdletBinding()]
param(
    [string]$Root = "$env:LOCALAPPDATA\OpenDungeonMaster",
    [string]$Repo = 'fireostendere/dungeon_master',
    [string]$Branch = 'main',
    [string]$Ref = '',
    [ValidateSet('none','ollama','external')][string]$Runtime = 'ollama',
    [string]$Model = 'qwen3:8b',
    [ValidateSet('cpu','nvidia')][string]$Accelerator = 'cpu',
    [string]$LlmUrl = 'http://host.docker.internal:11434/v1',
    [string]$ComfyUrl = '',
    [ValidateRange(1024,65535)][int]$Port = 3005,
    [string]$TokenFile = '',
    [switch]$AutoUpdate,
    [switch]$SkipAssets,
    [switch]$Yes,
    [switch]$Resume,
    [switch]$Plan
)
$ErrorActionPreference = 'Stop'
if ($Repo -notmatch '^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$' -or $Branch -notmatch '^[A-Za-z0-9][A-Za-z0-9._/-]*$' -or $Branch.Contains('..')) { throw 'Invalid repository or branch' }
if ($Plan) {
    Write-Output "Target: $Root"
    Write-Output "Private fork: $Repo ($Branch); runtime: $Runtime; model: $Model"
    Write-Output 'Install missing Git, Python 3.13, restic and Docker Desktop via WinGet.'
    Write-Output 'Build the fork; create persistent encrypted game state; schedule maintenance at user logon.'
    Write-Output 'GPU drivers, global execution policy, firewall and sleep settings are not changed.'
    return
}
if ($env:OS -ne 'Windows_NT') { throw 'Use install-server.sh --mode local on Linux.' }
$Root = [IO.Path]::GetFullPath($Root)
if ($Root -eq [IO.Path]::GetPathRoot($Root) -or $Root -match '["%$`\r\n]') { throw 'Unsafe installation directory' }
if ((Test-Path $Root) -and (Get-ChildItem -Force $Root | Select-Object -First 1) -and !(Test-Path "$Root\.odm-managed")) { throw 'Choose an empty directory; existing projects are not overwritten.' }
New-Item -ItemType Directory -Force "$Root\config", "$Root\tools" | Out-Null
Set-Content -Encoding Ascii "$Root\.odm-managed" 'schema=1'
# Protect the ENTIRE installation, not only a plaintext password file.
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $Root /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict installation ACLs' }
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Write-Utf8([string]$Path, [string]$Text) { [IO.File]::WriteAllText($Path, $Text, $utf8) }
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
    $env:Path += ';' + "$env:ProgramFiles\Git\cmd;$env:ProgramFiles\Docker\Docker\resources\bin;$env:LOCALAPPDATA\Microsoft\WinGet\Links"
}
function Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE). No existing game data was removed." }
}
if ($Resume -and (Test-Path "$Root\config\resume.json")) {
    $saved = Get-Content -Raw "$Root\config\resume.json" | ConvertFrom-Json
    $Repo=$saved.Repo; $Branch=$saved.Branch; $Ref=$saved.Ref; $Runtime=$saved.Runtime; $Model=$saved.Model
    $Accelerator=$saved.Accelerator; $LlmUrl=$saved.LlmUrl; $ComfyUrl=$saved.ComfyUrl; $Port=$saved.Port
    $AutoUpdate=[bool]$saved.AutoUpdate; $SkipAssets=[bool]$saved.SkipAssets; $Yes=$true
}
if (!$Yes -and !$Resume) {
    $choice = Read-Host 'Runtime: ollama (local CPU), external (existing runtime), none (cloud wizard) [ollama]'
    if ($choice) { if ($choice -notin @('none','ollama','external')) { throw 'Unknown runtime' }; $Runtime=$choice }
    if ($Runtime -ne 'none') { $choice=Read-Host "Exact model ID [$Model]"; if ($choice) { $Model=$choice } }
}
$settings = @{Repo=$Repo;Branch=$Branch;Ref=$Ref;Runtime=$Runtime;Model=$Model;Accelerator=$Accelerator;LlmUrl=$LlmUrl;ComfyUrl=$ComfyUrl;Port=$Port;AutoUpdate=[bool]$AutoUpdate;SkipAssets=[bool]$SkipAssets}
Write-Utf8 "$Root\config\resume.json" ($settings | ConvertTo-Json)
if ($PSCommandPath -ne "$Root\tools\install-local.ps1") { Copy-Item $PSCommandPath "$Root\tools\install-local.ps1" -Force }
function Need-Reboot {
    $runOnce='HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce'
    New-Item -Force $runOnce | Out-Null
    New-ItemProperty -Path $runOnce -Name 'ODM-Resume-Install' -PropertyType String -Force -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$Root\tools\install-local.ps1`" -Root `"$Root`" -Resume" | Out-Null
    Write-Warning 'A Windows prerequisite requires a reboot. Installation will resume at your next login. The installer does not reboot the PC automatically.'
    exit 3010
}
function Ensure-Command([string]$Command, [string]$Package) {
    Refresh-Path
    if (Get-Command $Command -ErrorAction SilentlyContinue) { return }
    if (!(Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw 'WinGet is required: install Microsoft App Installer, then rerun this file.' }
    & winget.exe install --exact --id $Package --source winget --silent --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -in @(3010,1641)) { Need-Reboot }
    if ($LASTEXITCODE -ne 0) { throw "Installation of $Package failed; rerun after resolving the package error." }
    Refresh-Path
}
Ensure-Command 'git.exe' 'Git.Git'
Ensure-Command 'py.exe' 'Python.Python.3.13'
Ensure-Command 'restic.exe' 'restic.restic'
Ensure-Command 'docker.exe' 'Docker.DockerDesktop'
$python = (& py.exe -3 -c 'import sys; print(sys.executable)').Trim()
if ($LASTEXITCODE -ne 0 -or !(Test-Path $python)) { throw 'Python 3.10+ could not be started' }
Checked $python @('-c','import sys; assert sys.version_info >= (3,10), "Python 3.10+ required"')
$desktop = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
if (!(Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue) -and (Test-Path $desktop)) { Start-Process $desktop }
$ready=$false
for ($i=0; $i -lt 90; $i++) {
    & docker.exe info --format '{{.OSType}}' 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready=$true; break }
    Start-Sleep -Seconds 2
}
if (!$ready) {
    & wsl.exe --status 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        $admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
        if (!$admin) { throw 'WSL2 needs administrator permission. Rerun this installer from an elevated PowerShell.' }
        & wsl.exe --install --no-distribution
        if ($LASTEXITCODE -in @(0,3010,1641)) { Need-Reboot }
    }
    throw 'Docker Desktop is not ready. Complete its first-start/WSL2/virtualization setup, then rerun. Current settings and secrets are preserved.'
}
if ((& docker.exe info --format '{{.OSType}}').Trim() -ne 'linux') { throw 'Switch Docker Desktop to Linux containers and rerun.' }
Checked 'docker.exe' @('compose','version')
if ($TokenFile) {
    if (!(Test-Path $TokenFile -PathType Leaf)) { throw 'Token file not found' }
    Write-Utf8 "$Root\config\github.token" ((Get-Content -Raw $TokenFile).Trim()+"`n")
}
$helper = @'
@echo off
echo %~1 | findstr /I "Username" >nul
if %errorlevel% equ 0 (echo x-access-token) else (type "__TOKEN__")
'@
Write-Utf8 "$Root\config\git-askpass.cmd" ($helper.Replace('__TOKEN__', "$Root\config\github.token"))
$env:GIT_ASKPASS="$Root\config\git-askpass.cmd"; $env:GIT_TERMINAL_PROMPT='0'
if (!(Test-Path "$Root\repository\.git")) {
    & git.exe ls-remote "https://github.com/$Repo.git" HEAD 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        if ($Yes) { throw 'Private repository access required; supply -TokenFile with a read-only Contents token.' }
        $secret=Read-Host 'Read-only GitHub repository token' -AsSecureString
        $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        try { Write-Utf8 "$Root\config\github.token" ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)+"`n") }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    }
    Checked 'git.exe' @('clone','--branch',$Branch,'--',"https://github.com/$Repo.git","$Root\repository")
}
if ($Ref) { Checked 'git.exe' @('-C',"$Root\repository",'checkout','--detach',$Ref) }
if (!(Test-Path "$Root\repository\deploy\odmctl.py")) { throw 'Selected revision has no deployment controller' }
if (!(Test-Path "$Root\tools\odmctl.py")) { Copy-Item "$Root\repository\deploy\odmctl.py" "$Root\tools\odmctl.py" }
$arguments=@("$Root\tools\odmctl.py",'--root',$Root,'install','--repo',$Repo,'--branch',$Branch,'--runtime',$Runtime,'--model',$Model,'--accelerator',$Accelerator,'--llm-url',$LlmUrl,'--port',"$Port")
if ($Ref) { $arguments+=@('--ref',$Ref) }; if ($ComfyUrl) { $arguments+=@('--comfy-url',$ComfyUrl) }
if ($AutoUpdate) { $arguments+='--auto-update' }; if ($SkipAssets) { $arguments+='--skip-assets' }
# Keep maintenance installed when an optional model/asset download needs a retry.
$provisioningError=$null
try { Checked $python $arguments } catch { $provisioningError=$_ }
if (!(Test-Path "$Root\config\active.json")) { throw $provisioningError }
$cmd="@echo off`r`n`"$python`" `"$Root\tools\odmctl.py`" --root `"$Root`" %*`r`n"
Write-Utf8 "$Root\odmctl.cmd" $cmd
$runner=@'
param([string]$Operation='watchdog')
$ErrorActionPreference='Stop'
$env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')+';__BINPATH__'
if($Operation -eq 'start') {
  $desktop='__DESKTOP__'
  if(Test-Path $desktop){Start-Process $desktop}
  for($i=0;$i -lt 90;$i++){& docker.exe info 2>$null | Out-Null;if($LASTEXITCODE -eq 0){break};Start-Sleep 2}
}
$extra=@();if($Operation -eq 'restore-check'){$extra=@('latest')}
& '__PYTHON__' '__CTL__' --root '__ROOT__' $Operation @extra
exit $LASTEXITCODE
'@
# Values are single-quoted in the generated script; escape apostrophes rather than evaluating input.
$replacements=@{__PYTHON__=$python;__CTL__="$Root\tools\odmctl.py";__ROOT__=$Root;__DESKTOP__=$desktop;__BINPATH__="$env:ProgramFiles\Docker\Docker\resources\bin;$env:ProgramFiles\Git\cmd;$env:LOCALAPPDATA\Microsoft\WinGet\Links"}
foreach($k in $replacements.Keys){$runner=$runner.Replace($k,$replacements[$k].Replace("'","''"))}
Write-Utf8 "$Root\tools\windows-run.ps1" $runner
$user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$taskSettings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 3)
$tasks=@{
    'start'=(New-ScheduledTaskTrigger -AtLogOn -User $user)
    'watchdog'=(New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1))
    'backup'=(New-ScheduledTaskTrigger -Daily -At '03:30')
    'check'=(New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '04:15')
    'restore-check'=(New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '05:00')
}
$updateOperation=if($AutoUpdate){'update'}else{'check-update'}
$tasks[$updateOperation]=New-ScheduledTaskTrigger -Daily -At '05:30'
foreach($operation in $tasks.Keys) {
    $action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Root\tools\windows-run.ps1`" -Operation $operation"
    Register-ScheduledTask -TaskName "ODM-$Port-$operation" -Action $action -Trigger $tasks[$operation] -Principal $principal -Settings $taskSettings -Force | Out-Null
}
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce' -Name 'ODM-Resume-Install' -ErrorAction SilentlyContinue
Write-Host "Open http://localhost:$Port . Admin credentials: $Root\config\admin.json"
Write-Host "Management command: $Root\odmctl.cmd"
Write-Warning 'Local availability requires Windows to be awake and the user session/Docker Desktop to run. A Linux server is the unattended 24/7 option.'

if ($provisioningError) { throw $provisioningError }
