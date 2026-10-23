# LK Newsroom migration: Supabase to Cloudflare D1 + R2

## Status and safety

The migration implementation was merged into `main` through [PR #7](https://github.com/lutherking90021mart-del/lk-newsroom/pull/7) on 17 October 2026. The merge changed repository source code; it did **not** create or seed a remote D1 database, run the media migration, or change DNS through the migration scripts. No GitHub Actions deployment workflow is configured here—its workflow validates source, schema and static build only. However, the hosting provider may auto-deploy from `main`, so check the hosting dashboard's deployment history before assuming the live app has not redeployed. Keep all local CSV batches and previous exports; do not delete them after an import.

The branch currently contains:
- Cloudflare Worker public-news API and static-site asset build, with Supabase browser access removed from the preview build;
- a D1 schema and local CSV-to-SQL conversion tool;
- a five-minute scheduled RSS ingest, optional News API/Guardian adapters, duplicate checks and a D1 lock to avoid overlapping runs;
- a migration helper that can copy actual public-bucket files from Supabase Storage to the existing R2 bucket and create an old-URL/new-URL mapping;
- Cloudflare-native admin login/session and password-change routes, staff enrollment/role checks, a D1-backed query compatibility API, and R2 media list/upload/delete endpoints;
- APIs for public ads, advertising requests, newsletter subscription, football scores and match centre;
- legacy server-side Paystack/Stripe code remains for reference, but public checkout routes are disabled;
- CI checks for application/Worker TypeScript, Python importer syntax, D1 schema execution, admin module syntax, private archive script and static build.

**Not yet complete:** no remote D1 database has been created/seeded, no Worker has been deployed/tested on its preview URL, and no actual media file copy has been completed. The admin/auth/media code has passed static checks but has not completed an end-to-end deployed test. Remaining admin workflows—especially notification delivery, social-account reconnection/publishing, password-reset email, and full feature parity—still need porting and testing. Do not point the production domain at Cloudflare until the cutover checklist is complete.

## Important Free-plan limitation

Cloudflare D1 Free has a 500 MB per-database limit and an account-wide storage limit. This importer intentionally excludes high-volume historical logs and Supabase Storage metadata from D1; archive those CSV exports in R2 while preserving the local originals. CSV rows from `storage.objects` are **metadata only**. They are not the actual image/video/document bytes. The separate Storage migration script must download and upload real object bytes before their URLs are rewritten.

Official references:
- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- D1 import/export: https://developers.cloudflare.com/d1/best-practices/import-export-data/
- Workers static assets: https://developers.cloudflare.com/workers/static-assets/
- Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- R2 Workers API: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/

## 1. Use the existing backups

The existing backup folder is expected at:

```powershell
$env:USERPROFILE\Desktop\LK-Newsroom-Complete-Backup
```

The importer searches that folder and its parent Desktop for the separately verified article and social-graphics batches. It expects 21,191 article rows and 20,104 social-graphics rows in the complete exports. If it reports a different article count, stop and review the report; do not import a partial set.

From a fresh repository checkout:

```powershell
git clone https://github.com/lutherking90021mart-del/lk-newsroom.git
cd lk-newsroom
git checkout migration/cloudflare-d1-r2-workers
npm ci
py -3 scripts/buildCloudflareImport.py "$env:USERPROFILE\Desktop\LK-Newsroom-Complete-Backup"
```

The script creates `cloudflare-d1-core-import.sql` and `cloudflare-d1-import-report.txt` inside the backup folder. It only reads local CSV files and writes a new local SQL/report file; it does not connect to, restore, or modify Supabase or Cloudflare. Review the report and warnings before importing. Do not commit the generated SQL, CSV batches or secrets to GitHub.

If the real-file Storage migration has succeeded and generated `cloudflare-media-map.csv`, the import builder applies only its successful old-to-new URL mappings. If there is no verified map, it leaves existing media URLs untouched.

## Windows: one-command Cloudflare preview runner (recommended)

This runner consolidates the repeated PowerShell commands. It starts in **dry-run mode** and makes no Cloudflare changes unless you pass `-Apply`.

From PowerShell, clone this branch and run the local validation:

```powershell
git clone https://github.com/lutherking90021mart-del/lk-newsroom.git
cd lk-newsroom
git checkout migration/one-command-cloudflare-import
Set-ExecutionPolicy -Scope Process Bypass -Force
& .\scripts\Run-LKNewsroomCloudflareMigration.ps1
```

It rebuilds the SQL from your existing local CSV exports, tests the import in a temporary local SQLite database, checks that 21,191 articles are present, and stops if conversion warnings appear or the estimated D1 size exceeds a 450 MiB safety margin. It preserves your CSVs and deletes the temporary test database after validation.

If the report/counts and estimated size look correct, run the same script with the explicit apply switch:

```powershell
& .\scripts\Run-LKNewsroomCloudflareMigration.ps1 -Apply
```

It asks you to type `MIGRATE`, signs in to Cloudflare if needed, creates or finds `lk-newsroom-db`, imports only into an empty D1 database, checks key row counts, builds the static assets, and deploys a **workers.dev preview**. If a previous run fully imported D1 but failed at deployment, the runner verifies existing counts and can resume to the deploy step. If it detects a partial or mismatched database, it stops without deleting or overwriting tables. The runner never switches DNS.

This is an active-news/database recovery step, not yet a guarantee that every legacy feature or image is recovered. CSVs include Storage metadata, not binary image/video files. Since the old Supabase project is restricted, some existing Supabase-hosted images may remain unavailable until the binaries are recovered or images are re-cached from their original licensed/public sources. Keep the Supabase project and every local backup unchanged.

## 2. Create the D1 database once

Use the Cloudflare account that already owns the `lk-newsroom-media` R2 bucket:

```powershell
npx wrangler login
npx wrangler d1 create lk-newsroom-db
```

Copy the returned D1 database ID into the `d1_databases` item in `wrangler.jsonc` as `"database_id": "YOUR_REAL_ID"`. Keep binding name `DB` and database name `lk-newsroom-db`. Do not put account secrets in this file.

Then initialize and import:

```powershell
npx wrangler d1 execute lk-newsroom-db --remote --file=cloudflare/schema.sql
npx wrangler d1 execute lk-newsroom-db --remote --file=cloudflare/schema-operations.sql
npx wrangler d1 execute lk-newsroom-db --remote --file="$env:USERPROFILE\Desktop\LK-Newsroom-Complete-Backup\cloudflare-d1-core-import.sql"
```

These two schema files are for a **new, empty D1 database**; do not rerun the `ALTER TABLE` schema file against an already initialized database. If the import exceeds the Free plan limit or fails, stop and keep all backups and the database intact. Do not change DNS or delete rows to force it through.

Verify key counts:

```powershell
npx wrangler d1 execute lk-newsroom-db --remote --command="SELECT COUNT(*) AS total_articles FROM articles;"
npx wrangler d1 execute lk-newsroom-db --remote --command="SELECT COUNT(*) AS total_article_tags FROM article_tags;"
npx wrangler d1 execute lk-newsroom-db --remote --command="SELECT COUNT(*) AS total_social_graphics FROM social_graphics;"
npx wrangler d1 execute lk-newsroom-db --remote --command="SELECT COUNT(*) AS total_social_posts FROM social_posts;"
```

Compare with the migration report. News ingestion can add stories after import, so counts can legitimately grow; unexpected missing rows must be reviewed rather than ignored.

## 3. Archive CSV tables excluded from D1 to a private R2 bucket

Historical logs, authentication exports, and Storage metadata can contain personal or operational data. Do **not** put those backups in the public `lk-newsroom-media` bucket. Create a separate private bucket:

```powershell
npx wrangler r2 bucket create lk-newsroom-private-media
```

Leave R2 public development URLs/custom domains disabled for this archive bucket. Create a separate R2 API token restricted to Object Read & Write for only `lk-newsroom-private-media`. Locally set `R2_ACCOUNT_ID`, `R2_PRIVATE_BUCKET_NAME=lk-newsroom-private-media`, `R2_PRIVATE_ACCESS_KEY_ID`, and `R2_PRIVATE_SECRET_ACCESS_KEY` in your uncommitted `.env`. Do not replace the existing public-media token or share either token in chat.

First dry-run the CSV archive (no network uploads happen in dry-run mode):

```powershell
npx tsx scripts/archiveDatabaseCsvToR2.ts "$env:USERPROFILE\Desktop\LK-Newsroom-Complete-Backup"
```

When the file count and size look right, apply it:

```powershell
npx tsx scripts/archiveDatabaseCsvToR2.ts "$env:USERPROFILE\Desktop\LK-Newsroom-Complete-Backup" --apply
```

It uploads CSV export files—including excluded high-volume and auth/Storage metadata tables—to the **private** bucket with SHA-256 checksums, records a manifest locally and in R2, and preserves every local original. It does not archive secret files or alter/delete anything in Supabase. Keep the private bucket private.

## 4. Copy actual Storage media to the public R2 bucket


First do a dry run. From the repository root, create a local environment file (never commit it) that contains your existing server-only `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and R2 credentials. Do not paste those values into chat or a public file.

```powershell
npx tsx scripts/migrateStorageCsvToR2.ts "$env:USERPROFILE\Desktop\LK-Newsroom-Complete-Backup"
```

The default run is a dry run. Review the number of objects and public buckets shown. Only when that preview is correct, run:

```powershell
npx tsx scripts/migrateStorageCsvToR2.ts "$env:USERPROFILE\Desktop\LK-Newsroom-Complete-Backup" --apply
```

If Supabase returns a restriction/authentication error, stop and preserve the mapping/report; do not repeatedly hammer the old project. Confirm every desired object has status `copied`, then rebuild the SQL with the resulting media map before importing it into a fresh D1 database. Private buckets are deliberately not auto-copied; their access policy needs a separate decision.

## 5. Build and deploy a preview only

Build the static assets with the special preview client (it removes the browser's Supabase dependency and excludes server folders):

```powershell
node scripts/buildCloudflareAssets.mjs
```

Before deploying, configure these **as Worker secrets**, not in source files: `CRON_SECRET` and any needed `NEWS_API_KEY` or `GUARDIAN_API_KEY`. Public checkout and paid reader access are disabled. Do not set payment-provider secrets to re-enable reader charges. Keep all operational secrets private. You can set required secrets using `npx wrangler secret put SECRET_NAME`.

Deploy a preview Worker using `npx wrangler deploy`. Do not configure a custom domain yet. Test its `workers.dev` URL:
- `/health`
- `/v1/news?limit=5` and `/v1/news/<real-slug>`
- `/v1/breaking`, `/v1/videos`, `/v1/categories/ghana`
- `/v1/football/fixtures?date=YYYY-MM-DD`
- newsletter and advertiser quote submission;
- optional reader support is handled by contacting the newsroom team; public checkout and paid reader access stay disabled;
- multiple scheduled ingestions, logs and deduplication.

Do not configure payment-provider webhooks for public reader checkout. Legacy payment handlers remain in source for reference but public payment initiation is disabled by the Worker route guard. Optional support is handled by contacting the newsroom team and never controls article access.

Cron is scheduled every five minutes (UTC). Do not remove the existing Render/Railway scheduler while preview testing. The database lock prevents overlapping Worker runs, and the query deduplication checks existing source/external IDs; this is not a reason to run two production ingestion systems indefinitely.

## 6. Admin and final domain cutover

The admin route on this branch is a placeholder. The existing Supabase Auth users/sessions and encrypted social OAuth tokens are not portable to D1 via the CSV importer. Staff authentication, role enforcement, article editing/publishing, file uploads, settings, social account reconnection, notification delivery, and company/admin tools must be completed and tested before production cutover.

Only move `lknewsroom.online` and any custom media domain after:
1. D1 row counts are checked and there is a recoverable copy outside the live D1 database.
2. Actual image/video/document bytes have been copied to R2, and the URL map has been applied/verified in the browser.
3. All public pages, category filters, article navigation, images, video pages, ads, football scores, payments and newsletter paths are smoke-tested.
4. Admin login, roles, publishing, uploads and other required workflows are finished; no staff screen points back to Supabase by accident.
5. Cloudflare scheduled ingestion works repeatedly without duplicate storms or free-tier limit failures.
6. The owner explicitly approves the DNS cutover.

Until then, leave the current DNS, main branch, Supabase project and backup files untouched.
