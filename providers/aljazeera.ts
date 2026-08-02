import { rssProvider } from './rss.js';
export const aljazeeraProvider=rssProvider({slug:'al-jazeera',name:'Al Jazeera',feedUrl:process.env.ALJAZEERA_RSS_URL||'https://www.aljazeera.com/xml/rss/all.xml',country:'Qatar',category:'World',sourceType:'rss',enabled:true});
