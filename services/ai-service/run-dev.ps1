# Start the AI service from the correct folder (fixes "No module named 'app'").
# Usage from repo root:
#   powershell -ExecutionPolicy Bypass -File .\services\ai-service\run-dev.ps1
# Or from this folder:
#   .\run-dev.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$activate = Join-Path $PSScriptRoot ".venv\Scripts\Activate.ps1"
if (Test-Path $activate) {
    . $activate
} else {
    Write-Host "Tip: create a venv first: python -m venv .venv" -ForegroundColor Yellow
    Write-Host "      then: .\.venv\Scripts\Activate.ps1 && pip install -r requirements.txt" -ForegroundColor Yellow
}

# Uvicorn still watches the whole cwd when `--reload-dir` is a subfolder (it re-adds cwd).
# `--reload-exclude` must be an absolute path: Uvicorn compares `Path('.venv')` to absolute
# `path.parents` from WatchFiles, so a relative `.venv` never matches on Windows.
$venvDir = Join-Path $PSScriptRoot ".venv"
$uvicornArgs = @("-m", "uvicorn", "app.main:app", "--reload", "--reload-dir", "app")
if (Test-Path -LiteralPath $venvDir) {
    $uvicornArgs += @("--reload-exclude", (Resolve-Path -LiteralPath $venvDir).Path)
}
$uvicornArgs += @("--host", "0.0.0.0", "--port", "8000")
& python @uvicornArgs
