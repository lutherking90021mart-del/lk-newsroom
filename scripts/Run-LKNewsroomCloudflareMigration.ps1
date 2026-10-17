[CmdletBinding()]
param(
    [string]$BackupPath = (Join-Path $env:USERPROFILE 'Desktop\LK-Newsroom-Complete-Backup'),
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$DatabaseName = 'lk-newsroom-db'
$WorkerBinding = 'DB'
$FreePlanSafetyLimitBytes = 450MB
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Builder = Join-Path $RepoRoot 'scripts\buildCloudflareImport.py'
$SchemaFile = Join-Path $RepoRoot 'cloudflare\schema.sql'
$OperationsSchemaFile = Join-Path $RepoRoot 'cloudflare\schema-operations.sql'
$WranglerConfig = Join-Path $RepoRoot 'wrangler.jsonc'

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host ('=== ' + $Message + ' ===') -ForegroundColor Cyan
}

function Get-NpxPath {
    $command = Get-Command 'npx.cmd' -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $command = Get-Command 'npx' -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw 'Node.js/npx was not found. Install Node.js 20 or newer, reopen PowerShell, and run this script again.'
}

$script:NpxPath = Get-NpxPath

function Invoke-NpxCapture([string[]]$NpxArguments) {
    $output = & $script:NpxPath @NpxArguments 2>&1 | Out-String
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        throw ("Command failed (exit " + $code + "): npx " + ($NpxArguments -join ' ') + [Environment]::NewLine + $output)
    }
    return $output
}

function Invoke-NpxLive([string[]]$NpxArguments) {
    & $script:NpxPath @NpxArguments
    if ($LASTEXITCODE -ne 0) {
        throw ("Command failed (exit " + $LASTEXITCODE + "): npx " + ($NpxArguments -join ' '))
    }
}

function ConvertFrom-ToolJson([string]$Output) {
    $arrayStart = $Output.IndexOf('[')
    $objectStart = $Output.IndexOf('{')
    $starts = @($arrayStart, $objectStart) | Where-Object { $_ -ge 0 } | Sort-Object
    if (-not $starts) { throw ('Could not find JSON in tool output: ' + $Output) }
    $start = [int]$starts[0]
    $open = $Output[$start]
    $end = if ($open -eq '[') { $Output.LastIndexOf(']') } else { $Output.LastIndexOf('}') }
    if ($end -lt $start) { throw ('Incomplete JSON from Cloudflare CLI: ' + $Output) }
    return ConvertFrom-Json -InputObject $Output.Substring($start, $end - $start + 1)
}

function Get-D1List {
    $raw = Invoke-NpxCapture @('wrangler', 'd1', 'list', '--json')
    $parsed = ConvertFrom-ToolJson $raw
    if ($parsed -is [System.Array]) { return @($parsed) }
    if ($parsed.result) { return @($parsed.result) }
    return @($parsed)
}

function Get-D1Id($DatabaseObject) {
    foreach ($field in @('uuid', 'database_id', 'id')) {
        $property = $DatabaseObject.PSObject.Properties[$field]
        if ($property -and $property.Value) { return [string]$property.Value }
    }
    return $null
}

