#!/usr/bin/env python3
"""Build a Cloudflare D1-compatible SQL import from LK Newsroom's local CSV exports.

This tool never reads credentials and never contacts Supabase or Cloudflare.
It writes SQL locally; import that file into a newly created D1 database only
after reviewing the report. High-volume historical logs and storage.objects are
left out of D1 intentionally so the active database can fit the Free-plan cap.
"""
import argparse
import csv
import hashlib
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlparse

TABLE_COLUMNS = {
    "categories": ["id", "name", "slug", "description", "colour", "created_at"],
    "news_sources": ["id", "slug", "name", "source_type", "feed_url", "api_endpoint", "api_secret_name", "country", "default_category", "enabled", "last_synced_at", "last_status", "last_error", "consecutive_failures", "created_at", "updated_at"],
    "authors": ["id", "source_id", "name", "slug", "profile_url", "avatar_url", "created_at"],
    "tags": ["id", "name", "slug", "created_at"],
    "settings": ["key", "value", "is_public", "updated_at"],
    "membership_plans": ["id", "name", "slug", "description", "features", "amount", "currency", "interval", "paystack_plan_code", "stripe_price_id", "active", "sort_order", "created_at", "updated_at"],
    "bookmarks": ["user_id", "article_id", "created_at"],
    "article_likes": ["user_id", "article_id", "created_at"],
    "profiles": ["id", "full_name", "avatar_url", "bio", "created_at", "updated_at"],
    "users_roles": ["user_id", "role", "assigned_at"],
    "articles": ["id", "slug", "title", "excerpt", "content", "content_markdown", "ai_summary", "featured_image_url", "original_url", "status", "featured", "breaking", "allow_comments", "scheduled_at", "published_at", "created_at", "updated_at", "meta_title", "meta_description", "canonical_url", "view_count", "category_id", "author_id", "source_id", "external_id", "external_author_id", "country", "source_updated_at", "content_hash", "auto_tags", "is_aggregated", "duplicate_of"],
    "article_tags": ["article_id", "tag_id"],
    "breaking_news": ["id", "article_id", "source_id", "headline", "link_url", "active", "pinned", "starts_at", "ends_at", "created_at", "updated_at"],
    "live_updates": ["id", "article_id", "title", "body", "kind", "pinned", "published_at", "created_at"],
    "trending_news": ["id", "article_id", "score", "rank", "calculated_at"],
    "featured_news": ["id", "article_id", "rank", "active", "starts_at", "ends_at"],
    "videos": ["id", "title", "slug", "description", "video_url", "youtube_url", "thumbnail_url", "duration_seconds", "article_id", "status", "published_at", "created_at", "updated_at"],
    "gallery": ["id", "title", "caption", "image_url", "alt_text", "article_id", "status", "sort_order", "published_at", "created_at", "updated_at"],
    "comments": ["id", "article_id", "user_id", "parent_id", "display_name", "body", "status", "created_at", "updated_at"],
    "newsletter": ["id", "email", "status", "source", "created_at", "unsubscribed_at"],
    "advertisements": ["id", "name", "title", "description", "placement", "image_url", "target_url", "html_content", "starts_at", "ends_at", "active", "impressions", "clicks", "ad_type", "adsense_slot", "popup_delay_seconds", "display_frequency", "status", "price", "currency", "campaign_goal", "mobile_sticky", "advertiser_id", "advertiser_request_id", "created_at", "updated_at"],
    "advertisers": ["id", "company_name", "contact_name", "email", "phone", "website", "created_at", "updated_at"],
    "advertising_packages": ["id", "title", "slug", "description", "placement", "price", "currency", "duration_days", "features", "active", "sort_order", "created_at", "updated_at"],
    "advertiser_requests": ["id", "advertiser_id", "package_id", "company_name", "contact_name", "email", "phone", "website", "advertisement_type", "requested_placement", "budget", "currency", "campaign_duration_days", "campaign_goal", "message", "status", "quoted_price", "admin_notes", "reviewed_by", "reviewed_at", "created_at", "updated_at"],
    "sponsored_article_details": ["article_id", "sponsor_name", "sponsor_logo_url", "sponsor_url", "campaign_details", "paid_amount", "currency", "campaign_starts_at", "campaign_ends_at", "click_count", "created_at", "updated_at"],
    "affiliate_campaigns": ["id", "name", "advertiser_name", "description", "default_commission_rate", "status", "starts_at", "ends_at", "created_by", "created_at", "updated_at"],
    "affiliate_links": ["id", "campaign_id", "title", "product_name", "destination_url", "tracking_code", "commission_rate", "commission_amount", "currency", "active", "created_at", "updated_at"],
    "affiliate_events": ["id", "affiliate_link_id", "event_type", "session_id", "order_reference", "commission_earned", "metadata", "created_at"],
    "subscriptions": ["id", "user_id", "plan_id", "plan", "provider", "provider_subscription_id", "provider_reference", "amount", "currency", "status", "start_date", "end_date", "created_at", "updated_at"],
    "donations": ["id", "user_id", "donor_name", "donor_email", "amount", "currency", "provider", "provider_reference", "message", "status", "created_at", "updated_at"],
    "payment_transactions": ["id", "kind", "provider", "reference", "email", "amount", "currency", "donation_id", "subscription_id", "status", "provider_response", "created_at", "updated_at"],
    "revenue": ["id", "source", "amount", "currency", "type", "status", "date", "advertisement_id", "article_id", "notes", "created_by", "created_at", "updated_at"],
    "company_enquiries": ["id", "name", "email", "topic", "message", "status", "admin_notes", "handled_by", "created_at", "updated_at"],
    "company_staff_profiles": ["id", "full_name", "job_title", "work_email", "work_phone", "photo_url", "biography", "sort_order", "is_published", "created_at", "updated_at"],
    "social_templates": ["id", "slug", "name", "category_slug", "accent_color", "background_color", "font_family", "background_url", "text_position", "enabled", "is_default", "created_at", "updated_at"],
    "social_graphics": ["id", "article_id", "template_id", "source_image_url", "assets", "generated_at", "created_at", "updated_at"],
    "social_accounts": ["id", "platform", "display_name", "account_id", "enabled", "auto_post", "category_slugs", "posting_delay_minutes", "post_template", "auto_post_from", "metadata", "last_success_at", "last_error", "created_by", "created_at", "updated_at"],
    "social_posts": ["id", "account_id", "article_id", "platform", "status", "post_text", "article_url", "image_url", "scheduled_for", "locked_at", "attempts", "max_attempts", "next_attempt_at", "platform_post_id", "platform_post_url", "last_error", "posted_at", "click_count", "created_at", "updated_at"],
    "notification_subscriptions": ["id", "user_id", "email", "push_token", "push_endpoint", "push_subscription", "phone", "preferences", "source", "active", "confirmed_at", "last_delivered_at", "created_at", "updated_at"],
    "daily_briefs": ["id", "title", "summary", "articles", "sent_date", "status", "scheduled_for", "sent_at", "created_by", "created_at", "updated_at"],
    "notifications": ["id", "subscription_id", "user_id", "article_id", "daily_brief_id", "title", "message", "type", "url", "metadata", "dedupe_key", "read_status", "read_at", "created_at"],
    "notification_deliveries": ["id", "notification_id", "subscription_id", "channel", "status", "scheduled_for", "sent_at", "provider_id", "attempts", "max_attempts", "next_attempt_at", "locked_at", "last_error", "created_at", "updated_at"],
    "notification_campaigns": ["id", "title", "message", "type", "url", "audience_preferences", "category_slugs", "channels", "scheduled_for", "status", "created_by", "sent_at", "created_at", "updated_at"],
    "worker_runs": ["id", "trigger", "status", "started_at", "completed_at", "fetched", "added", "updated", "skipped", "errors", "error", "details"]
}

