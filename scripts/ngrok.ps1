# Run ngrok even when Cursor's terminal has a stale PATH (call: .\scripts\ngrok.ps1 http 5173)
$ErrorActionPreference = "Stop"
$env:Path =
    [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
    [System.Environment]::GetEnvironmentVariable("Path", "User")

$exe = $null
foreach ($line in (where.exe ngrok 2>$null)) {
    if ($line -match "\.exe\s*$" -and (Test-Path $line)) { $exe = $line; break }
}
if (-not $exe) {
    foreach ($p in @(
            "${env:ProgramFiles}\Ngrok\ngrok.exe",
            "${env:ProgramFiles(x86)}\Ngrok\ngrok.exe",
            "$env:LOCALAPPDATA\Microsoft\WinGet\Links\ngrok.exe",
            "$env:USERPROFILE\scoop\shims\ngrok.exe"
        )) {
        if (Test-Path $p) { $exe = $p; break }
    }
}

if (-not $exe) {
    Write-Error "ngrok not found. Install: winget install Ngrok.Ngrok  OR  add ngrok.exe folder to User PATH, then restart Cursor."
    exit 1
}

& $exe @args
exit $LASTEXITCODE
