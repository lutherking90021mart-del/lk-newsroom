# LK Newsroom

LK Newsroom is a responsive TV-news style website and editorial dashboard. It uses Supabase for data/authentication, authorised publisher RSS/API feeds for aggregation, and a server-side worker for scheduled updates.

## Included

- Responsive homepage, breaking ticker, dynamic category pages, search, live updates, newsletter, video/gallery pages, legal pages, and 404 screen.
- One canonical article URL per story: `/news/<article-id>`.
- Dynamic cards that show the article image, category, headline, description, source, published time, and reading time.
- Database-driven article view with original-source attribution/link, source mark, gallery, video, related stories, more from source, previous/next stories, sharing, and moderated comments.
- Supabase schema, RLS policies, storage buckets, Auth roles, source catalogue, live-news migration, realtime subscriptions, feed logs, worker logs, and a dashboard status panel.
- An official-RSS/licensed-API aggregation worker. It does not scrape publisher web pages.

## Local setup (Windows)

1. Install Node.js 20 or newer.
2. Open PowerShell in the project folder.
3. Copy `.env.example` to `.env`, then set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GUARDIAN_API_KEY`, and `NEWS_API_KEY` there. Do not paste keys into `.env.example`.
4. Run `npm.cmd install` once.
5. Run `npm.cmd run dev`.
6. Open `http://localhost:5173`.

Use `npm.cmd` in PowerShell if Windows blocks `npm.ps1` because of the execution policy. Keep that PowerShell window open while testing locally; closing it stops the local server and worker.

## Supabase setup

1. Create a project in Supabase.
2. In SQL Editor, run `supabase/schema.sql` first.
3. Then run `supabase/live-news.sql`. It creates the live-news source tables, feed/error logs, worker run history, and the database lock used to prevent overlapping jobs.
4. Run `supabase/admin-cms-upgrade.sql` once. It enables real advertisement impression and click counters.
5. Run `supabase/social-media-automation.sql` once if you want automatic social publishing.
6. Run `supabase/category-pages-upgrade.sql` once. It stores the public category descriptions and adds the Ghana desk used by `/category/ghana`.
7. Run `supabase/notification-personalization-upgrade.sql` once to enable reader notification preferences, the Daily Brief, delivery logs, and comment-reply alerts.
8. In Authentication, add `http://localhost:5173` and your deployed URL as redirect URLs.
8. Set only the public Supabase URL and publishable/anon key in `js/config.js`. Never put the service-role key in this browser file.
9. Create a row for your account in `users_roles` with the `super_admin` role.
10. Enable Supabase Realtime for `articles`, `comments`, `breaking_news`, and `live_updates`.

If a service-role key was copied into a screenshot or chat, rotate it in Supabase before deployment.

## Dynamic articles

## Reader notifications and Daily Brief

