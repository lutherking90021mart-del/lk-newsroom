import type {SupabaseClient} from '@supabase/supabase-js';
import {sendWebPush} from '../services/webPush.js';

type Channel='push'|'email'|'sms';
type Subscription={id:string;user_id?:string|null;email:string;phone?:string|null;push_endpoint?:string|null;push_subscription?:Record<string,unknown>|null;preferences?:Record<string,unknown>|null;active:boolean;};
type Article={id:string;slug?:string|null;title:string;excerpt?:string|null;ai_summary?:string|null;featured_image_url?:string|null;breaking?:boolean|null;published_at?:string|null;categories?:{name?:string|null;slug?:string|null}|null;};
type NotificationRow={id:string;subscription_id:string;title:string;message:string;type:string;url?:string|null;metadata?:Record<string,unknown>|null;notification_subscriptions:Subscription;};
export type NotificationRunResult={status:'completed'|'skipped'|'unavailable';newsQueued:number;briefsQueued:number;campaignsQueued:number;delivered:number;retried:number;failed:number;errors:number;};

const notificationCategories=new Set(['ghana','politics','business','technology','sports','entertainment','health','world','africa']);
const origin=()=>String(process.env.PUBLIC_ORIGIN||'http://localhost:5173').split(',')[0].replace(/\/$/,'');
const text=(value:unknown,max=600)=>String(value??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const html=(value:unknown)=>text(value,3000).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]!));
const articleUrl=(article:Pick<Article,'id'|'slug'>)=>`${origin()}/news/${encodeURIComponent(article.slug||article.id)}`;
const truth=(value:unknown,fallback=false)=>typeof value==='boolean'?value:String(value??'').toLowerCase()==='true'?true:fallback;
const prefs=(subscription:Subscription)=>subscription.preferences||{};
const pref=(subscription:Subscription,key:string,fallback=false)=>truth(prefs(subscription)[key],fallback);
const validUrl=(value:unknown)=>typeof value==='string'&&/^https:\/\//i.test(value)?value:null;
const chunks=<T>(list:T[],size=200)=>Array.from({length:Math.ceil(list.length/size)},(_,index)=>list.slice(index*size,index*size+size));
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

function localParts(date=new Date()){
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:process.env.TZ||'Africa/Accra',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hour12:false});
  const values=Object.fromEntries(formatter.formatToParts(date).filter(item=>item.type!=='literal').map(item=>[item.type,item.value]));
  return {date:`${values.year}-${values.month}-${values.day}`,hour:Number(values.hour||0)};
}

function categoryOf(article:Article){return String(article.categories?.slug||'').toLowerCase();}
function summary(article:Article){return text(article.ai_summary||article.excerpt||'Read the latest verified reporting from LK Newsroom.',300);}
function channelsFor(subscription:Subscription):Channel[]{const result:Channel[]=[];if(pref(subscription,'email_enabled',true)&&subscription.email)result.push('email');if(pref(subscription,'push_enabled')&&subscription.push_endpoint&&subscription.push_subscription)result.push('push');if(pref(subscription,'sms_enabled')&&subscription.phone)result.push('sms');return result;}

async function sendEmail(to:string,row:NotificationRow){
  const apiKey=String(process.env.RESEND_API_KEY||'').trim();const from=String(process.env.EMAIL_FROM||'').trim();
  if(!apiKey||!from)throw new Error('Email delivery is not configured. Add RESEND_API_KEY and EMAIL_FROM in Railway.');
  const briefItems=Array.isArray(row.metadata?.articles)?row.metadata?.articles as any[]:[];
  const list=briefItems.length?`<ol>${briefItems.map(article=>`<li style="margin:14px 0"><a href="${html(article.url)}" style="color:#003366;font-weight:700;text-decoration:none">${article.image?`<img src="${html(article.image)}" alt="" style="display:block;width:100%;max-width:300px;height:150px;object-fit:cover;margin:0 0 8px;border-radius:6px">`:''}${html(article.title)}</a></li>`).join('')}</ol>`:'';
  const url=validUrl(row.url);const body=`<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#0b1e33"><p style="font-weight:800;color:#e31e24">LK NEWSROOM</p><h1>${html(row.title)}</h1><p>${html(row.message)}</p>${list}${url?`<p><a href="${html(url)}" style="background:#0057b8;color:#fff;padding:12px 18px;text-decoration:none;border-radius:5px;font-weight:bold">Read more</a></p>`:''}<hr><p style="font-size:12px;color:#64748b">You received this because you subscribed to LK Newsroom updates. Manage preferences at <a href="${origin()}/pages/notifications.html">LK Newsroom</a>.</p></div>`;
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({from,to,subject:row.title,html:body}),signal:AbortSignal.timeout(25_000)});const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(payload.message||payload.error||`Email provider returned ${response.status}.`);return String(payload.id||'');
}