BOOLEAN_COLUMNS = {
    "news_sources": {"enabled"},
    "articles": {"featured", "breaking", "allow_comments", "is_aggregated"},
    "breaking_news": {"active", "pinned"},
    "live_updates": {"pinned"},
    "featured_news": {"active"},
    "comments": set(),
    "newsletter": set(),
    "advertisements": {"active", "mobile_sticky"},
    "membership_plans": {"active"},
    "advertising_packages": {"active"},
    "company_staff_profiles": {"is_published"},
    "social_templates": {"enabled", "is_default"},
    "social_graphics": set(),
    "social_accounts": {"enabled", "auto_post"},
    "notification_subscriptions": {"active"},
    "notifications": {"read_status"},
    "notification_deliveries": set()
}
JSON_COLUMNS = {
    "articles": {"auto_tags"},
    "settings": {"value"},
    "membership_plans": {"features"},
    "advertising_packages": {"features"},
    "affiliate_events": {"metadata"},
    "payment_transactions": {"provider_response"},
    "social_templates": {"text_position"},
    "social_graphics": {"assets"},
    "social_accounts": {"category_slugs", "metadata"},
    "notification_subscriptions": {"push_subscription", "preferences"},
    "daily_briefs": {"articles"},
    "notifications": {"metadata"},
    "notification_campaigns": {"audience_preferences", "category_slugs", "channels"}
}
REQUIRED = {
    "categories": {"id", "name", "slug"},
    "settings": {"key", "value", "is_public"},
    "membership_plans": {"id", "name", "slug"},
    "bookmarks": {"user_id", "article_id"},
    "article_likes": {"user_id", "article_id"},
    "profiles": {"id", "full_name"},
    "users_roles": {"user_id", "role"},
    "advertising_packages": {"id", "title", "slug", "placement", "price", "currency", "duration_days"},
    "social_accounts": {"id", "platform", "display_name", "account_id"},
    "social_templates": {"id", "slug", "name", "category_slug", "accent_color", "background_color", "font_family"},
    "social_graphics": {"id", "article_id", "assets"},
    "notification_subscriptions": {"id", "email", "push_subscription", "preferences", "source", "active"},
    "daily_briefs": {"id", "title", "summary", "articles", "sent_date", "status"},
    "notifications": {"id", "title", "message", "type", "metadata", "read_status"},
    "notification_deliveries": {"id", "notification_id", "subscription_id", "channel", "status", "attempts", "max_attempts"},
    "notification_campaigns": {"id", "title", "message", "type", "audience_preferences", "category_slugs", "channels", "scheduled_for", "status"},
    "news_sources": {"id", "slug", "name"},
    "authors": {"id", "name", "slug"},
    "tags": {"id", "name", "slug"},
    "articles": {"id", "slug", "title", "status"},
    "article_tags": {"article_id", "tag_id"},
    "breaking_news": {"id", "headline", "starts_at"},
    "live_updates": {"id", "title", "kind", "published_at"},
    "trending_news": {"id", "article_id", "rank", "calculated_at"},
    "featured_news": {"id", "article_id", "rank", "starts_at"},
    "videos": {"id", "title", "slug", "status"},
    "gallery": {"id", "title", "image_url", "status"},
    "comments": {"id", "article_id", "body", "status"},
    "newsletter": {"id", "email", "status"},
    "advertisements": {"id", "name", "placement"},
    "advertisers": {"id", "company_name"},
    "advertising_packages": {"id", "title", "slug"},
    "advertiser_requests": {"id", "company_name", "email"},
    "sponsored_article_details": {"article_id", "sponsor_name"},
    "affiliate_campaigns": {"id", "name", "status"},
    "affiliate_links": {"id", "title", "destination_url", "tracking_code"},
    "affiliate_events": {"id", "affiliate_link_id", "event_type"},
    "subscriptions": {"id", "plan", "provider", "amount"},
    "donations": {"id", "amount", "provider"},
    "payment_transactions": {"id", "kind", "provider", "reference", "amount"},
    "revenue": {"id", "source", "amount", "date"},
    "company_enquiries": {"id", "name", "email", "message"},
    "company_staff_profiles": {"id", "full_name", "job_title"},
    "social_templates": {"id", "slug", "name"},
    "social_graphics": {"id", "article_id"},
    "social_accounts": {"id", "platform", "display_name", "account_id"},
    "social_posts": {"id", "account_id", "article_id", "platform", "post_text", "article_url"},
    "notification_subscriptions": {"id", "email"},
    "daily_briefs": {"id", "title", "summary", "sent_date"},
    "notifications": {"id", "title", "message", "type"},
    "notification_deliveries": {"id", "notification_id", "subscription_id", "channel"},
    "notification_campaigns": {"id", "title", "message", "status"},
    "worker_runs": {"id", "trigger", "status", "started_at"}
}
TABLE_ORDER = [
    "categories", "news_sources", "authors", "tags", "profiles", "users_roles", "settings",
    "advertisers", "advertising_packages", "membership_plans", "affiliate_campaigns", "affiliate_links",
    "subscriptions", "donations", "articles", "article_tags", "bookmarks", "article_likes", "breaking_news",
    "live_updates", "trending_news", "featured_news", "videos", "gallery",
    "comments", "newsletter", "advertisements", "advertiser_requests",
    "sponsored_article_details", "affiliate_events", "payment_transactions",
    "revenue", "company_enquiries", "company_staff_profiles", "social_templates",
    "social_graphics", "social_accounts", "social_posts", "notification_subscriptions",
    "daily_briefs", "notifications", "notification_deliveries", "notification_campaigns",
    "worker_runs"
]
ARCHIVE_ONLY = ["feed_logs", "social_logs", "analytics_events", "page_views", "storage.objects", "storage.migrations", "storage.buckets"]

