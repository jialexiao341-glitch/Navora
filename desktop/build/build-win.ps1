<#
.SYNOPSIS
Build the Navora Windows x64 desktop installer locally (PyInstaller backend + Electron NSIS).

.EXAMPLE
powershell -ExecutionPolicy Bypass -File desktop/build/build-win.ps1
powershell -ExecutionPolicy Bypass -File desktop/build/build-win.ps1 -Version 2.2.2 -DryRun
#>
[CmdletBinding()]
param(
    [string]$Version = "",
    [string]$PythonExe = "",
    [switch]$SkipBackend,
    [switch]$SkipInstaller,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$BuildDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopDir = Split-Path -Parent $BuildDir
$RepoRoot = Split-Path -Parent $DesktopDir
$VenvDir = Join-Path $BuildDir ".venv-build"
$BackendDist = Join-Path $BuildDir "dist\cowagent-backend"
$ReleaseDir = Join-Path $DesktopDir "release"

function Resolve-BuildPython {
    param([string]$Requested)
    if ($Requested) { return $Requested }
    $repoVenv = Join-Path $RepoRoot ".venv\Scripts\python.exe"
    $candidates = @($repoVenv, "py -3.11", "py -3.12", "python")
    foreach ($cand in $candidates) {
        if ($cand -like "py *") {
            $verFlag = $cand.Split(' ')[1]
            try {
                $resolved = & py $verFlag -c "import sys; print(sys.executable)" 2>$null
                if ($LASTEXITCODE -eq 0 -and $resolved) { return $resolved.Trim() }
            } catch {}
        } elseif (Test-Path $cand -ErrorAction SilentlyContinue) {
            return $cand
        } else {
            $cmd = Get-Command $cand -ErrorAction SilentlyContinue
            if ($cmd) { return $cmd.Source }
        }
    }
    throw "No usable Python interpreter found. Pass -PythonExe <path>."
}

$PkgPath = Join-Path $DesktopDir "package.json"
$PkgJson = Get-Content $PkgPath -Raw | ConvertFrom-Json
if (-not $Version) {
    $Version = [string]$PkgJson.version
}
$Version = $Version.TrimStart('v').Trim()
$CliVersionFile = Join-Path $RepoRoot "cli\VERSION"
$CliVersion = (Get-Content $CliVersionFile -Raw).Trim()
$SelectedPython = Resolve-BuildPython -Requested $PythonExe

Write-Host "==> Repo root       : $RepoRoot"
Write-Host "==> Target version  : $Version (cli/VERSION=$CliVersion, package.json=$($PkgJson.version))"
Write-Host "==> Base Python     : $SelectedPython"
Write-Host "==> AppId / Publish : $($PkgJson.build.appId) -> $($PkgJson.build.publish.provider):$($PkgJson.build.publish.owner)/$($PkgJson.build.publish.repo)"

if ($Version -ne $CliVersion -or $Version -ne [string]$PkgJson.version) {
    throw "Version mismatch: target=$Version cli/VERSION=$CliVersion desktop/package.json=$($PkgJson.version)"
}
if (-not (Test-Path (Join-Path $DesktopDir "node_modules"))) {
    throw "desktop/node_modules missing. Run 'npm ci' in desktop/ first."
}

if ($DryRun) {
    Write-Host "==> DryRun checks passed. Ready to build Windows x64 package."
    exit 0
}

if (-not $SkipBackend) {
    if (-not (Test-Path $VenvDir)) {
        Write-Host "==> Creating isolated PyInstaller venv at $VenvDir"
        & $SelectedPython -m venv $VenvDir
        if ($LASTEXITCODE -ne 0) { throw "Failed to create build venv" }
    }
    $VenvPython = Join-Path $VenvDir "Scripts\python.exe"
    Write-Host "==> Installing desktop backend build dependencies"
    & $VenvPython -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed" }
    & $VenvPython -m pip install -r (Join-Path $BuildDir "requirements-desktop.txt") pyinstaller
    if ($LASTEXITCODE -ne 0) { throw "Failed to install backend build dependencies" }

    Write-Host "==> Running PyInstaller (onedir)"
    Push-Location $RepoRoot
    try {
        & $VenvPython -m PyInstaller (Join-Path $BuildDir "cowagent-backend.spec") `
            --noconfirm `
            --distpath (Join-Path $BuildDir "dist") `
            --workpath (Join-Path $BuildDir "build-work")
        if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path (Join-Path $BackendDist "cowagent-backend.exe"))) {
    throw "Bundled backend executable missing at $BackendDist\cowagent-backend.exe"
}

$Leaked = Get-ChildItem -Path $BackendDist -Recurse -File | Where-Object {
    ($_.Name -in @("config.json", ".env") -or $_.Name -like ".env.*") -and
    $_.FullName -notlike "*\playwright\*"
}
if ($Leaked) {
    throw "Sensitive config file detected in backend bundle: $($Leaked.FullName -join ', ')"
}

$BundledVerFile = Get-ChildItem -Path $BackendDist -Recurse -File -Filter "VERSION" | Where-Object { $_.FullName -like "*\cli\VERSION" } | Select-Object -First 1
if ($BundledVerFile) {
    $BundledVer = (Get-Content $BundledVerFile.FullName -Raw).Trim()
    if ($BundledVer -ne $Version) {
        throw "Bundled backend version mismatch: got '$BundledVer', expected '$Version'"
    }
    Write-Host "==> Verified bundled backend version: $BundledVer"
}

Push-Location $DesktopDir
try {
    Write-Host "==> Compiling desktop renderer + main"
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "desktop build failed" }

    if (-not $SkipInstaller) {
        Write-Host "==> Packaging Windows x64 NSIS installer (unsigned unless SIGNTOOL_* env vars are set)"
        & node "node_modules/electron-builder/cli.js" --win --x64 --config electron-builder.win.js --publish never
        if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }

        $LatestYml = Join-Path $ReleaseDir "latest.yml"
        if (-not (Test-Path $LatestYml)) {
            throw "Expected update metadata missing: $LatestYml"
        }
        $Exes = Get-ChildItem -Path $ReleaseDir -Filter "*.exe" -File
        if (-not $Exes) {
            throw "No .exe installer found in $ReleaseDir"
        }
        Write-Host "==> Installer build complete:"
        Get-ChildItem -Path $ReleaseDir -File | Select-Object Name, Length | Format-Table -AutoSize
    }
} finally {
    Pop-Location
}
