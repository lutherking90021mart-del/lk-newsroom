import { rssProvider } from './rss.js';
export const bbcProviders=[
  rssProvider({slug:'bbc-news',name:'BBC News',feedUrl:'https://feeds.bbci.co.uk/news/rss.xml',country:'United Kingdom',category:'World',sourceType:'rss',enabled:true}),
  // The BBC's publisher-supplied football feed keeps the Sports desk focused on football.
  rssProvider({slug:'bbc-sport',name:'BBC Sport Football',feedUrl:process.env.BBC_SPORT_RSS_URL||'https://feeds.bbci.co.uk/sport/football/rss.xml',country:'United Kingdom',category:'Sports',sourceType:'rss',enabled:true})
];
