# LK Newsroom Cloudflare migration

## Current status

This is an isolated migration branch named **migration/cloudflare-d1-r2-workers**. It has not been merged into main, deployed to the production domain, or used to change DNS. Keep the current domain records and the existing backup files untouched until every cutover gate below passes.

This branch adds:
- a Cloudflare Worker serving the existing public static pages and newsroom JSON API;
- a D1 schema for active articles, categories, source configuration, tags, reader interactions, social content and newsroom business records;
- a scheduled RSS ingestion handler running every five minutes;
- an R2 binding to the existing lk-newsroom-media bucket;
- a static asset build that deliberately excludes server-only folders and Supabase credentials;
- a local converter that reads your existing CSV backup folder and writes a D1-compatible SQL import without uploading data anywhere.

The admin page is intentionally shown as “migration in progress” in this first public-read/ingestion stage. Do not point lknewsroom.online at this Worker yet. Supabase Auth, the full admin API, social-platform re-authorization, actual Storage binary migration and complete feature-parity testing still need to be finished.

## Free-plan design constraint

Supabase's database is around 734 MB, larger than one Cloudflare D1 Free database's 500 MB limit. D1 Free also has a 5 GB total account storage limit, and individual D1 rows and SQL statements have limits. Therefore the migration does **not** try to put every historical log, analytics row and Storage metadata row into one D1 database.

The D1 import includes the live editorial/business records supported by the schema. High-volume feed logs, social logs, analytics/page views and storage.objects metadata are marked as archive-only; keep their original local CSV copies and move those archives to R2 separately. Storage object rows are only metadata: they are not the image, SVG, audio or video files themselves.

References:
- D1 import/export: https://developers.cloudflare.com/d1/best-practices/import-export-data/
- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Workers static assets: https://developers.cloudflare.com/workers/static-assets/
- Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- R2 Workers API: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/

## 1. Prepare the local checkout

Use a fresh checkout of this migration branch, not the backup folder:

    git clone https://github.com/lutherking90021mart-del/lk-newsroom.git
    cd lk-newsroom
    git checkout migration/cloudflare-d1-r2-workers
    npm ci

The active database backups are in the separate Windows folder:
C:\Users\User\Desktop\LK-Newsroom-Complete-Backup

Do not commit any CSV, SQL export, database password, R2 secret or service-role key to GitHub.

## 2. Build the local D1 import

Run this from the repository root:

    py -3 scripts/buildCloudflareImport.py "C:\Users\User\Desktop\LK-Newsroom-Complete-Backup"

The script creates these files inside the backup folder:
- cloudflare-d1-core-import.sql
- cloudflare-d1-import-report.txt

It uses the known-good root article batches (21,191 rows), the social-graphics batch folder (20,104 rows), and the best available complete per-table CSV batch folder for supporting tables. It maps existing Postgres source IDs to stable source slugs so historical articles can join to the seeded source rows.

Open cloudflare-d1-import-report.txt and check the table counts and warnings before importing. The script is local-only; it does not connect to Supabase or Cloudflare. If it reports missing tables or warnings, stop and review them; do not assume absent tables have been migrated.

The converter intentionally omits secret-bearing Supabase settings and old encrypted social OAuth credentials. Reconnect Facebook/Instagram/Threads/X/LinkedIn/Telegram accounts through a secure new admin flow after that flow is implemented. Supabase Auth password/session rows are not portable to the D1 Worker; staff and reader logins need a planned reset/re-enrolment step.

## 3. Create the D1 database and bind it

Log in using the Cloudflare account that owns the existing R2 bucket:

    npx wrangler login
    npx wrangler d1 create lk-newsroom-db

Copy the database ID returned by Wrangler. In wrangler.jsonc, add that ID to the D1 binding:

    "database_id": "PASTE_THE_D1_DATABASE_ID_HERE"

Keep the database name as lk-newsroom-db and the binding name as DB. Use the same Cloudflare account that owns the existing lk-newsroom-media bucket.

## 4. Initialize the schema and import data

