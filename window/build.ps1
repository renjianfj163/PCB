# Builds window/PCBWindow.exe with the in-box .NET Framework compiler.
#
# No dotnet SDK, no nuget.exe: the Microsoft.Web.WebView2 nupkg is downloaded
# straight from nuget.org and unpacked here, and WebView2Loader.dll (x64) is
# copied next to the exe. Output: window/dist.
#
#   powershell -ExecutionPolicy Bypass -File window\build.ps1
#   powershell -ExecutionPolicy Bypass -File window\build.ps1 -Clean

[CmdletBinding()]
param(
	[string]$SdkVersion = "1.0.4314.35",
	[switch]$Clean
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$build = Join-Path $here ".build"
$dist = Join-Path $here "dist"
$cache = Join-Path $build "cache"
$sdkDir = Join-Path $build "sdk"

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $csc)) {
	throw "找不到 .NET Framework 编译器：$csc（这台机器没有 dotnet SDK，脚本只用系统自带的那一个）"
}

if ($Clean -and (Test-Path -LiteralPath $dist)) {
	Remove-Item -Recurse -Force -LiteralPath $dist
}
if ($Clean -and (Test-Path -LiteralPath $sdkDir)) {
	Remove-Item -Recurse -Force -LiteralPath $sdkDir
}
New-Item -ItemType Directory -Force -Path $build, $dist, $cache | Out-Null

# --- WebView2 SDK -----------------------------------------------------------

$nupkg = Join-Path $cache "microsoft.web.webview2.$SdkVersion.nupkg"
if (-not (Test-Path -LiteralPath $nupkg)) {
	$url = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$SdkVersion/microsoft.web.webview2.$SdkVersion.nupkg"
	Write-Host "下载 WebView2 SDK $SdkVersion"
	[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
	Invoke-WebRequest -Uri $url -OutFile $nupkg -UseBasicParsing
}

if (-not (Test-Path -LiteralPath (Join-Path $sdkDir "lib"))) {
	Write-Host "解出 SDK"
	$zip = Join-Path $build "sdk.zip"
	Copy-Item -LiteralPath $nupkg -Destination $zip -Force
	Expand-Archive -LiteralPath $zip -DestinationPath $sdkDir -Force
	Remove-Item -LiteralPath $zip -Force
}

$libDir = Join-Path $sdkDir "lib/net462"
if (-not (Test-Path -LiteralPath $libDir)) { $libDir = Join-Path $sdkDir "lib/net45" }
if (-not (Test-Path -LiteralPath $libDir)) {
	throw "这个 SDK 包里没有 .NET Framework 的 lib/net462 或 lib/net45：$sdkDir"
}

$core = Join-Path $libDir "Microsoft.Web.WebView2.Core.dll"
$winForms = Join-Path $libDir "Microsoft.Web.WebView2.WinForms.dll"
$loader = Join-Path $sdkDir "runtimes/win-x64/native/WebView2Loader.dll"
foreach ($needed in @($core, $winForms, $loader)) {
	if (-not (Test-Path -LiteralPath $needed)) { throw "SDK 包里缺文件：$needed" }
}

# --- icon --------------------------------------------------------------------
#
# Explorer and the shortcuts draw an icon; the window itself draws its own. One
# blue square with a white P, made once into window/.build/pcb.ico.

$iconPath = Join-Path $build "pcb.ico"
if (-not (Test-Path -LiteralPath $iconPath)) {
	Write-Host "画窗口图标"
	Add-Type -AssemblyName System.Drawing
	$bitmap = New-Object System.Drawing.Bitmap 64, 64
	$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
	$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
	$graphics.Clear([System.Drawing.Color]::FromArgb(255, 37, 99, 235))
	$font = New-Object System.Drawing.Font("Segoe UI", 40, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
	$format = New-Object System.Drawing.StringFormat
	$format.Alignment = [System.Drawing.StringAlignment]::Center
	$format.LineAlignment = [System.Drawing.StringAlignment]::Center
	$rect = New-Object System.Drawing.RectangleF 0, 0, 64, 64
	$graphics.DrawString("P", $font, [System.Drawing.Brushes]::White, $rect, $format)
	$graphics.Dispose()
	$handle = $bitmap.GetHicon()
	$icon = [System.Drawing.Icon]::FromHandle($handle)
	$stream = [System.IO.File]::Create($iconPath)
	$icon.Save($stream)
	$stream.Close()
	$icon.Dispose()
	$bitmap.Dispose()
}

# --- compile ----------------------------------------------------------------

$frameworkDir = Split-Path -Parent $csc
$exe = Join-Path $dist "PCBWindow.exe"
$argv = @(
	"/nologo",
	"/target:winexe",
	"/platform:x64",
	"/optimize+",
	"/warn:4",
	("/win32icon:" + $iconPath),
	"/out:$exe"
)
foreach ($name in @("System.dll", "System.Core.dll", "System.Drawing.dll", "System.Windows.Forms.dll")) {
	$argv += "/r:$(Join-Path $frameworkDir $name)"
}
$argv += "/r:$core"
$argv += "/r:$winForms"
foreach ($file in Get-ChildItem -LiteralPath (Join-Path $here "src") -Filter *.cs | Sort-Object Name) {
	$argv += $file.FullName
}

Write-Host "编译 PCBWindow.exe"
& $csc @argv
if ($LASTEXITCODE -ne 0) { throw "csc 失败，退出码 $LASTEXITCODE" }

# --- everything the exe needs next to it ------------------------------------

Copy-Item -LiteralPath $core -Destination $dist -Force
Copy-Item -LiteralPath $winForms -Destination $dist -Force
Copy-Item -LiteralPath $loader -Destination $dist -Force
Copy-Item -LiteralPath (Join-Path $here "PCBWindow.exe.config") -Destination $dist -Force

$exe = Join-Path $dist "PCBWindow.exe"
Write-Host ""
Write-Host ("exe    " + $exe + "  (" + [math]::Round((Get-Item -LiteralPath $exe).Length / 1kb, 1) + " KB)")
foreach ($file in Get-ChildItem -LiteralPath $dist | Sort-Object Name) {
	Write-Host ("       " + $file.Name)
}
Write-Host ""
Write-Host ("运行：" + $exe)
