$ErrorActionPreference = "Stop"

Push-Location "$PSScriptRoot\..\backend"
try {
    if (-not (Test-Path ".venv")) {
        python -m venv .venv
    }
    .\.venv\Scripts\Activate.ps1
    pip install -r requirements-dev.txt
    pytest -q
}
finally {
    Pop-Location
}
