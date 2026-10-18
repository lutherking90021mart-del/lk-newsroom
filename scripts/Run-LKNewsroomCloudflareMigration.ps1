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
$Splitter = Join-Path $RepoRoot 'scripts\splitCloudflareD1Import.py'
$WranglerConfig = Join-Path $RepoRoot 'wrangler.jsonc'
$ProgressPath = Join-Path $BackupPath 'cloudflare-d1-migration-progress.json'
$ImportBatchSize = 30000
$DailyWriteBudget = 60000

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

function Invoke-NpxCapture([string[]]$NpxArguments, [switch]$AllowNonZero) {
    # Native npm/npx commands can emit harmless cleanup warnings on stderr.
    # With ErrorActionPreference=Stop, PowerShell may otherwise terminate before
    # the native exit code can be examined.
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & $script:NpxPath @NpxArguments 2>&1 | Out-String
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($code -ne 0 -and -not $AllowNonZero) {
        throw ("Command failed (exit " + $code + "): npx " + ($NpxArguments -join ' ') + [Environment]::NewLine + $output)
    }
    return $output
}

function Invoke-NpxLive([string[]]$NpxArguments) {
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $script:NpxPath @NpxArguments
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($code -ne 0) {
        throw ("Command failed (exit " + $code + "): npx " + ($NpxArguments -join ' '))
    }
}

