param()

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$typieRoot = Join-Path $repositoryRoot "vendor\typie"
$sourcePatch = Join-Path $repositoryRoot "patches\typie\phase1b-semantic-replace.patch"
$cargoScript = Join-Path $PSScriptRoot "cargo.ps1"
$ffiManifest = Join-Path $typieRoot "crates\editor-ffi\Cargo.toml"
$bindgenManifest = Join-Path $typieRoot "crates\editor-bindgen\Cargo.toml"
$wasmInput = Join-Path $typieRoot "target\wasm32-unknown-unknown\release-wasm-browser\editor_ffi.wasm"
$vendorOutput = Join-Path $typieRoot "crates\editor-ffi\pkg\browser"
$runtimeOutput = Join-Path $repositoryRoot "packages\typie-runtime\browser"
$buildInfoPath = Join-Path $repositoryRoot "packages\typie-runtime\BUILD_INFO.json"
$savedVendorTypes = [System.IO.Path]::GetTempFileName()
$patchApplied = $false

$dirty = (& git -C $typieRoot status --porcelain)
if ($LASTEXITCODE -ne 0 -or $dirty) {
  throw "vendor/typie must be clean before rebuilding the patched runtime"
}

Copy-Item -LiteralPath (Join-Path $vendorOutput "editor_ffi.d.ts") -Destination $savedVendorTypes -Force

try {
  & git -C $typieRoot apply --check $sourcePatch
  if ($LASTEXITCODE -ne 0) {
    throw "The Phase 1B Typie patch does not apply to the pinned submodule"
  }
  & git -C $typieRoot apply $sourcePatch
  if ($LASTEXITCODE -ne 0) {
    throw "Could not apply the Phase 1B Typie patch"
  }
  $patchApplied = $true

  & $cargoScript build --manifest-path $bindgenManifest --features bin --bin wasm-bindgen-cli --bin editor-bindgen-js
  if ($LASTEXITCODE -ne 0) { throw "Typie binding tools build failed" }

  & $cargoScript build --manifest-path $ffiManifest --profile release-wasm-browser --features wasm-browser --target wasm32-unknown-unknown
  if ($LASTEXITCODE -ne 0) { throw "Typie browser WASM build failed" }

  $wasmBindgen = Join-Path $typieRoot "target\debug\wasm-bindgen-cli.exe"
  $jsBindgen = Join-Path $typieRoot "target\debug\editor-bindgen-js.exe"
  & $wasmBindgen --target module --out-dir $vendorOutput $wasmInput
  if ($LASTEXITCODE -ne 0) { throw "wasm-bindgen generation failed" }
  & $jsBindgen (Join-Path $vendorOutput "editor_ffi")
  if ($LASTEXITCODE -ne 0) { throw "Typie JavaScript binding transform failed" }

  foreach ($name in @(
    "editor_ffi.js",
    "editor_ffi.d.ts",
    "editor_ffi_bg.wasm",
    "editor_ffi_bg.wasm.d.ts"
  )) {
    Copy-Item -LiteralPath (Join-Path $vendorOutput $name) -Destination (Join-Path $runtimeOutput $name) -Force
  }

  $buildInfo = Get-Content -LiteralPath $buildInfoPath -Raw | ConvertFrom-Json
  $actualPatch = (Get-FileHash -LiteralPath $sourcePatch -Algorithm SHA256).Hash.ToLowerInvariant()
  $actualWasm = (Get-FileHash -LiteralPath (Join-Path $runtimeOutput "editor_ffi_bg.wasm") -Algorithm SHA256).Hash.ToLowerInvariant()
  $actualJs = (Get-FileHash -LiteralPath (Join-Path $runtimeOutput "editor_ffi.js") -Algorithm SHA256).Hash.ToLowerInvariant()
  $actualTypes = (Get-FileHash -LiteralPath (Join-Path $runtimeOutput "editor_ffi.d.ts") -Algorithm SHA256).Hash.ToLowerInvariant()
  $actualWasmTypes = (Get-FileHash -LiteralPath (Join-Path $runtimeOutput "editor_ffi_bg.wasm.d.ts") -Algorithm SHA256).Hash.ToLowerInvariant()

  if (
    $actualPatch -ne $buildInfo.sourcePatch.sha256 -or
    $actualWasm -ne $buildInfo.wasmSha256 -or
    $actualJs -ne $buildInfo.bindings.javascriptSha256 -or
    $actualTypes -ne $buildInfo.bindings.typescriptSha256 -or
    $actualWasmTypes -ne $buildInfo.bindings.wasmTypescriptSha256
  ) {
    throw "Generated Typie runtime hashes do not match BUILD_INFO.json"
  }

  Write-Host "Phase 1B Typie runtime rebuilt and verified: $actualWasm"
}
finally {
  if ($patchApplied) {
    & git -C $typieRoot apply --reverse $sourcePatch
  }
  Copy-Item -LiteralPath $savedVendorTypes -Destination (Join-Path $vendorOutput "editor_ffi.d.ts") -Force
  Remove-Item -LiteralPath $savedVendorTypes -Force
}

$remaining = (& git -C $typieRoot status --porcelain)
if ($LASTEXITCODE -ne 0 -or $remaining) {
  throw "Typie rebuild left the pinned submodule dirty"
}