function Set-DatabaseId([string]$Id) {
    $config = Get-Content -LiteralPath $WranglerConfig -Raw | ConvertFrom-Json
    $binding = @($config.d1_databases | Where-Object { $_.binding -eq $WorkerBinding } | Select-Object -First 1)
    if (-not $binding -or $binding.Count -eq 0) {
        throw "wrangler.jsonc has no D1 binding named '$WorkerBinding'. No deployment was attempted."
    }
    $binding[0] | Add-Member -NotePropertyName 'database_id' -NotePropertyValue $Id -Force
    $json = $config | ConvertTo-Json -Depth 30
    [System.IO.File]::WriteAllText($WranglerConfig, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
}

function Invoke-D1Query([string]$Sql) {
    $raw = Invoke-NpxCapture @('wrangler', 'd1', 'execute', $DatabaseName, '--remote', '--json', '--command', $Sql)
    $parsed = ConvertFrom-ToolJson $raw
    $sets = if ($parsed -is [System.Array]) { @($parsed) } elseif ($parsed.result) { @($parsed.result) } else { @($parsed) }
    foreach ($set in $sets) {
        if ($set.results -and $set.results.Count -gt 0) { return $set.results[0] }
        if ($set.result -and $set.result.results -and $set.result.results.Count -gt 0) { return $set.result.results[0] }
    }
    throw ('Cloudflare returned no SQL result rows. Output: ' + $raw)
}

function Invoke-PythonPreflight([string]$SqlPath, [string]$ReportPath) {
    $python = Get-Command 'py' -ErrorAction SilentlyContinue
    $pythonMode = @('-3')
    if (-not $python) {
        $python = Get-Command 'python' -ErrorAction SilentlyContinue
        $pythonMode = @()
    }
    if (-not $python) { throw 'Python 3 was not found. Install Python 3, then rerun this script.' }

    $helperPath = Join-Path $env:TEMP ('lk-newsroom-d1-preflight-' + [guid]::NewGuid().ToString('N') + '.py')
    $helper = @'
import json, shutil, sqlite3, sys, tempfile
from pathlib import Path

schema_path, operations_path, import_path = map(Path, sys.argv[1:4])
work = Path(tempfile.mkdtemp(prefix="lk-newsroom-d1-preflight-"))
db_path = work / "preflight.sqlite"
try:
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA foreign_keys=OFF")
    conn.executescript(schema_path.read_text(encoding="utf-8-sig"))
    conn.executescript(operations_path.read_text(encoding="utf-8-sig"))
    conn.executescript(import_path.read_text(encoding="utf-8-sig"))
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    counts = {}
    for table in ("articles", "article_tags", "social_graphics", "social_posts", "live_updates", "tags"):
        if table in tables:
            counts[table] = conn.execute('SELECT COUNT(*) FROM "' + table + '"').fetchone()[0]
    page_count = conn.execute("PRAGMA page_count").fetchone()[0]
    page_size = conn.execute("PRAGMA page_size").fetchone()[0]
    size_bytes = int(page_count * page_size)
    conn.close()
    payload = {"counts": counts, "estimated_sqlite_bytes": size_bytes, "estimated_sqlite_mib": round(size_bytes / (1024 * 1024), 2)}
    print(json.dumps(payload))
    if counts.get("articles") != 21191:
        print("STOP: expected exactly 21,191 imported articles.", file=sys.stderr)
        sys.exit(3)
    if size_bytes > 450 * 1024 * 1024:
        print("STOP: local database estimate is above the 450 MiB safety margin for Cloudflare D1 Free.", file=sys.stderr)
        sys.exit(4)
except Exception as exc:
    print("Local SQLite preflight failed: " + str(exc), file=sys.stderr)
    sys.exit(2)
finally:
    shutil.rmtree(work, ignore_errors=True)
'@
    [System.IO.File]::WriteAllText($helperPath, $helper, [System.Text.UTF8Encoding]::new($false))
    try {
        $raw = & $python.Source @pythonMode $helperPath $SchemaFile $OperationsSchemaFile $SqlPath 2>&1 | Out-String
        $code = $LASTEXITCODE
        if ($code -ne 0) { throw ('Local import preflight failed. No remote database changes were made.' + [Environment]::NewLine + $raw) }
        $parsed = ConvertFrom-ToolJson $raw
        $script:PreflightCounts = $parsed.counts
        $script:PreflightSizeMiB = $parsed.estimated_sqlite_mib
        Write-Host ('Local SQLite estimate: ' + $parsed.estimated_sqlite_mib + ' MiB') -ForegroundColor Green
        foreach ($key in $parsed.counts.PSObject.Properties.Name) {
            Write-Host ('  ' + $key + ': ' + $parsed.counts.$key)
        }
    }
    finally {
        Remove-Item -LiteralPath $helperPath -Force -ErrorAction SilentlyContinue
    }
}

Write-Host 'LK Newsroom: Supabase CSV exports to Cloudflare D1 + Workers preview' -ForegroundColor Cyan
Write-Host 'This script never deletes Supabase data, local CSVs, or previous backups.'
Write-Host 'It does not change lknewsroom.online DNS.'
Write-Host ('Repository: ' + $RepoRoot)
Write-Host ('Backup folder: ' + $BackupPath)

if (-not (Test-Path -LiteralPath $BackupPath -PathType Container)) {
    throw "Backup folder not found: $BackupPath. Keep the folder name LK-Newsroom-Complete-Backup and rerun with -BackupPath if needed."
}
foreach ($required in @($Builder, $SchemaFile, $OperationsSchemaFile, $WranglerConfig)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required repository file is missing: $required" }
}

Write-Step '1/5 Prepare the D1 import from your saved CSV files'
$pythonCommand = Get-Command 'py' -ErrorAction SilentlyContinue
if ($pythonCommand) {
    & $pythonCommand.Source -3 $Builder $BackupPath
} else {
    $pythonCommand = Get-Command 'python' -ErrorAction SilentlyContinue
    if (-not $pythonCommand) { throw 'Python 3 was not found. Install Python 3 and try again.' }
    & $pythonCommand.Source $Builder $BackupPath
}
if ($LASTEXITCODE -ne 0) { throw 'CSV-to-D1 conversion failed. No Cloudflare database changes were made.' }

$SqlPath = Join-Path $BackupPath 'cloudflare-d1-core-import.sql'
$ReportPath = Join-Path $BackupPath 'cloudflare-d1-import-report.txt'
if (-not (Test-Path -LiteralPath $SqlPath -PathType Leaf)) { throw "Generated SQL was not found: $SqlPath" }
if (-not (Test-Path -LiteralPath $ReportPath -PathType Leaf)) { throw "Import report was not found: $ReportPath" }

$report = Get-Content -LiteralPath $ReportPath -Raw
$warningMatch = [regex]::Match($report, '(?s)Warnings:\s*(.*?)(?:\r?\nIMPORTANT:|$)')
if ($warningMatch.Success) {
    $warningText = $warningMatch.Groups[1].Value.Trim()
    if ($warningText -and $warningText -ne 'No row conversion warnings detected.') {
        Write-Host $warningText -ForegroundColor Yellow
        throw 'The converter reported row warnings. Review cloudflare-d1-import-report.txt before any remote import. Nothing in Cloudflare was changed.'
    }
}

$sqlInfo = Get-Item -LiteralPath $SqlPath
Write-Host ('Import file: ' + $SqlPath)
Write-Host ('Import SQL size: ' + $sqlInfo.Length.ToString('N0') + ' bytes')
Write-Host ('Report: ' + $ReportPath)

Write-Step '2/5 Validate the complete import locally before uploading'
Invoke-PythonPreflight $SqlPath $ReportPath

if (-not $Apply) {
    Write-Host ''
    Write-Host 'DRY RUN COMPLETE. No login, Cloudflare database creation, upload, deployment, or DNS changes were performed.' -ForegroundColor Green
    Write-Host 'Review cloudflare-d1-import-report.txt. If it lists the correct 21,191 articles and no warnings, run this same script with -Apply to create/import D1 and deploy a workers.dev preview.'
    exit 0
}

Write-Host ''
Write-Host 'This will create or use a database named lk-newsroom-db, import the active newsroom data, and deploy a workers.dev preview.' -ForegroundColor Yellow
Write-Host 'It does not switch the production domain or delete Supabase/local backup data.' -ForegroundColor Yellow
$confirmation = Read-Host 'Type MIGRATE to continue'
if ($confirmation -cne 'MIGRATE') { throw 'Cancelled by user. No remote changes were made.' }

Write-Step '3/5 Install dependencies and prepare the preview build before remote changes'
if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'node_modules'))) {
    $npmCommand = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
    if (-not $npmCommand) { $npmCommand = Get-Command 'npm' -ErrorAction SilentlyContinue }
    if (-not $npmCommand) { throw 'npm was not found. Install Node.js 20 or newer, then rerun this script.' }
    & $npmCommand.Source 'ci'
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed. No Cloudflare changes were made.' }
}
$nodeCommand = Get-Command 'node' -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js was not found. No Cloudflare changes were made.' }
& $nodeCommand.Source 'scripts/buildCloudflareAssets.mjs'
if ($LASTEXITCODE -ne 0) { throw 'The Cloudflare asset build failed. No Cloudflare changes were made.' }

