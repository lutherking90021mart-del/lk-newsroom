# LK Newsroom: Ghana-first, Africa-wide editorial aggregation strategy

## Positioning

**Brand promise: Ghana First. Africa Always.** LK Newsroom is an independent digital newsroom combining original reporting with carefully attributed discovery and curation. Aggregation is a tip and context pipeline, not permission to copy another publisher's article.

## Priority Ghana source directory

| Source family | Website | Priority | Coverage | Relationship / note |
|---|---|---:|---|---|
| JoyNews / MyJoyOnline | https://www.myjoyonline.com/ | 1 | National, politics, business, sport, regions | One Multimedia Group source family; never double-count related brands as independent corroboration |
| YEN.com.gh | https://yen.com.gh/ | 1 | Trending, human interest, politics, entertainment | Legit/GMEM network; confirm official feed/API access |
| Graphic Online | https://www.graphic.com.gh/ | 1 | National, policy, regions, business | Graphic Communications Group |
| Citi Newsroom | https://citinewsroom.com/ | 1 | Breaking, politics, investigations, business | Omni Media |
| GhanaWeb | https://www.ghanaweb.com/ | 1 | National, politics, entertainment, public debate | Separate commentary/user submissions from verified reporting |
| 3News | https://3news.com/ | 1 | Television, current affairs, politics, business | Media General |
| GBC Ghana | https://www.gbcghanaonline.com/ | 1 | Public service, regions, national events | Public broadcaster; distinguish official statements from independent reporting |
| Ghana News Agency | https://gna.org.gh/ | 1 | National, regional, public institutions | Agency copy requires attribution and permission/licensing review |

