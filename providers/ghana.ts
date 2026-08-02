import { configuredRss, publisherRss } from './rss.js';
/** Add only publisher-authorised feeds to these variables; unset sources remain visible but disabled in Admin. */
export const ghanaProviders=[
 publisherRss('joynews','JoyNews','JOYNEWS_RSS_URL','https://www.myjoyonline.com/feed/','Ghana','Ghana'), publisherRss('citi-newsroom','Citi Newsroom','CITI_NEWSROOM_RSS_URL','https://www.citinewsroom.com/rss/topstories.rss','Ghana','Ghana'),
 configuredRss('graphic-online','Graphic Online','GRAPHIC_ONLINE_RSS_URL','Ghana','Ghana'), publisherRss('ghanaweb','GhanaWeb','GHANAWEB_RSS_URL','https://www.ghanaweb.com/GhanaHomePage/NewsArchive/rss.xml','Ghana','Ghana'),
 configuredRss('myjoyonline','MyJoyOnline','MYJOYONLINE_RSS_URL','Ghana','Ghana'), configuredRss('pulse-ghana','Pulse Ghana','PULSE_GHANA_RSS_URL','Ghana','Ghana'),
 configuredRss('daily-guide-network','Daily Guide Network','DAILY_GUIDE_RSS_URL','Ghana','Ghana'), configuredRss('ghana-news-agency','Ghana News Agency (GNA)','GNA_RSS_URL','Ghana','Ghana'),
 publisherRss('tv3-ghana','3News / TV3 Ghana','TV3_GHANA_RSS_URL','https://3news.com/feed/','Ghana','Ghana'), publisherRss('adom-online','Adom Online','ADOM_ONLINE_RSS_URL','https://www.adomonline.com/feed/','Ghana','Ghana'),
 configuredRss('peace-fm','Peace FM Online','PEACE_FM_RSS_URL','Ghana','Ghana'), configuredRss('modern-ghana','Modern Ghana','MODERN_GHANA_RSS_URL','Ghana','Ghana')
];