Write-Step '4/5 Sign in to Cloudflare and prepare D1'
$whoOutput = & $script:NpxPath wrangler whoami 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Complete the Cloudflare sign-in that opens in your browser.' -ForegroundColor Yellow
    Invoke-NpxLive @('wrangler', 'login')
    Invoke-NpxCapture @('wrangler', 'whoami') | Out-Null
} else {
    Write-Host $whoOutput.Trim()
}

$dbs = Get-D1List
$db = @($dbs | Where-Object { $_.name -eq $DatabaseName -or $_.database_name -eq $DatabaseName } | Select-Object -First 1)
if (-not $db -or $db.Count -eq 0) {
    Write-Host 'Creating a new D1 database in Western Europe...'
    Invoke-NpxLive @('wrangler', 'd1', 'create', $DatabaseName, '--location', 'weur', '--update-config', '--binding', $WorkerBinding)
    $dbs = Get-D1List
    $db = @($dbs | Where-Object { $_.name -eq $DatabaseName -or $_.database_name -eq $DatabaseName } | Select-Object -First 1)
}
if (-not $db -or $db.Count -eq 0) { throw 'Could not find lk-newsroom-db after creation. No DNS change was made.' }
$databaseId = Get-D1Id $db[0]
if (-not $databaseId) { throw 'Cloudflare did not return a D1 database ID. No import or DNS change was made.' }
Set-DatabaseId $databaseId
Write-Host ('D1 database found: ' + $DatabaseName + ' (' + $databaseId + ')') -ForegroundColor Green