async function sendSms(to:string,row:NotificationRow){
  const sid=String(process.env.TWILIO_ACCOUNT_SID||'').trim(),token=String(process.env.TWILIO_AUTH_TOKEN||'').trim(),messagingService=String(process.env.TWILIO_MESSAGING_SERVICE_SID||'').trim(),from=String(process.env.TWILIO_FROM_NUMBER||'').trim();
  if(!sid||!token||(!messagingService&&!from))throw new Error('SMS delivery is not configured. Add Twilio credentials in Railway, or disable SMS for this subscriber.');
  const values=new URLSearchParams({To:to,Body:`${row.title}\n${text(row.message,250)}${row.url?`\n${row.url}`:''}`.slice(0,1500)});if(messagingService)values.set('MessagingServiceSid',messagingService);else values.set('From',from);
  const response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:values,signal:AbortSignal.timeout(25_000)});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.message||`SMS provider returned ${response.status}.`);return String(payload.sid||'');
}

export class NotificationWorker {
  constructor(private db:SupabaseClient){}

  async run():Promise<NotificationRunResult>{
    const empty={status:'completed' as const,newsQueued:0,briefsQueued:0,campaignsQueued:0,delivered:0,retried:0,failed:0,errors:0};
    const {data:locked,error:lockError}=await this.db.rpc('acquire_news_worker_lock',{p_lock_name:'notification-delivery',lease_seconds:270});
    if(lockError){if(/notification_|daily_briefs|relation.*does not exist|PGRST205/i.test(lockError.message||''))return {...empty,status:'unavailable' as const};throw lockError;}
    if(!locked)return {...empty,status:'skipped' as const};
    try{
      empty.newsQueued=await this.queueRecentNews();
      empty.briefsQueued=await this.createDailyBrief();
      empty.campaignsQueued=await this.queueDueCampaigns();
      await this.ensureDeliveryRows();
      Object.assign(empty,await this.deliverDue());
      return empty;
    }catch(error){
      if(/notification_|daily_briefs|relation.*does not exist|PGRST205/i.test(error instanceof Error?error.message:''))return {...empty,status:'unavailable' as const};
      throw error;
    }finally{await this.db.rpc('release_news_worker_lock',{p_lock_name:'notification-delivery'});}
  }

  async createDailyBrief(force=false){
    const local=localParts();const scheduledHour=Math.max(0,Math.min(23,Number(process.env.DAILY_BRIEF_HOUR||7)));
    if(!force&&local.hour!==scheduledHour)return 0;
    const {data:existing,error:existingError}=await this.db.from('daily_briefs').select('id,status').eq('sent_date',local.date).maybeSingle();if(existingError)throw existingError;
    if(existing?.status==='sent'||existing?.status==='sending')return 0;
    const since=new Date(Date.now()-30*60*60_000).toISOString();const {data:articles,error:articleError}=await this.db.from('articles').select('id,slug,title,excerpt,ai_summary,featured_image_url,published_at,breaking,view_count,categories(name,slug)').eq('status','published').gte('published_at',since).order('breaking',{ascending:false}).order('view_count',{ascending:false}).order('published_at',{ascending:false}).limit(6);if(articleError)throw articleError;
    const selected=(articles||[]) as Article[];if(!selected.length)return 0;
    const articleData=selected.map(article=>({id:article.id,title:article.title,url:articleUrl(article),image:article.featured_image_url||null,category:article.categories?.name||'News'}));const title='LK Newsroom Daily Brief';const message=`Good morning! Here are today’s biggest stories: ${selected.slice(0,3).map((article,index)=>`${index+1}. ${article.title}`).join(' ')}`;
    const payload={title,summary:message,articles:articleData,sent_date:local.date,status:'sending',scheduled_for:new Date().toISOString(),sent_at:new Date().toISOString()};let briefId=existing?.id;
    if(briefId){const {error}=await this.db.from('daily_briefs').update(payload).eq('id',briefId);if(error)throw error;}else{const {data,error}=await this.db.from('daily_briefs').insert(payload).select('id').single();if(error)throw error;briefId=data.id;}
    const subscriptions=await this.activeSubscriptions();const eligible=subscriptions.filter(subscription=>pref(subscription,'daily_brief',true)||pref(subscription,'morning_summary',true));
    const queued=await this.queueNotifications(eligible,{title,message,type:'daily_brief',url:`${origin()}/pages/latest.html`,dailyBriefId:briefId,metadata:{articles:articleData}});
    await this.db.from('daily_briefs').update({status:'sent'}).eq('id',briefId);return queued;
  }

