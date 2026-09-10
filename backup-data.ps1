#requires -Version 7
# Copies the whole poe2-tablet-price data directory to a timestamped backup and
# verifies every file by hash. The archive is the only copy of what a full pass
# of rate allowance bought, and that allowance cannot be bought back.
$ErrorActionPreference = 'Stop'

$source = Join-Path $env:LOCALAPPDATA 'poe2-tablet-price'
$stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHHmmss') + 'Z'
$root = Join-Path $env:USERPROFILE 'Backups\poe2-tablet-price'
$dest = Join-Path $root $stamp

if (-not (Test-Path $source)) { throw "No data directory at $source" }

# Refuse to run while anything holds the databases open. A copy taken mid-write
# is a backup that restores to a corrupt archive.
$running = Get-Process node -ErrorAction SilentlyContinue
if ($running) { throw "node is running (pid $($running.Id -join ', ')). Stop it before backing up." }

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $dest -Recurse -Force

$sourceFiles = Get-ChildItem -Recurse -File $source
$bad = @()
foreach ($f in $sourceFiles) {
  $rel = $f.FullName.Substring($source.Length).TrimStart('\')
  $copy = Join-Path $dest $rel
  if (-not (Test-Path $copy)) { $bad += "MISSING  $rel"; continue }
  $a = (Get-FileHash -Algorithm SHA256 $f.FullName).Hash
  $b = (Get-FileHash -Algorithm SHA256 $copy).Hash
  if ($a -ne $b) { $bad += "MISMATCH $rel" }
  else { "  ok  {0,12:N0}  {1}" -f $f.Length, $rel }
}

$mb = "{0:N1}" -f ((($sourceFiles | Measure-Object -Property Length -Sum).Sum) / 1MB)
"`n$($sourceFiles.Count) files, $mb MB -> $dest"

if ($bad) { $bad; throw "$($bad.Count) file(s) did not verify." }
'every file verified by SHA256'
