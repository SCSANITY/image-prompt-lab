$ErrorActionPreference = 'Stop'

Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
& .\node_modules\.bin\electron.cmd tests/safe-storage-smoke.cjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