def norm_dir(name):
    value = name.lower().replace("-", "_").replace(".", "_").strip()
    for prefix in ("public_", "auth_", "storage_"):
        if value.startswith(prefix):
            value = value[len(prefix):]
    return value

def count_csv_rows(path):
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            return sum(1 for _ in csv.DictReader(handle))
    except (UnicodeDecodeError, csv.Error, OSError):
        return -1

def find_table_csvs(root, table):
    # The large article/social batches may have been saved directly to Desktop
    # instead of inside the backup folder. Search the backup root and its parent,
    # group by the directory containing each batch set, and only select the known
    # verified row count for these two large exports.
    verified_root_patterns = {
        "articles": ("LK-Newsroom-articles-part-*.csv", 21191),
        "social_graphics": ("social-graphics-part-*.csv", 20104),
    }
    if table in verified_root_patterns:
        pattern, expected = verified_root_patterns[table]
        search_root = root.parent if root.parent.exists() else root
        candidate_groups = defaultdict(list)
        for path in search_root.rglob(pattern):
            if path.is_file():
                candidate_groups[path.parent].append(path)
        scored = []
        for folder, candidates in candidate_groups.items():
            paths = sorted(set(candidates))
            rows = sum(max(0, count_csv_rows(path)) for path in paths)
            if rows == expected:
                # Prefer files in the backup root, then the closest directory to it.
                distance = len(folder.resolve().parts) + len(root.resolve().parts) - 2 * len(
                    set(folder.resolve().parts) & set(root.resolve().parts)
                )
                scored.append((folder != root, distance, max((p.stat().st_mtime for p in paths), default=0), folder, paths, rows))
        if scored:
            scored.sort(key=lambda item: (item[0], item[1], -item[2]))
            _outside_root, _distance, _newest, folder, paths, rows = scored[0]
            return paths, rows, "verified batch folder: " + str(folder)

    # Other exports are stored in schema/table folders or timestamped repair folders.
    groups = defaultdict(list)
    for file in root.rglob("part-*.csv"):
        if not file.is_file():
            continue
        if file.name.startswith("LK-Newsroom-articles-part-") or file.name.startswith("social-graphics-part-"):
            continue
        matched_dir = None
        for ancestor in file.parents:
            if ancestor == root.parent:
                break
            if norm_dir(ancestor.name) == table:
                matched_dir = ancestor
                break
        if matched_dir:
            groups[matched_dir].append(file)
    scored = []
    for folder, files in groups.items():
        rows = sum(max(0, count_csv_rows(p)) for p in files)
        newest = max((p.stat().st_mtime for p in files), default=0)
        scored.append((rows, newest, folder, sorted(files)))
    if not scored:
        return [], 0, "not found"
    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    rows, _newest, folder, files = scored[0]
    return files, rows, str(folder.relative_to(root))

