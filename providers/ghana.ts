import { configuredRss } from './rss.js';
/** Add only publisher-authorised feeds to these variables; unset sources remain visible but disabled in Admin. */
export const ghanaProviders=[
 configuredRss('joynews','JoyNews','JOYNEWS_RSS_URL','Ghana','Ghana'), configuredRss('citi-newsroom','Citi Newsroom','CITI_NEWSROOM_RSS_URL','Ghana','Ghana'),
 configuredRss('graphic-online','Graphic Online','GRAPHIC_ONLINE_RSS_URL','Ghana','Ghana'), configuredRss('ghanaweb','GhanaWeb','GHANAWEB_RSS_URL','Ghana','Ghana'),
 configuredRss('myjoyonline','MyJoyOnline','MYJOYONLINE_RSS_URL','Ghana','Ghana'), configuredRss('pulse-ghana','Pulse Ghana','PULSE_GHANA_RSS_URL','Ghana','Ghana'),
 configuredRss('daily-guide-network','Daily Guide Network','DAILY_GUIDE_RSS_URL','Ghana','Ghana'), configuredRss('ghana-news-agency','Ghana News Agency (GNA)','GNA_RSS_URL','Ghana','Ghana'),
 configuredRss('tv3-ghana','TV3 Ghana','TV3_GHANA_RSS_URL','Ghana','Ghana'), configuredRss('adom-online','Adom Online','ADOM_ONLINE_RSS_URL','Ghana','Ghana'),
 configuredRss('peace-fm','Peace FM Online','PEACE_FM_RSS_URL','Ghana','Ghana'), configuredRss('modern-ghana','Modern Ghana','MODERN_GHANA_RSS_URL','Ghana','Ghana')
];
