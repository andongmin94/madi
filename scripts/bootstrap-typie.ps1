param()

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$typiePath = Join-Path $repositoryRoot "vendor\typie"
$typieRepository = "https://github.com/penxle/typie.git"
$typieCommit = "fbe5c4bf860d1717a66e66bea2374a2e39f0dd26"

if (Test-Path -LiteralPath (Join-Path $typiePath ".git")) {
  $foundCommit = (& git -C $typiePath rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $foundCommit -ne $typieCommit) {
    throw "vendor/typie is not at the required commit $typieCommit (found $foundCommit)"
  }
  $dirty = & git -C $typiePath status --porcelain
  if ($LASTEXITCODE -ne 0 -or $dirty) {
    throw "vendor/typie contains unrecorded changes"
  }
  Write-Output "Typie already pinned at $typieCommit"
  exit 0
}

if (Test-Path -LiteralPath $typiePath) {
  $existing = Get-ChildItem -LiteralPath $typiePath -Force
  if ($existing.Count -gt 0) {
    throw "vendor/typie exists but is not a Git checkout; refusing to overwrite it"
  }
} else {
  New-Item -ItemType Directory -Path (Split-Path -Parent $typiePath) -Force | Out-Null
}

& git clone --no-checkout $typieRepository $typiePath
if ($LASTEXITCODE -ne 0) {
  throw "Typie clone failed"
}
& git -C $typiePath checkout --detach $typieCommit
if ($LASTEXITCODE -ne 0) {
  throw "Typie checkout failed"
}

$foundCommit = (& git -C $typiePath rev-parse HEAD).Trim()
if ($foundCommit -ne $typieCommit) {
  throw "Typie pin verification failed"
}
Write-Output "Typie pinned at $typieCommit"
