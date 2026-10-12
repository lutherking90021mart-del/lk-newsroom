
import { XMLParser } from 'fast-xml-parser';
import type {
  NewsCategory,
  NewsProvider,
  NormalizedNewsArticle,
  SourceDefinition,
} from './types.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
  htmlEntities: true,
});

const list = <T>(value: T | T[] | undefined): T[] =>
  value ? (Array.isArray(value) ? value : [value]) : [];

const text = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : value && typeof value === 'object'
      ? String((value as Record<string, unknown>)['#text'] || '')
      : '';

const stripHtml = (value: string) =>
  value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const safeDate = (value: unknown) => {
  const date = new Date(text(value));
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
};

function imageOf(item: Record<string, unknown>): string {
  const urlFrom = (value: unknown, depth = 0): string => {
    if (!value || depth > 8) return '';

    if (typeof value === 'string') {
      const candidate = value.trim();
      return /^https?:\/\/[^\s"'<>]+$/i.test(candidate)
        ? candidate
        : '';
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = urlFrom(entry, depth + 1);
        if (found) return found;
      }
      return '';
    }

    if (typeof value !== 'object') return '';

    const record = value as Record<string, unknown>;

    // Common RSS, Media RSS and Atom image URL attributes.
    for (const key of [
      '@_url',
      '@_href',
      '@_src',
      'url',
      'href',
      'src',
    ]) {
      const found = urlFrom(record[key], depth + 1);
      if (found) return found;
    }

    // Some feeds place the URL in an element's text value.
    const valueText = record['#text'];
    if (typeof valueText === 'string') {
      const found = urlFrom(valueText, depth + 1);
      if (found) return found;
    }

    // Inspect nested media groups and thumbnail/content objects.
    for (const key of [
      'thumbnail',
      'content',
      'group',
      'image',
      'media',
      'enclosure',
      'item',
    ]) {
      const found = urlFrom(record[key], depth + 1);
      if (found) return found;
    }

    return '';
  };

  // Check explicit image fields before searching HTML content.
  for (const field of [
    'thumbnail',
    'image',
    'enclosure',
    'media:thumbnail',
    'media:content',
    'media:group',
    'thumbnail',
    'group',
  ]) {
    const found = urlFrom(item[field]);
    if (found) return found;
  }

  // With removeNSPrefix enabled, media:content can become content.
  // Prefer nested image metadata rather than arbitrary article text.
  for (const field of ['content', 'content:encoded']) {
    const found = urlFrom(item[field]);
    if (found) return found;
  }

  // Some RSS feeds embed the thumbnail directly in their HTML.
  for (const field of ['description', 'summary', 'content:encoded']) {
    const html = text(item[field]);

    const imgTags = html.match(/<img\b[^>]*>/gi) || [];

    for (const tag of imgTags) {
      const match = tag.match(
        /\b(?:src|data-src|data-original)=["']([^"']+)["']/i,
      );

      if (match?.[1] && /^https?:\/\//i.test(match[1])) {
        return match[1];
      }
    }
  }

  return '';
}

/** Parses publisher-supplied RSS/Atom XML only. */
export function rssProvider(source: SourceDefinition): NewsProvider {
  return {
    source,
    async fetch() {
      if (!source.feedUrl) return [];

      const response = await fetch(source.feedUrl, {
        headers: {
          accept: 'application/rss+xml, application/xml, text/xml',
          'user-agent':
            'LK-Newsroom-Aggregator/1.0 (+contact@lknewsroom.example)',
        },
      });

      if (!response.ok) {
        throw new Error(`${source.slug} feed returned ${response.status}`);
      }

      const doc = parser.parse(await response.text()) as Record<string, any>;
      const channel = doc.rss?.channel || doc.feed || {};
      const items = list<Record<string, unknown>>(
        channel.item || channel.entry,
      );

      return items
        .map((item) => {
          const url = text(
            item.link && typeof item.link === 'object'
              ? (item.link as Record<string, unknown>)['@_href']
              : item.link,
          );

          const description = stripHtml(
            text(item.description || item.summary || item.content),
          );

          const authorObject =
            item.author && typeof item.author === 'object'
              ? (item.author as Record<string, unknown>)
              : undefined;

          const article: NormalizedNewsArticle = {
            title: stripHtml(text(item.title)),
            description,
            content: stripHtml(
              text(item['content:encoded'] || item.content),
            ),
            image: imageOf(item) || undefined,
            source: source.name,
            sourceSlug: source.slug,
            author: stripHtml(
              text(item.creator || authorObject?.name || item.author),
            ),
            publishedAt: safeDate(
              item.pubDate || item.published || item.updated,
            ),
            updatedAt: safeDate(
              item.updated || item.pubDate || item.published,
            ),
            category: source.category,
            country: source.country,
            url,
            externalId: text(item.guid || item.id || url),
            raw: item,
          };

          return article;
        })
        .filter((article) => article.title && article.url);
    },
  };
}

export function configuredRss(
  slug: string,
  name: string,
  envKey: string,
  country: string,
  category: NewsCategory,
): NewsProvider {
  const feedUrl = process.env[envKey];

  return rssProvider({
    slug,
    name,
    feedUrl,
    country,
    category,
    sourceType: 'rss',
    enabled: Boolean(feedUrl),
  });
}

/** A publisher's public RSS feed, optionally overridden by an environment variable. */
export function publisherRss(
  slug: string,
  name: string,
  envKey: string,
  defaultFeedUrl: string,
  country: string,
  category: NewsCategory,
): NewsProvider {
  const feedUrl =
    process.env[envKey]?.trim() || defaultFeedUrl;

  return rssProvider({
    slug,
    name,
    feedUrl,
    country,
    category,
    sourceType: 'rss',
    enabled: true,
  });
}
