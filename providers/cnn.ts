import { rssProvider } from './rss.js';
export const cnnProvider=rssProvider({slug:'cnn',name:'CNN',feedUrl:process.env.CNN_RSS_URL||'https://rss.cnn.com/rss/edition.rss',country:'United States',category:'World',sourceType:'rss',enabled:true});