JoyNews and MyJoyOnline belong to the same Multimedia Group newsroom ecosystem. MyJoyOnline describes itself as the group's flagship news website and says it works alongside Joy News. Do not treat two versions of the same report from that network as independent confirmation. See the publisher's [About Us](https://www.myjoyonline.com/about-us/) and [Editorial Policy](https://www.myjoyonline.com/editorial-policy/).

## Africa-wide expansion

Add publishers by country, not as one undifferentiated Africa feed. Build a coverage matrix for Nigeria, Côte d'Ivoire, Senegal, Liberia, Sierra Leone, Togo, Benin, Burkina Faso, Kenya, Uganda, Tanzania, Rwanda, South Africa, Zambia, Zimbabwe, Egypt, Morocco and the DRC. Add a publisher only after checking ownership, editorial standards, country coverage, feed access and rights.

Existing African candidates in the codebase (including Africanews and News24) remain subject to endpoint health and rights review. Official institutions such as the African Union, ECOWAS, national statistical agencies, election bodies, meteorological agencies and health ministries are primary-document sources, not substitutes for independent reporting.

## Source access and legal guardrails

1. Use publisher-provided RSS/Atom feeds, documented APIs, licensed syndication feeds, direct newsroom submissions or editor-entered links.
2. Do not scrape article pages, bypass paywalls, copy full text, hotlink images or download publisher media without permission.
3. A public RSS endpoint is not automatically a republication licence. Confirm publisher terms and obtain written permission where required.
4. Until access and permitted use are confirmed, keep the source as **manual monitoring / pending**, not enabled automatic ingestion.
5. Store only fields allowed by the source agreement. Default to headline, short factual excerpt, canonical URL, author, timestamp, source identity and permitted thumbnail.
6. Link readers to the original publisher. Never make a curated item look like LK original reporting.

## Editorial workflow

### 1. Discover

The worker polls approved feeds/APIs on a schedule. Capture publisher, canonical URL, headline, publication/update time, byline, category, country, excerpt, permitted image metadata and raw feed identifier. Keep secrets server-side. Use per-source rate limits, timeouts, retry/backoff and a circuit breaker.

### 2. Normalize and deduplicate

- Canonicalise URLs and remove tracking parameters.
- Deduplicate first by source ID and external ID; then compare normalized title, named entities, publication window and content fingerprint across publishers.
- Group related reports into one developing-story cluster; do not silently discard independent reporting.
- Keep the original source record for each item. Mark related items rather than erasing provenance.
- Treat JoyNews/MyJoyOnline as one publisher family for corroboration.

### 3. Verify

Use a two-source standard for consequential claims where possible, with at least one independent source. Two outlets repeating the same official statement are not independent corroboration. For court, crime, health, election, casualty and allegation stories, seek the primary record or direct confirmation. Contact named parties for serious allegations and record attempts to obtain a response.

When only one source is available, attribute clearly ("According to [publisher]") and do not upgrade the claim into LK-confirmed fact. For breaking news, publish a cautious attributed update and visibly timestamp subsequent corrections.

### 4. Classify

Every candidate receives a geographic desk (Ghana / Africa / World), Ghana region or African country, topic, content type (Original LK report / Curated brief / Live update / Analysis / Opinion / Sponsored), verification state (Unreviewed / Checking / Verified / Held / Corrected), and sensitivity flags (allegation, minors, victim, health, election, graphic content).

### 5. Publish

**Curated brief:** Write a concise LK summary in original language, state what is known and what remains unconfirmed, name the publisher prominently and link to the original. Do not reproduce the article body or distinctive phrasing.

**Original reporting:** Assign an LK reporter/editor, keep interview notes and primary documents, record author and editor, fact-check names/dates/figures, seek right of reply for serious allegations and use photographs only with permission.

**Live updates:** Each update has its own timestamp, source/author and correction trail. Do not repeatedly republish an unchanged headline as new.

### 6. Correct and archive

Maintain a public correction note with what changed, when and why. Keep audit logs for source changes, editorial decisions and story revisions. Retain source URL and original timestamps so editors can investigate later.

## Homepage and coverage allocation

Initial editorial target (not a rigid quota): 60% Ghana coverage including all 16 regions; 30% Africa coverage across all five African subregions; 10% important world developments affecting African readers. Avoid Accra-only coverage. Track representation across Ashanti, Northern, Western, Volta, Upper East, Upper West, Bono, Bono East, Ahafo, Central, Eastern, Oti, Savannah, North East, Greater Accra and Western North.

Africa coverage should rotate country focus and avoid treating only Nigeria, Kenya and South Africa as the continent. Review under-covered countries weekly.

## Story scoring

Source priority is a monitoring preference, not a truth score. Rank stories separately using public interest and impact; Ghana/Africa relevance; recency; independent corroboration and primary evidence; local/regional coverage gaps; editorial sensitivity and harm risk. Popularity, virality, advertiser interest and automated trending scores must never override verification.

## Balanced automation defaults

The Cloudflare Worker uses the `editorial_automation` setting seeded by
`cloudflare/migrations/0003_balanced_automation.sql`. In **balanced** mode,
new feed items are automatically published only when all of these conditions
are met: the publisher's `permission_status` is explicitly `approved`; the
item has a usable headline, a substantive short excerpt and a canonical HTTP(S)
source link; its publication timestamp is no more than 36 hours old; and the
headline/excerpt do not match the conservative sensitive-topic hold list.
Everything else stays in the draft queue. Existing article status is preserved
when a feed refresh updates an item. Feed imports never create breaking-news or
live-update alerts automatically, and never copy full publisher article bodies.

This is a cautious first-stage filter, not a substitute for reporting or
independent verification. The automation does not claim to verify facts from
the source excerpt. Editors should periodically review auto-published items
and tune the hold list based on actual newsroom experience. Publisher rows
remain disabled/pending until access and reuse permission are verified.

Social distribution uses the existing Social Media admin integration and its
per-account **Enabled** and **Auto-post** switches. With the user's requested
automatic mode, each connected, authorised account can auto-post newly
published stories according to its configured category and delay rules.
No account is created or authorised by this migration. Social posting remains
inactive until an administrator completes the official OAuth or server-token
connection and enables Auto-post for that account. Failed deliveries remain
visible in the social queue for retry.

## Operational schedule

- Poll approved feeds every 5–10 minutes, with per-source backoff; never exceed publisher rate limits or terms.
- Cluster duplicates during ingestion.
- Review breaking/high-impact leads immediately by a human editor.
- Run morning, midday and evening Ghana/Africa desk reviews.
- Review failed feeds, permissions, duplicates, region balance and corrections daily.
- Review publisher quality, ownership, access terms and country gaps monthly.

## Admin dashboard requirements

**Sources screen:** search/filter by country, region, category, tier, status and access mode; enable/pause source; publisher website and approved feed/API endpoint; permission status and agreement notes; parent media group; last successful sync, last error, consecutive failures and feed logs; test connection/preview headlines; editorial priority and country/region mapping; disable reason and next review date.

**Editorial Queue:** incoming leads, duplicate clusters and related sources; verification checklist and primary-source links; LK author/editor, story type and geographic desk; approve, hold, reject, rewrite as brief or assign original reporting; correction history and attribution preview.

## Cloudflare D1 implementation

For the Cloudflare D1 deployment, apply `cloudflare/migrations/0002_source_directory.sql` to the existing `lk-newsroom-db` after the current `cloudflare/schema.sql` has been installed. This adds publisher metadata, seeds the eight Ghana priority publishers as disabled/pending, retires the duplicate legacy TV3 slug, and pauses Africa feed candidates until access is reviewed. The Cloudflare Worker ingests directly from enabled `news_sources` rows, so configure an approved feed URL in the D1 source record and enable it only after the permission status is approved. Do not run the Supabase SQL migration against D1. `supabase/source-directory-upgrade.sql` is only for deployments still using the legacy Supabase schema.

The D1 migration is an additive migration and should be applied once. Back up/export the D1 database first and inspect source records after applying. Do not execute it against a database that already has these added columns.

## Implementation notes

The application already has news_sources, feed_logs, worker_runs, article source IDs, canonical source URLs, a server-side RSS/API worker and duplicate-checking hooks. The accompanying upgrade adds source-directory metadata and seeds the eight Ghana priority publishers as disabled/pending. Provider endpoints are read from server-side environment variables. No RSS URLs are invented and no automatic publisher ingestion is enabled before access and reuse rights are confirmed.

## Publisher standards references

- MyJoyOnline editorial policy: https://www.myjoyonline.com/editorial-policy/
- MyJoyOnline about the Multimedia Group: https://www.myjoyonline.com/about-us/
- YEN.com.gh manifesto: https://yen.com.gh/manifesto/
- Citi Newsroom about: https://citinewsroom.com/aboutus/
- 3News about: https://3news.com/about-us
- Ghana News Agency: https://gna.org.gh/
