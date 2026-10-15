# LK Newsroom storage migration (safe rollout)

## Goals
- Keep the current production deployment and Supabase project untouched during development.
- Use Cloudflare R2 for public media and immutable/versioned published article documents.
- Retain a small relational database for authentication, permissions, transactions, search metadata, and admin workflows that cannot safely be represented as object storage alone.
- Migrate only after the database and storage backups are verified.

## Current architecture findings
- The Express server currently requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY at startup.
- Public news endpoints query Supabase tables directly; the news worker uses Supabase RPCs and tables for locking, worker history, aggregation, and related features.
- services/objectStorage.ts already uploads public objects to R2.
- scripts/migrateSupabaseStorageToR2.ts copies objects from the Supabase news-images and social-graphics buckets and updates selected URL references. It must be reviewed and tested before use against production.
- Adding R2 environment variables alone does not bypass the database dependency.

## Target storage model
- R2 media keys: media/articles/, media/social-graphics/, media/feeds/.
- Published article snapshots: articles/<slug>/<version-id>.json (immutable snapshots).
- Public indexes: indexes/latest.json, indexes/categories/<slug>.json, indexes/trending.json (generated from the canonical article metadata).
- A relational database remains the canonical store for IDs, auth/roles, moderation, transactional admin data, subscriptions, analytics requiring writes, and worker coordination until each dependency is deliberately migrated.
- Never store credentials or private user data in public R2 objects. Public JSON contains only published content.

## Migration stages
1. Audit repository routes, schema, backup integrity, and media references.
2. Create and test R2 JSON storage helpers on a non-production branch.
3. Restore the database backup into an isolated target and measure actual size/compatibility. Do not choose a target solely from an advertised free-tier limit.
4. Export published article snapshots and build indexes from a verified database copy.
5. Update read paths behind a feature flag; keep existing Supabase read paths as fallback.
6. Test homepage, categories, search, article detail, admin writes, authentication, comments, worker scheduling, media URLs, and rollback.
7. Switch production only after verification and a fresh backup; keep old resources until the rollback window has passed.

## Safety rules
- Do not delete Supabase rows, buckets, or the project during migration.
- Do not put R2 secrets in browser code or commit them to Git.
- Do not run a bulk migration against production before a dry run and verification.
- Public R2 development URLs are suitable for a test only; configure a production custom domain before relying on it at scale.
- R2 is object storage, not a drop-in relational database. Index updates and concurrent writes must be designed explicitly.