def read_rows(files):
    for path in files:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                yield {str(k).strip().lower(): v for k, v in row.items() if k is not None}

def pg_array_to_json(value):
    if value is None or value == "":
        return "[]"
    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            return json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        pass
    if not (value.startswith("{") and value.endswith("}")):
        return json.dumps([value], ensure_ascii=False)
    body = value[1:-1]
    items, token, quoted, escaped = [], [], False, False
    for ch in body:
        if escaped:
            token.append(ch); escaped = False
        elif ch == "\\" and quoted:
            escaped = True
        elif ch == '"':
            quoted = not quoted
        elif ch == "," and not quoted:
            items.append("".join(token)); token = []
        else:
            token.append(ch)
    if token or body:
        items.append("".join(token))
    cleaned = [None if item == "NULL" and not quoted else item for item in items]
    return json.dumps(cleaned, ensure_ascii=False, separators=(",", ":"))

def normalize_value(table, column, value):
    if value is None:
        return None
    if column in BOOLEAN_COLUMNS.get(table, set()):
        v = str(value).strip().lower()
        if v in ("t", "true", "1", "yes"): return 1
        if v in ("f", "false", "0", "no"): return 0
        return None
    if column in JSON_COLUMNS.get(table, set()):
        if column in ("category_slugs", "audience_preferences", "channels", "features") and str(value).startswith("{"):
            return pg_array_to_json(str(value))
        text = str(value)
        if not text:
            if column in ("auto_tags", "assets", "text_position", "metadata", "preferences", "push_subscription", "articles", "features", "channels", "category_slugs", "audience_preferences", "provider_response"):
                return "[]" if column in ("auto_tags", "features", "channels", "category_slugs", "audience_preferences", "articles") else "{}"
            return text
        try:
            json.loads(text)
            return text
        except Exception:
            if text.startswith("{") and text.endswith("}"):
                return pg_array_to_json(text)
            return json.dumps(text, ensure_ascii=False)
    if value == "":
        return "" if column in REQUIRED.get(table, set()) else None
    if "\x00" in str(value):
        value = str(value).replace("\x00", "")
    return value

