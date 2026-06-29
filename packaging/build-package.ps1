# Build the distributable Windows test package -> release\EggshellMoldMaker.zip
# Usage:  powershell -ExecutionPolicy Bypass -File packaging\build-package.ps1
$ErrorActionPreference = 'Stop'
$proj = Split-Path $PSScriptRoot -Parent
Set-Location $proj

Write-Host "Building production bundle..."
npm run build

$releaseRoot = Join-Path $proj 'release'
$pkg = Join-Path $releaseRoot 'EggshellMoldMaker'
if (Test-Path $releaseRoot) { Remove-Item $releaseRoot -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $pkg 'app') -Force | Out-Null

Copy-Item (Join-Path $proj 'dist\*') (Join-Path $pkg 'app') -Recurse -Force
Copy-Item (Join-Path $PSScriptRoot 'serve.ps1')   $pkg
Copy-Item (Join-Path $PSScriptRoot 'start.bat')   $pkg
Copy-Item (Join-Path $PSScriptRoot 'README.txt')  $pkg
Copy-Item (Join-Path $proj 'samples\egg.stl') (Join-Path $pkg 'egg.stl')
# the served copy of the sample isn't used in production; drop it to slim the zip
Remove-Item (Join-Path $pkg 'app\egg.stl') -ErrorAction SilentlyContinue

$zip = Join-Path $releaseRoot 'EggshellMoldMaker.zip'
Compress-Archive -Path $pkg -DestinationPath $zip -Force -CompressionLevel Optimal
Write-Host ("Built {0} ({1} MB)" -f $zip, [math]::Round((Get-Item $zip).Length / 1MB, 2))