Run `supabase/notification-personalization-upgrade.sql`, deploy the application, then add the optional notification variables to the **LK Newsroom web** Railway service. Browser push needs `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, and `VAPID_PRIVATE_KEY`; create the two keys locally with `npm.cmd run notifications:vapid`. Email needs a verified Resend account plus `RESEND_API_KEY` and `EMAIL_FROM`. SMS is optional and only activates when the Twilio variables are present.

Readers manage alerts at `/pages/notifications.html`; newsroom staff manage campaigns, delivery failures, and Daily Briefs at `/admin/notifications.html`. The Railway worker evaluates new stories and delivery retries every five minutes, and creates the Daily Brief at `DAILY_BRIEF_HOUR` (default: 7, using `TZ=Africa/Accra`).

The web server sends `/news/:identifier` to the article shell. The browser then requests `GET /v1/news/:identifier`, where `identifier` is either the database UUID or slug. Therefore every card opens the exact article that was clicked, for example:

```text
/news/125
/news/241
/news/381
```

For a real Supabase UUID, the URL has the same form, for example `/news/bf5b5a68-...`. Cards only use the professional `assets/default-news.svg` artwork if the source record has no featured image or that image fails to load.

## Database-driven category pages

Every Explore by Category tile links to a dedicated route such as `/category/ghana` and `/category/sports`. The page requests the category title, description, live-story count, filters, and article pages from Supabase through the server API. Ghana is treated as a geographic desk, so it includes Ghana stories from Politics, Business, Sport, and every other editorial category. All other category pages show articles assigned to that exact category.

## Live news worker

`worker/newsWorker.ts` is the single run coordinator. It uses a Supabase database lease so only one run can write at a time, even if two hosting schedulers fire together.

The worker:

- fetches configured official RSS/API sources with retries;
- avoids same-source duplicates by external ID and cross-source duplicates by a normalised content hash;
- updates existing source articles;
- stores RSS/API supplied images (optionally in Supabase Storage), categories, summary, SEO description, tags, breaking alerts, trending stories, featured stories, and live updates;
- logs each source sync to `feed_logs` and every overall run to `worker_runs`;
- alerts an optional private webhook after repeated source failures.

Environment options in `.env`:

```text
CRON_SECRET=long-random-secret
ENABLE_NODE_CRON=true
DOWNLOAD_FEED_IMAGES=false
SOURCE_FAILURE_THRESHOLD=3
ADMIN_ALERT_WEBHOOK=
GOOGLE_CUSTOM_SEARCH_API_KEY=
GOOGLE_CUSTOM_SEARCH_ENGINE_ID=
```

## Missing-image research

For an editor-approved image lookup, create a Google Programmable Search Engine that permits image search, enable the Custom Search JSON API, and add `GOOGLE_CUSTOM_SEARCH_API_KEY` plus `GOOGLE_CUSTOM_SEARCH_ENGINE_ID` to the web service only. In **Admin → Articles**, stories without a featured image then show a picture button. It searches the article title—preferring the original publisher’s domain—and shows choices. An editor must choose an image before it is saved. Do not select images unless your publication has permission to use them.

For optional automatic completion, first run `supabase/image-backfill-upgrade.sql` in Supabase. Then set `AUTO_FILL_MISSING_IMAGES=true` and `AUTO_IMAGE_BACKFILL_LIMIT=6` in the **worker** service, alongside the two Google Custom Search values. Each worker run checks a small batch of image-less stories and uses only candidates whose context page is on the story's original publisher domain. It does not scrape article pages, download unrelated Google images, or replace a valid publisher-provided image.

`POST` or `GET /api/news/update` triggers a run. In production it accepts either `Authorization: Bearer <CRON_SECRET>` or an authenticated newsroom staff token.

## Deploy for 24/7 updates

Choose one scheduler. Do not enable several intentionally; the database lock is a safety net, not a substitute for one clear production schedule.

### Vercel

- Deploy the project with the environment variables above, including `CRON_SECRET`.
- `vercel.json` schedules `/api/news/update` every five minutes.
- `api/news/update.ts` verifies the Vercel cron secret and runs one worker pass.
- Set `ENABLE_NODE_CRON=false` on Vercel.

### Railway

- Deploy the web service with `railway.json` and use `npm run start`.
- Add a second Railway **Cron** service in its dashboard, with schedule `*/5 * * * *` and start command `npm run worker:once`.
- Give both services the same Supabase variables. Set `ENABLE_NODE_CRON=false` in the web service.

## Social media automation

After `supabase/social-media-automation.sql` has been run, open **Admin → Social Media**. It holds the connection list, queued posts, retry action, errors, and click totals. The 5-minute Railway worker queues and publishes stories created by editors, scheduled stories that become live, and articles imported through RSS or approved APIs. A database lock prevents two worker runs from posting the same story at the same time; the database also has a unique account-and-article constraint.

### Required Railway variables

Add the following to **both** Railway services: `lk-newsroom-web` and `lk-newsroom-worker`. Never add them to `js/config.js`, Supabase public settings, screenshots, or chat.

```text
PUBLIC_ORIGIN=https://YOUR-RAILWAY-DOMAIN
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
SOCIAL_TOKEN_ENCRYPTION_KEY=a-base64-encoded-32-byte-random-value
```

Generate the encryption value locally with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Keep this exact value private and stable. Changing it makes already connected OAuth accounts require reconnection.

### Official OAuth connections

Create an app with each platform, add its values to both Railway services, and register the matching callback URL in that app before pressing its **Connect** button in Admin:

```text
Facebook / Instagram: https://YOUR-RAILWAY-DOMAIN/v1/social/oauth/facebook/callback
Instagram:            https://YOUR-RAILWAY-DOMAIN/v1/social/oauth/instagram/callback
Threads:              https://YOUR-RAILWAY-DOMAIN/v1/social/oauth/threads/callback
X:                    https://YOUR-RAILWAY-DOMAIN/v1/social/oauth/x/callback
LinkedIn:             https://YOUR-RAILWAY-DOMAIN/v1/social/oauth/linkedin/callback
```

```text
META_APP_ID=...
META_APP_SECRET=...
THREADS_APP_ID=...
THREADS_APP_SECRET=...
X_CLIENT_ID=...
X_CLIENT_SECRET=...
LINKEDIN_CLIENT_ID=...
LINKEDIN_CLIENT_SECRET=...
```

Facebook and Instagram require a Facebook Page and an Instagram professional account linked to that Page. The connection uses the first Page returned by Meta; use an app account that manages only the intended LK Newsroom Page. X requires an app with user-context OAuth 2.0 permission for `tweet.write`. LinkedIn uses the signed-in member identity; organization posting can be configured as an approved server-token connection when the required organization permission is granted.

### Telegram and platform limits

For Telegram, add `TELEGRAM_BOT_TOKEN` as a Railway variable, then add a **Telegram Channel** connection in Admin. Enter the bot variable name `TELEGRAM_BOT_TOKEN` (not the token itself) and the channel username such as `@LKNewsroom` or the numeric chat ID. Make the bot a channel administrator before enabling auto-posting.

WhatsApp Channels and YouTube Community do not offer a general official API for automatic channel/community publishing, so LK Newsroom deliberately does not automate them. This avoids unsafe browser automation or scraping.

### Publishing rules and images

Every connection can be enabled or paused, filtered to categories, delayed by 0/5/15/60 minutes, and given a custom template using `{headline}`, `{summary}`, `{url}`, `{hashtags}`, and `{breaking}`. Publishing retries failed requests up to five times with increasing delays. Posts cannot be duplicated for the same social account and article.

The publisher uses the article's featured image. If none is present, LK Newsroom creates a branded title card for platforms that can show a linked preview. Instagram's official publishing API requires a public JPG, PNG, or WebP, so add a legitimate raster article image in the editor before retrying an image-less Instagram post.

## Automatic branded social graphics

Run `supabase/social-graphics-upgrade.sql` after the social-media migration. It creates the `social-graphics` Storage bucket, reusable template settings, and the generated-graphic records. Each worker run creates or refreshes branded graphic assets for recently published stories even when no social account is connected yet.

For every story, LK Newsroom stores six high-resolution vector graphics in Supabase Storage:

```text
Instagram Feed / WhatsApp Channel  1080 × 1080
Instagram Story                    1080 × 1920
Facebook Post                      1200 × 630
X Post                             1600 × 900
LinkedIn Post                      1200 × 627
```

The generator uses the article photo when supplied and otherwise uses the branded LK Newsroom design. It includes the LK logo, date, Breaking/Latest label, headline, summary, `lknewsroom.com`, social marks, and `@lk.news.global`. Category defaults are included for Breaking, Latest, Sports, Politics, Business, Technology, Entertainment, Health, Education, World, Africa, and Ghana.

Open **Admin → Social Templates** (`/admin/socialtemplates.html`) to preview templates, change the category default, font, dark background colour, accent colour, and background image. New published stories use the latest selected template automatically. Use a genuine article photo for image-first platforms such as Instagram.

### Render

- Deploy the web service and cron worker in `render.yaml`.
- Give both services the same Supabase variables in the Render dashboard.
- Set `ENABLE_NODE_CRON=false` for the Render web service, because the separate cron service calls `npm run worker:once`.

### VPS with PM2

- Copy `.env` securely to the server and install dependencies with `npm ci`.
- Start with `pm2 start ecosystem.config.cjs` and run `pm2 save` plus startup configuration for your server.
- Leave `ENABLE_NODE_CRON=true`. PM2 keeps the Node process alive and `node-cron` runs every five minutes.

## Admin monitoring

Open the dashboard after signing in. Its cards and tables are read from Supabase, not demo data. Use **Articles** to create, edit, publish, schedule, tag, upload an image, or delete your own stories. Use **Ads** to save a campaign with an image URL or uploaded image; active campaigns display in the matching public sidebar and record impressions/clicks after the CMS upgrade SQL is run. News Sources provides enable/disable and manual sync controls; Logs provides source-level run/error information.

## Revenue, analytics and SEO upgrade

Run `supabase/monetization-upgrade.sql` once in the Supabase SQL Editor. It adds advertiser records, Direct / Sponsored / AdSense campaign formats, campaign status and scheduling, CTR fields, and privacy-friendly page-view dimensions without deleting existing ads or page views.

After it is applied, open **Admin → Ads** to create campaigns for header, hero, sidebar, inline-article, footer, sticky, popup, sponsored-news, and video placements. The original simple ad form remains available for existing campaigns. Add your Google AdSense publisher ID in **Admin → Settings** and use an approved AdSense slot ID in an AdSense campaign. Do not enter secret API keys in the public Settings screen.

The public site records first-party page events for the live Analytics screen using a random browser ID stored locally; it does not collect IP addresses. Country is based only on a browser regional setting when the browser provides one. Article pages now include canonical URLs, Open Graph and Twitter card metadata, JSON-LD `NewsArticle` data, plus `/sitemap.xml` and `/robots.txt`.

## Complete monetization suite

Run `supabase/monetization-suite-upgrade.sql` after the earlier Supabase migrations. It creates the advertising packages, advertiser requests, sponsored-story disclosures, affiliate campaigns and links, membership plans, donations, subscriptions, payment records, indexes, Row Level Security rules, and live update tables.

After deployment, use these areas:

- **Admin → Ads** for direct banner campaigns, scheduled placements, AdSense slots, and measured impressions/clicks.
- **Admin → Monetization** for public advertising packages, advertiser request review, sponsored story disclosure, affiliate links, reader membership plans, donations, and payment activity.
- **Advertise with LK Newsroom** (`/pages/advertise.html`) for companies to send their campaign request.
- **Support LK Newsroom** (`/pages/support.html`) for memberships and one-time reader donations.

For payments, add only server-side Railway variables: `PAYSTACK_SECRET_KEY`, `STRIPE_SECRET_KEY`, and (for Stripe events) `STRIPE_WEBHOOK_SECRET`. Configure the provider webhooks to call:

```text
https://YOUR-DOMAIN/v1/monetization/paystack/webhook
https://YOUR-DOMAIN/v1/monetization/stripe/webhook
```

Never enter payment secrets in a public page or in the admin browser. Before accepting real payments, complete the provider account verification, test using their test mode, and verify each successful test produces one payment record and one revenue record in Admin → Monetization.

## Football coverage

The Sports section includes the official BBC Sport Football RSS feed and a separate **News API Football** source. Put your real `NEWS_API_KEY` in `.env`, restart the server, then open **Admin → News Sources**, enable **News API Football**, and press **Sync**. The query can be adjusted with `NEWS_API_SPORTS_QUERY` in `.env`.

To include posts from **Fabrizio Romano (X)**, use an authorised X API bearer token in `X_BEARER_TOKEN`. Leave `FABRIZIO_X_HANDLE=FabrizioRomano` unless the official handle changes. The source appears in **Admin → News Sources** after deployment; enable it and sync. Each item links to the original post and should be treated as an attributed update, not independently verified reporting.

## Ghana, Africa, and publisher video coverage

LK Newsroom includes publisher-provided default feeds for **JoyNews**, **Citi Newsroom**, **GhanaWeb**, **3News / TV3 Ghana**, **Adom Online**, **Africanews**, and **News24**. After the worker has deployed, open **Admin → News Sources**, enable the sources you are licensed to use, then select **Sync**. Other catalogue entries remain disabled until you add a permitted RSS/API endpoint in `.env`.

The **Latest Videos** section is data-driven. It stores video entries from official publisher YouTube Atom feeds for **BBC News**, **Reuters**, **Al Jazeera**, and **Sky News**. Enable the matching `… Video` sources in **Admin → News Sources** and sync them; published videos will then appear on the homepage and the Video News page with their original publisher link.

The public weather card reads live conditions from Open-Meteo for Accra by default. Rain and showers show a falling-rain animation, thunderstorms add lightning, and visitors can choose **Use my location** for a local reading.

## Source rights

Only configure publisher-provided RSS endpoints, official APIs, or licensed syndication endpoints. Feeds/APIs that require a contract (for example Reuters, AP, Bloomberg, and some local publishers) remain disabled until their permitted endpoint is added to `.env`.

## Project structure

```text
assets/       Brand assets and default news artwork
styles/       Modular custom CSS
js/           Browser components, dynamic pages, auth, and dashboard
pages/        HTML shells for public pages
admin/        Dashboard HTML shells
server/       Express site/API server
worker/       Scheduled worker and enrichment helpers
api/          Vercel cron route
services/     Aggregation, cache, enrichment, and notifications
providers/    Normalised official RSS/API providers
supabase/     Schema, security policies, storage, and live-news migration
```
