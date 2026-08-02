import { configuredRss } from './rss.js';
import { guardianProvider } from './guardian.js';
export const businessProviders=[guardianProvider(),configuredRss('bloomberg','Bloomberg','BLOOMBERG_RSS_URL','United States','Business'),configuredRss('financial-times','Financial Times','FINANCIAL_TIMES_RSS_URL','United Kingdom','Business'),configuredRss('cnbc','CNBC','CNBC_RSS_URL','United States','Business'),configuredRss('reuters-business','Reuters Business','REUTERS_BUSINESS_RSS_URL','International','Business')];