function ConvertFrom-ToolJson([string]$Output) {
    $arrayStart = $Output.IndexOf('[')
    $objectStart = $Output.IndexOf('{')
    $starts = @($arrayStart, $objectStart) | Where-Object { $_ -ge 0 } | Sort-Object
    if ($starts.Count -eq 0) { throw ('Could not find JSON in tool output: ' + $Output) }
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

function Save-MigrationProgress($Progress) {
    $json = ConvertTo-Json -InputObject $Progress -Depth 20
    $tmp = $ProgressPath + '.tmp'
    [System.IO.File]::WriteAllText($tmp, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $tmp -Destination $ProgressPath -Force
}

function Wait-ForNextUtcDay {
    $resumeAt = [DateTime]::UtcNow.Date.AddDays(1).AddMinutes(5)
    Write-Host ''
    Write-Host 'The safe daily import budget has been used. Progress is saved locally.' -ForegroundColor Yellow
    Write-Host ('Next batch will resume automatically at ' + $resumeAt.ToString('yyyy-MM-dd HH:mm') + ' UTC.') -ForegroundColor Yellow
    Write-Host 'Keep this PowerShell process and the internet connection running. If Windows restarts, rerun the same command with -Apply; it will resume from the saved checkpoint.' -ForegroundColor Yellow
    while ([DateTime]::UtcNow -lt $resumeAt) {
        $remaining = $resumeAt - [DateTime]::UtcNow
        Write-Host ('Resuming in approximately ' + [int][Math]::Ceiling($remaining.TotalHours) + ' hour(s).')
        $sleepSeconds = [Math]::Min(300, [Math]::Max(15, [int]$remaining.TotalSeconds))
        Start-Sleep -Seconds $sleepSeconds
    }
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
import json, re, shutil, sqlite3, sys, tempfile
from pathlib import Path

schema_path, operations_path, import_path = map(Path, sys.argv[1:4])
work = Path(tempfile.mkdtemp(prefix="lk-newsroom-d1-preflight-"))
db_path = work / "preflight.sqlite"
index_pattern = re.compile(r"(?im)^[ \t]*CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+[^;]+;")
try:
    print("Starting fast local SQLite preflight; no Cloudflare writes are involved.", flush=True)
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=OFF")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA cache_size=-32768")
    conn.execute("PRAGMA mmap_size=268435456")
    conn.execute("PRAGMA foreign_keys=OFF")

    indexes = []
    for schema_file in (schema_path, operations_path):
        sql = schema_file.read_text(encoding="utf-8-sig")
        indexes.extend(index_pattern.findall(sql))
        sql = index_pattern.sub("", sql)
        conn.executescript(sql)
    print("Schemas loaded. Importing SQL in batches with progress messages...", flush=True)

    statements = 0
    bytes_read = 0
    conn.execute("BEGIN")
    try:
        pending = []
        with import_path.open("r", encoding="utf-8-sig", newline="") as sql_file:
            for line in sql_file:
                if not pending and (not line.strip() or line.lstrip().startswith("--")):
                    continue
                pending.append(line)
                bytes_read += len(line.encode("utf-8"))
                statement = "".join(pending)
                if sqlite3.complete_statement(statement):
                    sql = statement.strip()
                    if sql and not sql.startswith("--"):
                        conn.execute(sql)
                        statements += 1
                        if statements % 10000 == 0:
                            print(f"Validated {statements:,} SQL statements ({bytes_read / (1024 * 1024):.1f} MiB read)...", flush=True)
                    pending.clear()
        if pending:
            tail = "".join(pending).strip()
            if tail and not tail.startswith("--"):
                raise RuntimeError("The import SQL ended with an incomplete SQL statement.")
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    print(f"Imported {statements:,} SQL statements. Rebuilding {len(indexes)} indexes...", flush=True)
    for number, statement in enumerate(indexes, start=1):
        conn.execute(statement)
        print(f"Index {number}/{len(indexes)} ready.", flush=True)

    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    counts = {}
    for table in ("articles", "article_tags", "social_graphics", "social_posts", "live_updates", "tags"):
        if table in tables:
            counts[table] = conn.execute('SELECT COUNT(*) FROM "' + table + '"').fetchone()[0]
    page_count = conn.execute("PRAGMA page_count").fetchone()[0]
    page_size = conn.execute("PRAGMA page_size").fetchone()[0]
    size_bytes = int(page_count * page_size)
    conn.close()
    payload = {"counts": counts, "estimated_sqlite_bytes": size_bytes, "estimated_sqlite_mib": round(size_bytes / (1024 * 1024), 2), "validated_sql_statements": statements}
    print(json.dumps(payload), flush=True)
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
    try:
        conn.close()
    except Exception:
        pass
    shutil.rmtree(work, ignore_errors=True)
'@
    [System.IO.File]::WriteAllText($helperPath, $helper, [System.Text.UTF8Encoding]::new($false))
    try {
        $null = & $python.Source @pythonMode $helperPath $SchemaFile $OperationsSchemaFile $SqlPath 2>&1 | Tee-Object -Variable rawLines
        $code = $LASTEXITCODE
        $raw = @($rawLines) -join [Environment]::NewLine
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
foreach ($required in @($Builder, $Splitter, $SchemaFile, $OperationsSchemaFile, $WranglerConfig)) {
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

Write-Step '3/6 Prepare resumable SQL batches before touching Cloudflare'
$sourceHash = (Get-FileHash -LiteralPath $SqlPath -Algorithm SHA256).Hash.ToLowerInvariant()
$progress = $null
$batchDirectory = $null
if (Test-Path -LiteralPath $ProgressPath -PathType Leaf) {
    $progress = Get-Content -LiteralPath $ProgressPath -Raw | ConvertFrom-Json
    if ($progress.SourceSqlSha256 -ne $sourceHash) {
        throw 'The generated SQL changed after a migration checkpoint was saved. To protect the existing D1 data, the runner stopped. Do not delete the checkpoint or rerun with a different import file.'
    }
    $batchDirectory = [string]$progress.BatchDirectory
    if (-not (Test-Path -LiteralPath (Join-Path $batchDirectory 'manifest.json') -PathType Leaf)) {
        throw "The saved batch manifest is missing from $batchDirectory. No remote changes were made."
    }
    $manifest = Get-Content -LiteralPath (Join-Path $batchDirectory 'manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.source_sha256 -ne $sourceHash) { throw 'The batch manifest does not match the currently validated import SQL.' }
    Write-Host ('Resuming saved D1 migration at batch ' + $progress.NextBatch + ' of ' + $progress.TotalBatches + '.') -ForegroundColor Green
} else {
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,6)
    $batchDirectory = Join-Path $BackupPath ('cloudflare-d1-batches-' + $stamp)
    $pythonLauncher = Get-Command 'py' -ErrorAction SilentlyContinue
    if ($pythonLauncher) {
        $splitOutput = & $pythonLauncher.Source -3 $Splitter $SqlPath $batchDirectory --batch-size $ImportBatchSize 2>&1 | Out-String
    } else {
        $pythonLauncher = Get-Command 'python' -ErrorAction SilentlyContinue
        if (-not $pythonLauncher) { throw 'Python 3 was not found. No Cloudflare changes were made.' }
        $splitOutput = & $pythonLauncher.Source $Splitter $SqlPath $batchDirectory --batch-size $ImportBatchSize 2>&1 | Out-String
    }
    $splitExitCode = $LASTEXITCODE
    if ($splitExitCode -ne 0) { throw ('Could not split SQL safely. No Cloudflare changes were made.' + [Environment]::NewLine + $splitOutput) }
    $manifest = Get-Content -LiteralPath (Join-Path $batchDirectory 'manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.source_sha256 -ne $sourceHash) { throw 'Generated batch manifest does not match the validated SQL file.' }
    Write-Host ('Prepared ' + $manifest.batch_count + ' SQL batches, up to ' + $ImportBatchSize + ' statements each.') -ForegroundColor Green
    Write-Host ('Batch files are saved under: ' + $batchDirectory)
}
$batchFiles = @($manifest.batches)
if ($batchFiles.Count -ne [int]$manifest.batch_count -or $batchFiles.Count -eq 0) {
    throw 'Batch manifest is incomplete. No Cloudflare changes were made.'
}
Write-Host ('Conservative daily import budget: ' + $DailyWriteBudget.ToString('N0') + ' SQL write statements, leaving room under the 100,000/day Free limit.')

Write-Step '4/6 Install dependencies and prepare the preview build before remote changes'
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

Write-Step '5/6 Sign in to Cloudflare and prepare D1'
$whoOutput = Invoke-NpxCapture @('wrangler', 'whoami') -AllowNonZero
if ($LASTEXITCODE -ne 0 -or $whoOutput -match '(?i)(not authenticated|not logged in|please run.*login|login required)') {
    Write-Host 'Complete the Cloudflare sign-in that opens in your browser.' -ForegroundColor Yellow
    Invoke-NpxLive @('wrangler', 'login')
    $whoOutput = Invoke-NpxCapture @('wrangler', 'whoami')
}
Write-Host $whoOutput.Trim()

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

if ($progress) {
    if ($progress.DatabaseId -ne $databaseId) {
        throw 'The saved migration checkpoint belongs to a different D1 database. No data was modified.'
    }
    if ([int]$progress.TotalBatches -ne [int]$manifest.batch_count) {
        throw 'The saved checkpoint batch count differs from the current SQL manifest. No data was modified.'
    }
} else {
    if ($tableCount -gt 0) {
        throw "D1 already contains $tableCount tables, but there is no migration checkpoint. To protect existing data, the runner will not overwrite or resume it automatically."
    }
    $progress = [pscustomobject]@{
        DatabaseId = $databaseId
        BatchDirectory = $batchDirectory
        SourceSqlSha256 = $sourceHash
        BatchSize = $ImportBatchSize
        TotalBatches = [int]$manifest.batch_count
        NextBatch = 1
        StatementsCompleted = 0
        UtcDate = [DateTime]::UtcNow.ToString('yyyy-MM-dd')
        StatementsWrittenToday = 0
        MainSchemaReady = $false
        OperationsSchemaReady = $false
        ImportComplete = $false
    }
    Save-MigrationProgress $progress
}

Write-Step '6/6 Initialize D1, import in quota-safe batches, verify, and deploy preview'
if (-not $progress.MainSchemaReady) {
    Write-Host 'Applying the base D1 schema...'
    Invoke-NpxLive @('wrangler', 'd1', 'execute', $DatabaseName, '--remote', '--file', $SchemaFile, '--yes')
    $progress.MainSchemaReady = $true
    Save-MigrationProgress $progress
}
if (-not $progress.OperationsSchemaReady) {
    Write-Host 'Applying the newsroom operations schema...'
    Invoke-NpxLive @('wrangler', 'd1', 'execute', $DatabaseName, '--remote', '--file', $OperationsSchemaFile, '--yes')
    $progress.OperationsSchemaReady = $true
    Save-MigrationProgress $progress
}

while ([int]$progress.NextBatch -le [int]$progress.TotalBatches) {
    $utcToday = [DateTime]::UtcNow.ToString('yyyy-MM-dd')
    if ($progress.UtcDate -ne $utcToday) {
        $progress.UtcDate = $utcToday
        $progress.StatementsWrittenToday = 0
        Save-MigrationProgress $progress
    }

    $batchNumber = [int]$progress.NextBatch
    $batchInfo = $batchFiles[$batchNumber - 1]
    $batchStatements = [int]$batchInfo.statements

    if ([int]$progress.StatementsWrittenToday + $batchStatements -gt $DailyWriteBudget) {
        Wait-ForNextUtcDay
        $progress.UtcDate = [DateTime]::UtcNow.ToString('yyyy-MM-dd')
        $progress.StatementsWrittenToday = 0
        Save-MigrationProgress $progress
        continue
    }

    $batchUtcDay = [DateTime]::UtcNow.ToString('yyyy-MM-dd')
    $batchPath = Join-Path $batchDirectory ([string]$batchInfo.file)
    if (-not (Test-Path -LiteralPath $batchPath -PathType Leaf)) {
        throw "Batch $batchNumber is missing: $batchPath. The saved checkpoint remains unchanged."
    }

    Write-Host ''
    Write-Host ("Importing batch " + $batchNumber + "/" + $progress.TotalBatches +
        " (" + $batchStatements.ToString('N0') + " statements; " +
        ([int]$progress.StatementsWrittenToday).ToString('N0') + "/" +
        $DailyWriteBudget.ToString('N0') + " budgeted today)...") -ForegroundColor Cyan

    $batchOutput = & $script:NpxPath wrangler d1 execute $DatabaseName --remote --file $batchPath --yes 2>&1 | Out-String
    $batchExitCode = $LASTEXITCODE
    if ($batchExitCode -ne 0) {
        Write-Host $batchOutput -ForegroundColor Yellow
        if ($batchOutput -match '(?i)(daily.*row.write.limit|row.write.limit|exceeded.*free.tier.*row.write|free.tier.daily.row.write)') {
            Write-Host 'Cloudflare reached the daily free-tier write limit earlier than expected. The current batch remains checkpointed for a safe retry.' -ForegroundColor Yellow
            Wait-ForNextUtcDay
            $progress.UtcDate = [DateTime]::UtcNow.ToString('yyyy-MM-dd')
            $progress.StatementsWrittenToday = 0
            Save-MigrationProgress $progress
            continue
        }
        throw "D1 batch $batchNumber failed. The checkpoint was not advanced. Fix the reported issue, then rerun this script with -Apply to retry the current batch."
    }

    Write-Host $batchOutput
    $completedUtcDay = [DateTime]::UtcNow.ToString('yyyy-MM-dd')
    $progress.StatementsCompleted = [int]$progress.StatementsCompleted + $batchStatements
    if ($completedUtcDay -ne $batchUtcDay) {
        # If a batch crosses midnight, count it conservatively against the new day.
        $progress.StatementsWrittenToday = $batchStatements
    } else {
        $progress.StatementsWrittenToday = [int]$progress.StatementsWrittenToday + $batchStatements
    }
    $progress.NextBatch = $batchNumber + 1
    $progress.UtcDate = $completedUtcDay
    Save-MigrationProgress $progress
    Write-Host ("Checkpoint saved. Completed " + $progress.StatementsCompleted.ToString('N0') +
        " of " + $manifest.total_statements.ToString('N0') + " import statements.") -ForegroundColor Green
}

$countResult = Invoke-D1Query "SELECT (SELECT COUNT(*) FROM articles) AS articles, (SELECT COUNT(*) FROM social_graphics) AS social_graphics, (SELECT COUNT(*) FROM article_tags) AS article_tags, (SELECT COUNT(*) FROM social_posts) AS social_posts;"
Write-Host ('Verified D1 counts: ' + ($countResult | ConvertTo-Json -Compress)) -ForegroundColor Green
if ([int]$countResult.articles -ne 21191) {
    throw 'Remote D1 does not contain exactly 21,191 articles. Deployment stopped. Keep the checkpoint and all backups; do not run a second import.'
}
foreach ($tableName in @('social_graphics', 'article_tags', 'social_posts')) {
    $expected = $script:PreflightCounts.$tableName
    if ($null -ne $expected -and [int]$countResult.$tableName -ne [int]$expected) {
        throw "Remote D1 $tableName count differs from the locally validated import. Deployment stopped; no data was deleted."
    }
}
$progress.ImportComplete = $true
Save-MigrationProgress $progress

Invoke-NpxLive @('wrangler', 'deploy')

Write-Host ''
Write-Host 'PREVIEW DEPLOYMENT COMMAND FINISHED.' -ForegroundColor Green
Write-Host 'Copy the *.workers.dev URL printed above and open it. Test /v1/news?limit=5 and the homepage.'
Write-Host 'The 5-minute feed schedule is configured in wrangler.jsonc. Allow a few minutes for the first scheduled import.'
Write-Host 'IMPORTANT: this migration imports database rows, not Supabase Storage binary files. Some old Supabase-hosted images may remain unavailable until the media is recovered/re-cached. DNS was not changed; local backups and Supabase data were not deleted.'