def sql_literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"

def bytes_len(text):
    return len(text.encode("utf-8"))

def replace_media_urls(value, media_map):
    if isinstance(value, str):
        result = value
        for old_url, new_url in media_map.items():
            if old_url and old_url in result:
                result = result.replace(old_url, new_url)
        return result
    if isinstance(value, list):
        return [replace_media_urls(item, media_map) for item in value]
    if isinstance(value, dict):
        return {key: replace_media_urls(item, media_map) for key, item in value.items()}
    return value


def rewrite_media_row(row, media_map):
    if not media_map:
        return row
    return {key: replace_media_urls(value, media_map) for key, value in row.items()}


def insert_statement(table, row, source_map=None):
    columns = [c for c in TABLE_COLUMNS[table] if c in row]
    values = dict(row)
    source_map = source_map or {}
    if table == "articles" and values.get("source_id"):
        values["source_id"] = source_map.get(values["source_id"], values["source_id"])
    if table == "authors" and values.get("source_id"):
        values["source_id"] = source_map.get(values["source_id"], values["source_id"])
    normalized = [normalize_value(table, col, values.get(col)) for col in columns]
    if table == "article_tags":
        prefix = "INSERT OR IGNORE"
    else:
        prefix = "INSERT OR REPLACE"
    statement = prefix + " INTO " + table + " (" + ",".join(columns) + ") VALUES (" + ",".join(sql_literal(v) for v in normalized) + ");"
    if bytes_len(statement) <= 85000:
        return [statement]
    if table == "articles" and "content" in columns:
        idx = columns.index("content")
        content = normalized[idx]
        if not content:
            raise ValueError("Article " + str(values.get("id")) + " produced an oversized SQL statement; inspect this row.")
        short_values = list(normalized)
        short_values[idx] = ""
        base = prefix + " INTO articles (" + ",".join(columns) + ") VALUES (" + ",".join(sql_literal(v) for v in short_values) + ");"
        if bytes_len(base) > 85000:
            raise ValueError("Article " + str(values.get("id")) + " has oversized non-content fields.")
        chunks, pending = [], ""
        for ch in str(content):
            if bytes_len(pending + ch) > 22000:
                chunks.append(pending); pending = ""
            pending += ch
        if pending:
            chunks.append(pending)
        update = ["UPDATE articles SET content=content || " + sql_literal(chunk) + " WHERE id=" + sql_literal(values.get("id")) + ";" for chunk in chunks]
        return [base] + update
    raise ValueError("Row in table " + table + " exceeds Cloudflare D1's SQL statement limit; no data was truncated.")

