<#
.SYNOPSIS
  Builds, SIGNS and (optionally) publishes the Windows installer of BloumeChat.

.DESCRIPTION
  The OV code-signing certificate lives on a YubiKey, so the Windows build cannot run in the
  cloud CI: it is built here, on the PC the YubiKey is plugged into. Windows asks for the
  YubiKey PIN in its own prompt while signtool signs - type it there.

  Without -Publish the script stops after building and VERIFYING the result (nothing is
  uploaded). With -Publish it then uploads to the GitHub Release of the current version:
  installer + blockmap first, latest.yml LAST (the in-app updater only sees the new version
  once latest.yml is there).

  Run it from the windows/ folder AFTER `python scripts/git_sync.py windows` (which bumps the
  version, commits, tags and pushes):

      npm run release:win              # build + sign + verify, no upload
      npm run release:win -- -Publish  # same, then upload to GitHub

.PARAMETER Publish
  Upload the verified files to the GitHub Release (creates it when missing).
.PARAMETER SkipChecks
  Skip the pre-build quality gate (tsc, eslint, prettier, jest). Not recommended.
#>
param(
  [switch]$Publish,
  [switch]$SkipChecks
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "`nERROR: $text" -ForegroundColor Red; exit 1 }
function Ok($text) { Write-Host "  [ok] $text" -ForegroundColor Green }

# ---------------------------------------------------------------- configuration
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$version = $pkg.version
$tag = "v$version"
$builder = Get-Content electron-builder.yml -Raw
$thumbprint = ([regex]::Match($builder, "(?m)^\s*certificateSha1:\s*([0-9A-Fa-f]{40})")).Groups[1].Value.ToUpper()
$publisherDn = ([regex]::Match($builder, '(?m)^\s*-\s*"(CN=[^"]+)"')).Groups[1].Value
$repo = "BloumeSAS/bloumechat-app"
if (-not $thumbprint) { Fail "certificateSha1 not found in electron-builder.yml" }
if (-not $publisherDn) { Fail "publisherName (DN) not found in electron-builder.yml" }

Write-Host "BloumeChat $version  |  tag $tag  |  certificate $thumbprint" -ForegroundColor White

# ---------------------------------------------------------------- pre-flight
Step "Pre-flight"
$dirty = git status --porcelain -- . ":!tsconfig.tsbuildinfo" 2>$null
if ($dirty) { Write-Host "  [warn] uncommitted changes in windows/ - the installer will not match the tag:" -ForegroundColor Yellow; $dirty | ForEach-Object { Write-Host "         $_" } }
$tagCommit = git rev-list -n 1 $tag 2>$null
$head = git rev-parse HEAD
if (-not $tagCommit) { Write-Host "  [warn] tag $tag does not exist yet (run: python scripts/git_sync.py windows)" -ForegroundColor Yellow }
elseif ($tagCommit -ne $head) { Write-Host "  [warn] HEAD is not the commit of $tag" -ForegroundColor Yellow }
else { Ok "HEAD is $tag" }

$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Thumbprint -eq $thumbprint } | Select-Object -First 1
if (-not $cert) {
  Write-Host @"

  The signing certificate ($thumbprint) is NOT visible in your Windows certificate store.
  signtool can only use it from there. Check, in this order:
    1. The YubiKey is plugged in.
    2. The 'Certificate Propagation' service is not disabled:
         Get-Service CertPropSvc        (StartType must not be 'Disabled')
         # admin PowerShell:  Set-Service CertPropSvc -StartupType Manual; Start-Service CertPropSvc
       then unplug and replug the YubiKey.
    3. The YubiKey smart-card minidriver is installed (a 3072-bit RSA key is not handled by
       the Windows built-in PIV driver): https://www.yubico.com/support/download/smart-card-drivers-tools/
    4. certutil -user -store My   must now list "CN=BLOUME SAS" issued by SSL.com.
"@ -ForegroundColor Yellow
  Fail "certificate not available"
}
Ok "certificate found: $($cert.Subject)"
if ($cert.NotAfter -lt (Get-Date).AddDays(30)) { Write-Host "  [warn] certificate expires on $($cert.NotAfter.ToString('yyyy-MM-dd'))" -ForegroundColor Yellow }

if ($Publish) {
  & gh auth status *> $null
  if ($LASTEXITCODE -ne 0) { Fail "gh is not authenticated (gh auth login)" }
  Ok "gh authenticated"
}

