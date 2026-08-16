$ErrorActionPreference = "Stop"

$requiredFiles = @{
    "index.html" = 30000
    "assets/css/styles.css" = 50000
    "assets/js/app.js" = 60000
    "assets/js/modules/i18n.js" = 35000
    "assets/js/data/languages.js" = 7000
    "music.mp3" = 8000000
    "assets/images/polyglow-garden-bg.png" = 1500000
    "assets/images/polyglow-lotus-3d.png" = 1500000
    "assets/images/polyglow-bamboo-lotus-welcome.png" = 1500000
    "assets/flags/4x3/gb.svg" = 400
    "assets/flags/4x3/us.svg" = 500
    "assets/flags/4x3/il.svg" = 700
}

$failed = $false

foreach ($entry in $requiredFiles.GetEnumerator()) {
    $path = Join-Path $PSScriptRoot $entry.Key
    if (-not (Test-Path -LiteralPath $path)) {
        Write-Host "MISSING  $($entry.Key)" -ForegroundColor Red
        $failed = $true
        continue
    }

    $size = (Get-Item -LiteralPath $path).Length
    if ($size -lt $entry.Value) {
        Write-Host "TRUNCATED?  $($entry.Key): $size bytes" -ForegroundColor Red
        $failed = $true
    } else {
        Write-Host "OK  $($entry.Key): $size bytes" -ForegroundColor Green
    }
}

$flagCount = (Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot "assets/flags/4x3") -Filter "*.svg" -File).Count
if ($flagCount -lt 270) {
    Write-Host "MISSING FLAGS  Found only $flagCount SVG files" -ForegroundColor Red
    $failed = $true
} else {
    Write-Host "OK  Flag collection: $flagCount SVG files" -ForegroundColor Green
}

if ($failed) {
    throw "Polyglow file verification failed. Do not publish this copy."
}

Write-Host "Polyglow files are complete and ready for Git." -ForegroundColor Cyan