def row_count_from_csv(files):
    return sum(max(0, count_csv_rows(p)) for p in files)

def source_lookup_rows(files):
    result = []
    mapping = {}
    for row in read_rows(files):
        slug = row.get("slug") or ("legacy-" + hashlib.sha1(str(row.get("id", "")).encode()).hexdigest()[:10])
        old_id = row.get("id")
        if old_id:
            mapping[str(old_id)] = slug
        result.append((slug, row))
    return result, mapping

def pre_scan_fallback_sources(root, source_map, articles_files):
    fallbacks = {}
    for row in read_rows(articles_files):
        old_id = str(row.get("source_id") or "")
        if not old_id or old_id in source_map:
            continue
        url = str(row.get("original_url") or row.get("canonical_url") or "")
        host = urlparse(url).netloc.lower()
        host = host[4:] if host.startswith("www.") else host
        if not host:
            host = "imported source"
        slug = "legacy-" + hashlib.sha1(old_id.encode("utf-8")).hexdigest()[:12]
        source_map[old_id] = slug
        fallbacks[old_id] = {"id": slug, "slug": slug, "name": host, "source_type": "rss", "feed_url": "", "country": row.get("country") or "International", "default_category": "World", "enabled": "f"}
    return fallbacks

def main():
    parser = argparse.ArgumentParser(description="Create a SQLite-compatible D1 SQL file from your existing LK Newsroom CSV exports.")
    parser.add_argument("backup_dir", nargs="?", help="Path to LK-Newsroom-Complete-Backup on your Desktop")
    parser.add_argument("--media-map", help="Optional cloudflare-media-map.csv generated by migrateStorageCsvToR2.ts")
    args = parser.parse_args()
    if args.backup_dir:
        root = Path(args.backup_dir).expanduser().resolve()
    else:
        root = Path.home() / "Desktop" / "LK-Newsroom-Complete-Backup"
    if not root.exists():
        print("Backup folder not found: " + str(root), file=sys.stderr)
        print("Run: py -3 scripts/buildCloudflareImport.py \"C:\\\\Users\\\\User\\\\Desktop\\\\LK-Newsroom-Complete-Backup\"", file=sys.stderr)
        return 2

    # Load only successful old-URL -> R2-URL mappings. Failed/skipped objects remain unchanged.
    media_map_path = Path(args.media_map).expanduser().resolve() if args.media_map else root / "cloudflare-media-map.csv"
    media_map = {}
    if media_map_path.exists():
        for media_row in read_rows([media_map_path]):
            old_url = str(media_row.get("old_public_url") or "").strip()
            new_url = str(media_row.get("new_public_url") or "").strip()
            if old_url and new_url and media_row.get("status") == "copied":
                media_map[old_url] = new_url
        print("Successful R2 media URL mappings loaded:", len(media_map), "from", media_map_path)
    else:
        print("No R2 media URL map found; imported rows will keep their current media URLs.")

    # Locate and count the known-good large exports first.
    table_files, table_counts, locations = {}, {}, {}
    import_tables = list(TABLE_ORDER)
    for table in import_tables:
        files, count, location = find_table_csvs(root, table)
        if files:
            table_files[table] = files
            table_counts[table] = count
            locations[table] = location

    article_files = table_files.get("articles", [])
    if not article_files or table_counts.get("articles", 0) != 21191:
        print("STOP: expected the verified 21,191 article rows; found " + str(table_counts.get("articles", 0)) + ".")
        print("Do not import until the article batch files are present and verified.")
        return 2

    source_files = table_files.get("news_sources", [])
    source_rows, source_map = source_lookup_rows(source_files)
    fallbacks = pre_scan_fallback_sources(root, source_map, article_files)
    # Source IDs in the D1 schema are stable slugs; create placeholder source rows for IDs
    # that were present in articles but missing from a source-table export.
    out_path = root / "cloudflare-d1-core-import.sql"
    report_path = root / "cloudflare-d1-import-report.txt"
    written = defaultdict(int)
    warnings = []

    with out_path.open("w", encoding="utf-8", newline="\n") as out:
        out.write("-- Generated locally by scripts/buildCloudflareImport.py. Do not commit this data file.\n")
        out.write("-- Apply cloudflare/schema.sql then cloudflare/schema-operations.sql before importing.\n")
        out.write("PRAGMA foreign_keys=OFF;\n")
        # The schema seeds these slugs, and the insert preserves the stable slug ID.
        for slug, raw in source_rows:
            row = dict(raw)
            row["id"] = slug
            row["slug"] = slug
            row.setdefault("name", slug)
            row.setdefault("source_type", "rss")
            row.setdefault("country", "International")
            row.setdefault("default_category", "World")
            row.setdefault("enabled", "f")
            row.setdefault("created_at", None)
            row.setdefault("updated_at", None)
            stmt = insert_statement("news_sources", row)
            # Avoid replacing seed IDs; UPDATE only attributes, while retaining id=slug.
            cols = [c for c in TABLE_COLUMNS["news_sources"] if c in row and c not in ("id", "slug")]
            norm = [normalize_value("news_sources", c, row.get(c)) for c in cols]
            upsert = "INSERT INTO news_sources(id,slug" + ("," + ",".join(cols) if cols else "") + ") VALUES (" + ",".join(sql_literal(v) for v in [slug,slug] + norm) + ") ON CONFLICT(slug) DO UPDATE SET " + ",".join(c + "=excluded." + c for c in cols) + ";"
            out.write(upsert + "\n")
            written["news_sources"] += 1
        for old_id, fallback in fallbacks.items():
            row = dict(fallback)
            cols = [c for c in TABLE_COLUMNS["news_sources"] if c in row]
            out.write("INSERT OR IGNORE INTO news_sources (" + ",".join(cols) + ") VALUES (" + ",".join(sql_literal(normalize_value("news_sources", c, row.get(c))) for c in cols) + ");\n")
            written["news_sources_fallback"] += 1

        # Small lookup tables and profile/role metadata.
        for table in ["categories", "authors", "tags", "profiles", "users_roles", "settings", "advertisers", "advertising_packages", "membership_plans", "affiliate_campaigns", "affiliate_links", "social_templates"]:
            files = table_files.get(table, [])
            for raw in read_rows(files):
                row = rewrite_media_row(dict(raw), media_map)
                if table in ("authors",) and row.get("source_id"):
                    row["source_id"] = source_map.get(row["source_id"], row["source_id"])
                if table == "users_roles" and not row.get("assigned_at"):
                    row["assigned_at"] = row.get("created_at")
                try:
                    for stmt in insert_statement(table, row, source_map):
                        out.write(stmt + "\n")
                    written[table] += 1
                except Exception as exc:
                    warnings.append(table + ": " + str(exc))
        # Preserve data rows for all public-operational tables supported by the D1 schema.
        for table in ["articles", "article_tags", "breaking_news", "live_updates", "trending_news", "featured_news", "videos", "gallery", "comments", "newsletter", "bookmarks", "article_likes", "advertisements", "advertiser_requests", "sponsored_article_details", "affiliate_events", "subscriptions", "donations", "payment_transactions", "revenue", "company_enquiries", "company_staff_profiles", "social_graphics", "social_accounts", "social_posts", "notification_subscriptions", "daily_briefs", "notifications", "notification_deliveries", "notification_campaigns", "worker_runs"]:
            files = table_files.get(table, [])
            for raw in read_rows(files):
                row = rewrite_media_row(dict(raw), media_map)
                if table == "social_accounts":
                    # OAuth credentials/tokens are deliberately excluded; reconnect accounts
                    # through the new secure admin flow after cutover.
                    row.pop("credentials_encrypted", None)
                    row.pop("refresh_token_encrypted", None)
                    row.pop("credential_key", None)
                    row.pop("token_expires_at", None)
                if table == "articles" and row.get("source_id"):
                    row["source_id"] = source_map.get(row["source_id"], row["source_id"])
                try:
                    stmts = insert_statement(table, row, source_map)
                    for stmt in stmts:
                        out.write(stmt + "\n")
                    written[table] += 1
                except Exception as exc:
                    warnings.append(table + " row " + str(row.get("id") or row.get("article_id") or "") + ": " + str(exc))
        out.write("-- High-volume tables excluded from D1 to preserve the Free-plan storage budget:\n")
        out.write("-- feed_logs, social_logs, analytics_events, page_views, storage.objects and Storage binaries.\n")
        out.write("-- Archive those CSV files in R2 after media migration; don't delete the local backups.\n")

    known_counts = {
        "articles": 21191, "article_tags": 150321, "feed_logs": 171244,
        "social_graphics": 20104, "live_updates": 21191, "social_posts": 38679,
        "tags": 19230, "notifications": 22586, "notification_deliveries": 56646,
        "storage.objects": 154312
    }
    with report_path.open("w", encoding="utf-8") as report:
        report.write("LK Newsroom Cloudflare D1 import preparation report\n")
        report.write("Backup folder: " + str(root) + "\n")
        report.write("Output SQL: " + str(out_path) + "\n")
        report.write("SQL size bytes: " + str(out_path.stat().st_size) + "\n")
        report.write("Successful R2 media URL mappings applied: " + str(len(media_map)) + "\n\n")
        report.write("Discovered CSV rows by selected table folder:\n")
        for table in sorted(table_counts):
            expected = known_counts.get(table)
            status = "EXPECTED_COUNT_MATCH" if expected is not None and table_counts[table] == expected else ("EXPECTED_COUNT_DIFF" if expected is not None else "COUNT_NOT_PREKNOWN")
            report.write(table + "\t" + str(table_counts[table]) + "\t" + status + "\t" + locations.get(table, "") + "\n")
        report.write("\nRows written to SQL by table:\n")
        for table, count in sorted(written.items()):
            report.write(table + "\t" + str(count) + "\n")
        report.write("\nSkipped/archive-only tables:\n")
        for table in ARCHIVE_ONLY:
            report.write(table + "\tARCHIVE_TO_R2_NOT_IMPORTED_TO_D1\n")
        report.write("\nWarnings:\n")
        for warn in warnings:
            report.write(warn + "\n")
        if not warnings:
            report.write("No row conversion warnings detected.\n")
        report.write("\nIMPORTANT: Supabase Auth password/session records are not imported. Staff/reader login migration needs a reset/re-enrolment plan.\n")
        report.write("IMPORTANT: Storage CSV rows are metadata only. Actual files/images/videos must be copied to R2 and URL mappings verified before domain cutover.\n")
    print("Cloudflare D1 SQL built: " + str(out_path))
    print("Report: " + str(report_path))
    print("SQL size: " + str(out_path.stat().st_size) + " bytes")
    print("Articles source rows: " + str(table_counts.get("articles", 0)))
    print("Table CSVs discovered: " + str(len(table_counts)))
    print("Rows written by table: " + str(sum(written.values())))
    print("Warnings: " + str(len(warnings)))
    if warnings:
        for w in warnings[:20]:
            print("WARNING: " + w)
    print("Review cloudflare-d1-import-report.txt before running wrangler d1 execute. This script does not upload anything or alter Supabase.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
