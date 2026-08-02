import { rssProvider } from './rss.js';
export const technologyProviders=[
 rssProvider({slug:'techcrunch',name:'TechCrunch',feedUrl:'https://techcrunch.com/feed/',country:'United States',category:'Technology',sourceType:'rss',enabled:true}),
 rssProvider({slug:'the-verge',name:'The Verge',feedUrl:'https://www.theverge.com/rss/index.xml',country:'United States',category:'Technology',sourceType:'rss',enabled:true}),
 rssProvider({slug:'wired',name:'Wired',feedUrl:'https://www.wired.com/feed/rss',country:'United States',category:'Technology',sourceType:'rss',enabled:true}),
 rssProvider({slug:'ars-technica',name:'Ars Technica',feedUrl:'https://feeds.arstechnica.com/arstechnica/index',country:'United States',category:'Technology',sourceType:'rss',enabled:true})
];