# ---------------------------------------------------------------- quality gate
if (-not $SkipChecks) {
  Step "Quality gate (tsc, eslint, prettier, jest)"
  npx tsc --noEmit -p . ; if ($LASTEXITCODE -ne 0) { Fail "tsc failed" }
  npx eslint . --max-warnings 0 ; if ($LASTEXITCODE -ne 0) { Fail "eslint failed" }
  npx prettier --check "main/**/*.ts" "renderer/**/*.{ts,tsx}" ; if ($LASTEXITCODE -ne 0) { Fail "prettier failed" }
  npx jest --ci ; if ($LASTEXITCODE -ne 0) { Fail "jest failed" }
  Ok "all checks passed"
}

# ---------------------------------------------------------------- build + sign
Step "Build + sign (Windows will ask for the YubiKey PIN)"
if (Test-Path dist) { Remove-Item dist -Recurse -Force }
npx nextron build --win nsis --publish never
if ($LASTEXITCODE -ne 0) { Fail "build failed" }

$installer = Join-Path "dist" "BloumeChat-Setup-$version.exe"
$blockmap = "$installer.blockmap"
$latest = Join-Path "dist" "latest.yml"
$appExe = Join-Path "dist" "win-unpacked\BloumeChat.exe"
foreach ($f in @($installer, $blockmap, $latest, $appExe)) { if (-not (Test-Path $f)) { Fail "missing build output: $f" } }

# ---------------------------------------------------------------- verification
Step "Verifying the result"
foreach ($f in @($appExe, $installer)) {
  $sig = Get-AuthenticodeSignature $f
  if ($sig.Status -ne "Valid") { Fail "$f signature status: $($sig.Status) - $($sig.StatusMessage)" }
  if ($sig.SignerCertificate.Thumbprint -ne $thumbprint) { Fail "$f is signed by another certificate ($($sig.SignerCertificate.Subject))" }
  if (-not $sig.TimeStamperCertificate) { Fail "$f has no timestamp (the signature would die with the certificate)" }
  Ok "$(Split-Path $f -Leaf): valid signature, timestamped"
}

# the exact string electron-updater compares, case-sensitively, with the signer of an update
$signer = (Get-AuthenticodeSignature $installer).SignerCertificate.Subject
$norm = { param($s) (($s -split ",") | ForEach-Object { $_.Trim() }) -join "," }
if ((& $norm $signer) -ne (& $norm $publisherDn)) { Fail "signer '$signer' differs from publisherName '$publisherDn' - every update would be refused" }
Ok "signer matches publisherName ($publisherDn)"

$appUpdate = Join-Path "dist" "win-unpacked\resources\app-update.yml"
if (-not (Test-Path $appUpdate)) { Fail "app-update.yml is missing from the build" }
if ((Get-Content $appUpdate -Raw) -notmatch [regex]::Escape($publisherDn)) { Fail "app-update.yml does not carry publisherName (signature verification would be skipped)" }
Ok "app-update.yml carries publisherName"

$yml = Get-Content $latest -Raw
if ($yml -notmatch "(?m)^version:\s*$([regex]::Escape($version))\s*$") { Fail "latest.yml is not for version $version" }
$expectedSha = ([regex]::Match($yml, "(?m)^sha512:\s*(\S+)")).Groups[1].Value
$sha = [System.Security.Cryptography.SHA512]::Create()
$stream = [System.IO.File]::OpenRead((Resolve-Path $installer))
$actualSha = [Convert]::ToBase64String($sha.ComputeHash($stream)); $stream.Dispose()
if ($actualSha -ne $expectedSha) { Fail "latest.yml sha512 does not match the installer" }
Ok "latest.yml: version $version, sha512 matches the installer"

$sizeMb = [math]::Round((Get-Item $installer).Length / 1MB, 1)
Write-Host "`nReady: $installer ($sizeMb MB)" -ForegroundColor Green

if (-not $Publish) {
  Write-Host "Nothing uploaded. To publish: npm run release:win -- -Publish" -ForegroundColor Yellow
  exit 0
}

# ---------------------------------------------------------------- publish
Step "Publishing to GitHub ($repo $tag)"
& gh release view $tag -R $repo *> $null
if ($LASTEXITCODE -ne 0) {
  gh release create $tag -R $repo --title $tag --notes "BloumeChat desktop $version" --verify-tag
  if ($LASTEXITCODE -ne 0) { Fail "could not create release $tag (is the tag pushed?)" }
}
gh release upload $tag $installer $blockmap -R $repo --clobber
if ($LASTEXITCODE -ne 0) { Fail "upload of installer failed" }
# latest.yml last: clients only see the new version once everything it points to is there
gh release upload $tag $latest -R $repo --clobber
if ($LASTEXITCODE -ne 0) { Fail "upload of latest.yml failed" }
Ok "released $tag"
gh release view $tag -R $repo --json url,assets -q '.url, (.assets[].name)'
