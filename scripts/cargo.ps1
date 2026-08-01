param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $CargoArgs
)

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$localCargoHome = Join-Path $repositoryRoot ".tools\cargo"
$localRustupHome = Join-Path $repositoryRoot ".tools\rustup"
$localCargo = Join-Path $localCargoHome "bin\cargo.exe"
$requiredVersion = "1.97.1"
$requiredToolchain = "$requiredVersion-x86_64-pc-windows-msvc"
$localExactRoot = Join-Path $localRustupHome "toolchains\$requiredToolchain"
$localStableRoot = Join-Path $localRustupHome "toolchains\stable-x86_64-pc-windows-msvc"
$localExactCargo = Join-Path $localExactRoot "bin\cargo.exe"
$localStableCargo = Join-Path $localStableRoot "bin\cargo.exe"

if (Test-Path -LiteralPath $localExactCargo) {
  $env:CARGO_HOME = $localCargoHome
  $env:RUSTUP_HOME = $localRustupHome
  $env:PATH = "$(Join-Path $localExactRoot 'bin');$env:PATH"
  & $localExactCargo @CargoArgs
} elseif (Test-Path -LiteralPath $localStableCargo) {
  $localRustc = Join-Path $localStableRoot "bin\rustc.exe"
  $foundVersion = (& $localRustc --version).Split(" ")[1]
  if ($foundVersion -ne $requiredVersion) {
    throw "Local stable Rust is $foundVersion; madi requires $requiredVersion"
  }
  $env:CARGO_HOME = $localCargoHome
  $env:RUSTUP_HOME = $localRustupHome
  $env:PATH = "$(Join-Path $localStableRoot 'bin');$env:PATH"
  & $localStableCargo @CargoArgs
} elseif (Test-Path -LiteralPath $localCargo) {
  $env:CARGO_HOME = $localCargoHome
  $env:RUSTUP_HOME = $localRustupHome
  $env:PATH = "$(Join-Path $localCargoHome 'bin');$env:PATH"
  & $localCargo "+$requiredToolchain" @CargoArgs
} else {
  & cargo "+$requiredToolchain" @CargoArgs
}

exit $LASTEXITCODE