  private async queueRecentNews(){
    const from=new Date(Date.now()-7*24*60*60_000).toISOString();const {data,error}=await this.db.from('articles').select('id,slug,title,excerpt,ai_summary,featured_image_url,breaking,published_at,categories(name,slug)').eq('status','published').gte('published_at',from).order('published_at',{ascending:false}).limit(250);if(error)throw error;
    const subscriptions=await this.activeSubscriptions();let queued=0;
    for(const article of (data||[]) as Article[]){
      const category=categoryOf(article);const categorySubscribers=category&&notificationCategories.has(category)?subscriptions.filter(subscription=>pref(subscription,category)):[];
      if(article.breaking){queued+=await this.queueNotifications(subscriptions.filter(subscription=>pref(subscription,'breaking_news',true)),{title:'🚨 BREAKING NEWS',message:`${article.title}. ${summary(article)}`,type:'breaking',article,url:articleUrl(article)});}
      if(categorySubscribers.length){queued+=await this.queueNotifications(categorySubscribers,{title:`${article.categories?.name||'News'} update`,message:`${article.title}. ${summary(article)}`,type:'category',article,url:articleUrl(article)});}
    }
    return queued;
  }

  private async queueDueCampaigns(){
    const now=new Date().toISOString();const {data,error}=await this.db.from('notification_campaigns').select('*').eq('status','scheduled').lte('scheduled_for',now).order('scheduled_for').limit(20);if(error)throw error;const subscriptions=await this.activeSubscriptions();let queued=0;
    for(const campaign of data||[]){
      await this.db.from('notification_campaigns').update({status:'sending'}).eq('id',campaign.id);
      const required=[...(campaign.audience_preferences||[]),...(campaign.category_slugs||[])];const eligible=required.length?subscriptions.filter(subscription=>required.some(key=>pref(subscription,key))):subscriptions;
      queued+=await this.queueNotifications(eligible,{title:campaign.title,message:campaign.message,type:campaign.type||'manual',url:validUrl(campaign.url)||`${origin()}/`,metadata:{campaignId:campaign.id},channels:(campaign.channels||[]) as Channel[]});
      await this.db.from('notification_campaigns').update({status:'sent',sent_at:new Date().toISOString()}).eq('id',campaign.id);
    }
    return queued;
  }

  private async activeSubscriptions(){
    const result:Subscription[]=[];let from=0;while(from<20_000){const {data,error}=await this.db.from('notification_subscriptions').select('id,user_id,email,phone,push_endpoint,push_subscription,preferences,active').eq('active',true).range(from,from+999);if(error)throw error;result.push(...((data||[]) as Subscription[]));if((data||[]).length<1000)break;from+=1000;}return result;
  }

  private async queueNotifications(subscriptions:Subscription[],options:{title:string;message:string;type:string;url?:string|null;article?:Article;dailyBriefId?:string;metadata?:Record<string,unknown>;channels?:Channel[]}){
    let queued=0;for(const list of chunks(subscriptions)){const rows=list.map(subscription=>({subscription_id:subscription.id,user_id:subscription.user_id||null,article_id:options.article?.id||null,daily_brief_id:options.dailyBriefId||null,title:options.title,message:options.message,type:options.type,url:options.url||null,metadata:options.metadata||{},dedupe_key:`${options.type}:${options.article?.id||options.dailyBriefId||options.metadata?.campaignId||options.title}:${subscription.id}`}));const {data,error}=await this.db.from('notifications').upsert(rows,{onConflict:'dedupe_key'}).select('id,subscription_id');if(error)throw error;const subscriptionsById=new Map(list.map(subscription=>[subscription.id,subscription]));const deliveries=(data||[]).flatMap((notification:any)=>{const subscription=subscriptionsById.get(notification.subscription_id);if(!subscription)return[];const desired=options.channels?.length?options.channels.filter(channel=>channelsFor(subscription).includes(channel)):channelsFor(subscription);return desired.map(channel=>({notification_id:notification.id,subscription_id:subscription.id,channel,status:'pending',scheduled_for:new Date().toISOString()}));});if(deliveries.length){const saved=await this.db.from('notification_deliveries').upsert(deliveries,{onConflict:'notification_id,channel',ignoreDuplicates:true});if(saved.error)throw saved.error;}queued+=(data||[]).length;}return queued;
  }

