param([switch]$Publish)
$ErrorActionPreference = 'Stop'
$projectFile = Join-Path $PSScriptRoot 'OrbMusic.Windows.csproj'

$dotnet = $null
$installedForOrb = Join-Path $env:LOCALAPPDATA 'OrbTools\dotnet\dotnet.exe'
if (Test-Path $installedForOrb) {
    $dotnet = $installedForOrb
} elseif (Get-Command dotnet -ErrorAction SilentlyContinue) {
    $dotnet = (Get-Command dotnet).Source
} elseif (Test-Path 'C:\Program Files\dotnet\dotnet.exe') {
    $dotnet = 'C:\Program Files\dotnet\dotnet.exe'
}
if (-not $dotnet -or -not ((& $dotnet --list-sdks) -match '^(8|9|10)\.')) {
    throw 'Instale o SDK .NET 8 ou superior para Windows (x64) antes de compilar.'
}

& $dotnet restore $projectFile
if ($LASTEXITCODE -ne 0) { throw 'Falha no restore.' }

if ($Publish) {
    & $dotnet publish $projectFile -c Release -r win-x64 --self-contained true -p:WindowsAppSDKSelfContained=true -o (Join-Path $PSScriptRoot 'publish')
    if ($LASTEXITCODE -ne 0) { throw 'Falha no publish.' }
    Write-Host 'Aplicativo gerado em:' (Join-Path $PSScriptRoot 'publish')
} else {
    & $dotnet build $projectFile -c Release
    if ($LASTEXITCODE -ne 0) { throw 'Falha no build.' }
}
