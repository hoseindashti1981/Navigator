$ErrorActionPreference = 'Stop'
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$release = Join-Path $project 'release'
$stage = Join-Path $release 'navigator'
if (Test-Path -LiteralPath $stage) {
    $resolvedStage = [IO.Path]::GetFullPath($stage)
    if (-not $resolvedStage.StartsWith($project + [IO.Path]::DirectorySeparatorChar)) { throw 'مسیر بسته معتبر نیست.' }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stage, (Join-Path $stage 'private') | Out-Null
Copy-Item -LiteralPath (Join-Path $project 'public') -Destination $stage -Recurse
Copy-Item -LiteralPath (Join-Path $project 'database') -Destination $stage -Recurse
Copy-Item -LiteralPath (Join-Path $project 'docs') -Destination $stage -Recurse
foreach ($file in 'bootstrap.php','config.example.php','.htaccess') {
    Copy-Item -LiteralPath (Join-Path $project "private/$file") -Destination (Join-Path $stage 'private')
}
Copy-Item -LiteralPath (Join-Path $project 'README.md') -Destination $stage
$archive = Join-Path $release 'navigator-hosting.zip'
# .NET includes dotfiles such as .htaccess (Compress-Archive may omit hidden files).
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $archive)
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
    if ($zip.Entries.FullName -contains 'private/config.php') { throw 'فایل خصوصی وارد بسته شده است.' }
    foreach ($required in 'public/.htaccess','private/.htaccess','public/api.php','database/schema.sql','public/assets/vendor/Vazirmatn.woff2') {
        if ($zip.Entries.FullName -notcontains $required) { throw "فایل بسته موجود نیست: $required" }
    }
    Write-Output "بسته آماده شد: $archive"
    Write-Output "تعداد فایل‌ها: $($zip.Entries.Count)"
} finally { $zip.Dispose() }
