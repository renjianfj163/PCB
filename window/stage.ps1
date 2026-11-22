# Assembles the flat application tree the installer embeds.
#
#   powershell -ExecutionPolicy Bypass -File window/stage.ps1
#   powershell -ExecutionPolicy Bypass -File window/stage.ps1 -NodeExe <path> -OmpExe <path>
#   powershell -ExecutionPolicy Bypass -File window/stage.ps1 -OmpUrl <url> -OmpSha256 <hex>
#
# Inputs : window/dist  PCBWindow.exe + WebView2 dlls (window/build.ps1)
#          web/dist     built UI (`npm run build`)
#          server/  shared/  package.json  LICENSE  NOTICE
#          node.exe     -NodeExe, or nodejs.org v<NodeVersion>
#          omp.exe      -OmpExe, or -OmpUrl plus -OmpSha256
# Output : dist/stage - flat at the install root, the layout ServerHost.cs expects:
#          PCBWindow.exe finds server/main.ts next to itself, node.exe and omp.exe
#          are taken from that same directory before PATH.

param(
	[string]$Stage = "",
	[string]$NodeVersion = "24.16.0",
	[string]$NodeExe = "",
	[string]$OmpExe = "",
	[string]$OmpUrl = "",
	[string]$OmpSha256 = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
if (-not $Stage) { $Stage = Join-Path $root "dist\stage" }
$cache = Join-Path $root "window\.build\cache"

function Need-File([string]$path, [string]$hint) {
	if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
		throw ("missing " + $path + " - " + $hint)
	}
}

function Get-Sha256([string]$path) {
	(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-Cached([string]$url, [string]$target) {
	if (Test-Path -LiteralPath $target) { return }
	New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
	Write-Host ("download " + $url)
	[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
	Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing
}

# --- what the build has to have produced already -----------------------------

$shellDir = Join-Path $root "window\dist"
Need-File (Join-Path $shellDir "PCBWindow.exe") "run window/build.ps1 first"
Need-File (Join-Path $root "web\dist\index.html") "run npm run build first"

if (Test-Path -LiteralPath $Stage) { Remove-Item -Recurse -Force -LiteralPath $Stage }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

# --- window shell ------------------------------------------------------------

foreach ($name in @(
	"PCBWindow.exe",
	"PCBWindow.exe.config",
	"Microsoft.Web.WebView2.Core.dll",
	"Microsoft.Web.WebView2.WinForms.dll",
	"WebView2Loader.dll"
)) {
	$from = Join-Path $shellDir $name
	Need-File $from "window/dist is incomplete (window/build.ps1 fails on a missing WebView2 dll)"
	Copy-Item -LiteralPath $from -Destination $Stage -Force
}

# --- node.exe ----------------------------------------------------------------

$nodeTarget = Join-Path $Stage "node.exe"
if ($NodeExe) {
	Need-File $NodeExe "the path given to -NodeExe does not exist"
	Copy-Item -LiteralPath $NodeExe -Destination $nodeTarget -Force
} else {
	$nodeCache = Join-Path $cache ("node-v" + $NodeVersion + "-win-x64.exe")
	Get-Cached ("https://nodejs.org/dist/v" + $NodeVersion + "/win-x64/node.exe") $nodeCache

	# The official manifest is the only thing that says this exe is the one nodejs.org built.
	$sums = Join-Path $cache ("node-v" + $NodeVersion + "-SHASUMS256.txt")
	Get-Cached ("https://nodejs.org/dist/v" + $NodeVersion + "/SHASUMS256.txt") $sums
	$want = (Select-String -LiteralPath $sums -Pattern '^([0-9a-f]{64})\s+win-x64/node\.exe$').Matches.Groups[1].Value
	if (-not $want) { throw ("win-x64/node.exe is not listed in " + $sums) }
	$got = Get-Sha256 $nodeCache
	if ($got -ne $want) {
		Remove-Item -LiteralPath $nodeCache -Force
		throw ("node.exe sha256 mismatch: expected " + $want + ", got " + $got)
	}
	Copy-Item -LiteralPath $nodeCache -Destination $nodeTarget -Force
}

# server/main.ts runs directly, which needs Node's built-in type stripping.
$nodeActual = (& $nodeTarget --version).Trim()
if ($LASTEXITCODE -ne 0) { throw ("staged node.exe does not run: " + $nodeTarget) }
Write-Host ("node    " + $nodeActual)

# Node's own licence travels with the binary; take it for the version we actually have.
$licenceTarget = Join-Path $Stage "node-LICENSE.txt"
$licenceCache = Join-Path $cache ("node-" + $nodeActual + "-LICENSE.txt")
Get-Cached ("https://raw.githubusercontent.com/nodejs/node/" + $nodeActual + "/LICENSE") $licenceCache
Copy-Item -LiteralPath $licenceCache -Destination $licenceTarget -Force

# --- omp.exe -----------------------------------------------------------------

$ompTarget = Join-Path $Stage "omp.exe"
if ($OmpExe) {
	Need-File $OmpExe "the path given to -OmpExe does not exist"
	Copy-Item -LiteralPath $OmpExe -Destination $ompTarget -Force
} elseif ($OmpUrl) {
	if (-not $OmpSha256) { throw "-OmpUrl needs -OmpSha256: the download is not trusted without one" }
	$ompCache = Join-Path $cache (Split-Path -Leaf $OmpUrl)
	Get-Cached $OmpUrl $ompCache
	$got = Get-Sha256 $ompCache
	if ($got -ne $OmpSha256.ToLowerInvariant()) {
		Remove-Item -LiteralPath $ompCache -Force
		throw ("omp.exe sha256 mismatch: expected " + $OmpSha256 + ", got " + $got)
	}
	Copy-Item -LiteralPath $ompCache -Destination $ompTarget -Force
} else {
	throw ("omp.exe is required: pass -OmpExe <path>, or set OMP_ASSET_URL and OMP_SHA256 " +
		"(see window/installer/README.md)")
}
$ompActual = (& $ompTarget --version 2>&1 | Select-Object -First 1)
Write-Host ("omp     " + $ompActual)

# --- the app itself ----------------------------------------------------------

foreach ($dir in @("server", "shared")) {
	Copy-Item -LiteralPath (Join-Path $root $dir) -Destination (Join-Path $Stage $dir) -Recurse -Force
}
New-Item -ItemType Directory -Force -Path (Join-Path $Stage "web") | Out-Null
Copy-Item -LiteralPath (Join-Path $root "web\dist") -Destination (Join-Path $Stage "web\dist") -Recurse -Force

foreach ($file in @("package.json", "LICENSE", "NOTICE")) {
	Need-File (Join-Path $root $file) "repository file is missing"
	Copy-Item -LiteralPath (Join-Path $root $file) -Destination $Stage -Force
}

# --- the installer will refuse this tree if anything below is absent ----------

foreach ($rel in @(
	"PCBWindow.exe",
	"node.exe",
	"omp.exe",
	"node-LICENSE.txt",
	"package.json",
	"LICENSE",
	"NOTICE",
	"server\main.ts",
	"shared\protocol.ts",
	"web\dist\index.html"
)) {
	Need-File (Join-Path $Stage $rel) "staged tree is incomplete"
}

$files = Get-ChildItem -LiteralPath $Stage -Recurse -File
$total = ($files | Measure-Object -Property Length -Sum).Sum
Write-Host ""
Write-Host ("stage   " + $Stage)
Write-Host ("        " + $files.Count + " files, " + [math]::Round($total / 1MB, 1) + " MB")