Run these commands from the repository root, replacing the local path if your Windows profile differs:

    npx wrangler d1 execute lk-newsroom-db --remote --file=cloudflare/schema.sql
    npx wrangler d1 execute lk-newsroom-db --remote --file=cloudflare/schema-operations.sql
    npx wrangler d1 execute lk-newsroom-db --remote --file="C:\Users\User\Desktop\LK-Newsroom-Complete-Backup\cloudflare-d1-core-import.sql"

The SQL file is a local export and may be large. Cloudflare D1 has a 500 MB per-database Free limit; if import fails because that limit is reached, stop and review the import report/storage usage. Do not upgrade, delete records or change DNS to force the import. Move additional historical data out to R2 and retry with the trimmed live dataset.

After importing, verify the database counts:

    npx wrangler d1 execute lk-newsroom-db --remote --command="SELECT COUNT(*) AS total_articles FROM articles;"
    npx wrangler d1 execute lk-newsroom-db --remote --command="SELECT COUNT(*) AS total_article_tags FROM article_tags;"
    npx wrangler d1 execute lk-newsroom-db --remote --command="SELECT COUNT(*) AS total_social_graphics FROM social_graphics;"
    npx wrangler d1 execute lk-newsroom-db --remote --command="SELECT COUNT(*) AS total_social_posts FROM social_posts;"

Expected when the related CSV exports are complete: articles 21,191; article_tags 150,321; social_graphics 20,104; social_posts 38,679. Because news ingestion may continue to run on another service, later live counts can be higher; any mismatch should be investigated, not ignored.

## 5. Build and deploy a preview only

First build only the public static assets:

    node scripts/buildCloudflareAssets.mjs

Add a secret for protected manual worker syncs:

    npx wrangler secret put CRON_SECRET

Use a new long random value and keep it private. Do not paste it into chat or commit it. Then deploy a preview Worker:

    npx wrangler deploy

Do not add a custom domain or change DNS yet. The first deploy should be tested on its workers.dev URL. Check:
- /health responds and identifies lk-newsroom-cloudflare;
- /v1/news?limit=5 returns article data;
- /v1/news/<a-real-slug> returns article detail and related content;
- /v1/breaking and /v1/videos respond successfully;
- scheduled runs are visible in Worker logs, and new stories are inserted/deduplicated by source and external ID;
- article images that currently use Supabase Storage URLs are not considered migrated until their actual file bytes exist in R2 and the database URLs have been mapped.

The five-minute Cron Trigger is configured in wrangler.jsonc; Cron Triggers use UTC. Do not remove the existing Render/Railway/other scheduler until the Cloudflare Worker has completed multiple successful runs and duplicate handling is verified. During a controlled overlap, the D1 source/external-ID uniqueness constraint prevents duplicate inserts in D1, but it does not prevent the old Supabase worker from inserting into Supabase; treat them as separate environments.

## 6. Required before domain cutover

This branch is not yet full feature parity. The production DNS must remain unchanged until all of these pass:
1. Media binaries from Supabase Storage have been copied into R2, with a reliable mapping from bucket/object key to public R2 URL. Storage CSV exports are metadata only.
2. Article image URLs, social-graphics URLs, company photos, video thumbnails and ad creatives are checked in the browser.
3. Admin CMS, staff roles, log-in/session handling, reader accounts and password reset/re-enrolment are implemented and tested on Cloudflare.
4. Social OAuth accounts have been reconnected without copying old encrypted credentials.
5. Notifications, newsletter, ads/advertisers, payments, analytics, company hub, football API proxy and uploads are smoke-tested.
6. All required source feeds/API credentials are configured as Cloudflare secrets—not in JavaScript files—and the five-minute scheduler repeatedly adds new articles without duplicate storms.
7. D1 row counts and R2 object counts match the migration reports, and a recoverable copy exists outside the live D1 database.

Only after these gates pass should the domain and custom media domain be moved. Keep Supabase and its data intact until the Cloudflare deployment is proven and the owner explicitly approves final cutover.