$tableResult = Invoke-D1Query "SELECT COUNT(*) AS table_count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%';"
$tableCount = [int]$tableResult.table_count

Write-Step '5/5 Import or resume the D1 migration, then deploy the preview'
if ($tableCount -eq 0) {
    Write-Host 'D1 is empty. Initializing schema and importing the verified CSV export.'
    Invoke-NpxLive @('wrangler', 'd1', 'execute', $DatabaseName, '--remote', '--file', $SchemaFile, '--yes')
    Invoke-NpxLive @('wrangler', 'd1', 'execute', $DatabaseName, '--remote', '--file', $OperationsSchemaFile, '--yes')
    Invoke-NpxLive @('wrangler', 'd1', 'execute', $DatabaseName, '--remote', '--file', $SqlPath, '--yes')
} else {
    Write-Host "D1 already has $tableCount tables. Checking whether this is a completed prior import; no existing tables will be dropped."
}

$countResult = Invoke-D1Query "SELECT (SELECT COUNT(*) FROM articles) AS articles, (SELECT COUNT(*) FROM social_graphics) AS social_graphics, (SELECT COUNT(*) FROM article_tags) AS article_tags, (SELECT COUNT(*) FROM social_posts) AS social_posts;"
Write-Host ('Verified D1 counts: ' + ($countResult | ConvertTo-Json -Compress)) -ForegroundColor Green
if ([int]$countResult.articles -ne 21191) {
    throw 'Remote D1 does not contain exactly 21,191 articles. The runner will not deploy or overwrite this database. Keep all backups and contact me with the error.'
}
foreach ($tableName in @('social_graphics', 'article_tags', 'social_posts')) {
    $expected = $script:PreflightCounts.$tableName
    if ($null -ne $expected -and [int]$countResult.$tableName -ne [int]$expected) {
        throw "Remote D1 $tableName count differs from the locally validated import. Deployment stopped; no data was deleted."
    }
}

Invoke-NpxLive @('wrangler', 'deploy')

Write-Host ''
Write-Host 'PREVIEW DEPLOYMENT COMMAND FINISHED.' -ForegroundColor Green
Write-Host 'Copy the *.workers.dev URL printed above and open it. Test /v1/news?limit=5 and the homepage.'
Write-Host 'The 5-minute feed schedule is configured in wrangler.jsonc. Allow a few minutes for the first scheduled import.'
Write-Host 'IMPORTANT: this migration imports database rows, not Supabase Storage binary files. Some old Supabase-hosted images may remain unavailable until the media is recovered/re-cached. DNS was not changed; local backups and Supabase data were not deleted.'
