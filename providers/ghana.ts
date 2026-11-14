import { configuredRss } from './rss.js';

/**
 * Ghana-first source registry. Every endpoint is configured through a server-side
 * environment variable. A publisher is not enabled merely because it appears here:
 * confirm feed access and permitted use, configure the endpoint, then enable in Admin.
 * JoyNews and MyJoyOnline are one Multimedia Group source family, not two independent
 * confirmations of the same story.
 */
export const ghanaProviders = [
  configuredRss('joynews', 'JoyNews / MyJoyOnline', 'JOYNEWS_RSS_URL', 'Ghana', 'Ghana'),
  configuredRss('yen-com-gh', 'YEN.com.gh', 'YEN_COM_GH_RSS_URL', 'Ghana', 'Ghana'),
  configuredRss('graphic-online', 'Graphic Online', 'GRAPHIC_ONLINE_RSS_URL', 'Ghana', 'Ghana'),
  configuredRss('citi-newsroom', 'Citi Newsroom', 'CITI_NEWSROOM_RSS_URL', 'Ghana', 'Ghana'),
  configuredRss('ghanaweb', 'GhanaWeb', 'GHANAWEB_RSS_URL', 'Ghana', 'Ghana'),
  configuredRss('3news', '3News', 'THREE_NEWS_RSS_URL', 'Ghana', 'Ghana'),
  configuredRss('gbc-ghana', 'GBC Ghana', 'GBC_GHANA_RSS_URL', 'Ghana', 'Ghana'),
  configuredRss('ghana-news-agency', 'Ghana News Agency (GNA)', 'GNA_RSS_URL', 'Ghana', 'Ghana'),
];
