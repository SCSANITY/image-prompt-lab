$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
if (-not (Test-Path -LiteralPath 'node_modules')) { throw 'Run npm ci once before starting the development app.' }
npm run dev