  private async ensureDeliveryRows(){
    const since=new Date(Date.now()-14*24*60*60_000).toISOString();const {data,error}=await this.db.from('notifications').select('id,subscription_id,notification_deliveries(id)').gte('created_at',since).limit(2_000);if(error)throw error;const missing=(data||[]).filter((row:any)=>!row.notification_deliveries?.length);if(!missing.length)return;const {data:subscriptions,error:subscriptionError}=await this.db.from('notification_subscriptions').select('id,email,phone,push_endpoint,push_subscription,preferences,active').in('id',missing.map((row:any)=>row.subscription_id));if(subscriptionError)throw subscriptionError;const lookup=new Map((subscriptions||[]).map((subscription:any)=>[subscription.id,subscription as Subscription]));const rows=missing.flatMap((notification:any)=>{const subscription=lookup.get(notification.subscription_id);return subscription?channelsFor(subscription).map(channel=>({notification_id:notification.id,subscription_id:subscription.id,channel,status:'pending',scheduled_for:new Date().toISOString()})):[];});if(rows.length){const saved=await this.db.from('notification_deliveries').upsert(rows,{onConflict:'notification_id,channel',ignoreDuplicates:true});if(saved.error)throw saved.error;}}

  private async deliverDue(){
    const now=new Date();const stale=new Date(now.getTime()-15*60_000).toISOString();await this.db.from('notification_deliveries').update({status:'retry',locked_at:null,next_attempt_at:now.toISOString(),last_error:'Recovered after an interrupted worker run.'}).eq('status','processing').lt('locked_at',stale);
    const {data,error}=await this.db.from('notification_deliveries').select('*,notifications(id,subscription_id,title,message,type,url,metadata,notification_subscriptions(*))').in('status',['pending','retry']).lte('scheduled_for',now.toISOString()).order('scheduled_for').limit(120);if(error)throw error;let delivered=0,retried=0,failed=0,errors=0;
    for(const delivery of data||[]){if(delivery.next_attempt_at&&new Date(delivery.next_attempt_at)>now)continue;const notification=delivery.notifications as NotificationRow|undefined;const subscription=notification?.notification_subscriptions;if(!notification||!subscription?.active){await this.db.from('notification_deliveries').update({status:'cancelled',last_error:'Subscriber is inactive or notification was removed.'}).eq('id',delivery.id);continue;}const attempts=Number(delivery.attempts||0)+1;await this.db.from('notification_deliveries').update({status:'processing',attempts,locked_at:now.toISOString()}).eq('id',delivery.id);try{let providerId='';if(delivery.channel==='push'){await sendWebPush(subscription.push_subscription||{}, {title:notification.title,body:notification.message,url:notification.url||`${origin()}/`,tag:notification.id,type:notification.type});providerId='web-push';}else if(delivery.channel==='email')providerId=await sendEmail(subscription.email,notification);else providerId=await sendSms(String(subscription.phone||''),notification);const sentAt=new Date().toISOString();await this.db.from('notification_deliveries').update({status:'sent',sent_at:sentAt,provider_id:providerId,locked_at:null,next_attempt_at:null,last_error:null}).eq('id',delivery.id);await this.db.from('notification_subscriptions').update({last_delivered_at:sentAt}).eq('id',subscription.id);delivered++;}catch(error){errors++;const message=error instanceof Error?error.message:String(error);const status=(error as Error & {status?:number}).status;if(delivery.channel==='push'&&(status===404||status===410)){const updated={...(subscription.preferences||{}),push_enabled:false};await this.db.from('notification_subscriptions').update({push_endpoint:null,push_token:null,push_subscription:{},preferences:updated}).eq('id',subscription.id);}const finalAttempt=attempts>=Number(delivery.max_attempts||5);const retryAt=new Date(Date.now()+Math.min(60,2**attempts)*60_000).toISOString();await this.db.from('notification_deliveries').update({status:finalAttempt?'failed':'retry',last_error:message,locked_at:null,next_attempt_at:finalAttempt?null:retryAt}).eq('id',delivery.id);if(finalAttempt)failed++;else retried++;}}
    return {delivered,retried,failed,errors};
  }
}
