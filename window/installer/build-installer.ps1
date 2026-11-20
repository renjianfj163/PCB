# Builds one Windows installer for one edition.
#
#   powershell -ExecutionPolicy Bypass -File window/installer/build-installer.ps1 -Edition Desktop
#   powershell -ExecutionPolicy Bypass -File window/installer/build-installer.ps1 -Edition Developer
#
# Inputs : dist/stage/<edition>   (the whole application tree)
# Output : dist/PCB-<version>-<Edition>-windows-x64.exe
#
# Uses the in-box csc.exe (no dotnet SDK), the same way window/build.ps1 does.
# The payload is embedded in the exe as a resource, so the result is a single
# file installer, not a zip with a different extension.

param(
	[Parameter(Mandatory = $true)][ValidateSet("Desktop", "Developer")][string]$Edition,
	[string]$Version = "0.1.0",
	[string]$Stage = "",
	[string]$Out = ""
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent (Split-Path -Parent $here)

if (-not $Stage) { $Stage = Join-Path $root ("dist\stage\" + $Edition.ToLower()) }
if (-not $Out) { $Out = Join-Path $root ("dist\PCB-" + $Version + "-" + $Edition + "-windows-x64.exe") }

if (-not (Test-Path -LiteralPath (Join-Path $Stage "PCBWindow.exe"))) {
	throw ("missing " + $Stage + "\PCBWindow.exe - stage the app tree first")
}

$build = Join-Path $root "window\installer\.build"
New-Item -ItemType Directory -Force -Path $build | Out-Null

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $csc)) { throw "csc.exe not found (.NET Framework 4.8 in-box compiler)" }

# meta.txt travels inside the installer: it is the only difference between builds.
$appName = "PCB " + $Edition
$registryKey = "PCB-" + $Edition
$meta = Join-Path $build "meta.txt"
@(("AppName=" + $appName), ("RegistryKey=" + $registryKey), ("Version=" + $Version)) | Set-Content -LiteralPath $meta -Encoding ASCII

# The uninstaller is small and identical for both editions.
$uninstall = Join-Path $build "uninstall.exe"
& $csc /nologo /target:winexe /platform:x64 /optimize+ ("/out:" + $uninstall) /r:System.dll /r:System.Windows.Forms.dll (Join-Path $here "Uninstall.cs") | Out-Null
if ($LASTEXITCODE -ne 0) { throw ("uninstall.exe failed: csc exit " + $LASTEXITCODE) }

# Payload: the staged tree, zipped (bsdtar ships with Windows 10+).
$payload = Join-Path $build ("payload-" + $Edition.ToLower() + ".zip")
if (Test-Path -LiteralPath $payload) { Remove-Item -LiteralPath $payload -Force }
& tar -a -cf $payload -C $Stage .
if ($LASTEXITCODE -ne 0) { throw ("payload zip failed: tar exit " + $LASTEXITCODE) }
Write-Host ("payload: {0:N1} MB" -f ((Get-Item -LiteralPath $payload).Length / 1MB))

& $csc /nologo /target:winexe /platform:x64 /optimize+ ("/out:" + $Out) /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll ("/resource:" + $payload + ",payload.zip") ("/resource:" + $meta + ",meta.txt") ("/resource:" + $uninstall + ",uninstall.exe") (Join-Path $here "Installer.cs")
if ($LASTEXITCODE -ne 0) { throw ("installer failed: csc exit " + $LASTEXITCODE) }

$exe = Get-Item -LiteralPath $Out
Write-Host ("installer: " + $exe.FullName + " ({0:N1} MB)" -f ($exe.Length / 1MB))
