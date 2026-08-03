import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptSocialToken } from './socialCrypto.js';
import { socialPlatforms, type SocialPlatform } from '../worker/socialPublisher.js';

type OAuthPlatform=Exclude<SocialPlatform,'telegram'>;
type OAuthState={id:string;platform:OAuthPlatform;user_id:string;metadata:Record<string,unknown>;expires_at:string;consumed_at?:string|null;};
const publicOrigin=()=>String(process.env.PUBLIC_ORIGIN||'http://localhost:5173').split(',')[0].replace(/\/$/,'');
const graphVersion=()=>process.env.META_GRAPH_VERSION||'v23.0';
const enc=(value:string)=>encodeURIComponent(value);
const random=()=>crypto.randomBytes(32).toString('base64url');
const callbackFor=(platform:OAuthPlatform)=>`${publicOrigin()}/v1/social/oauth/${platform}/callback`;

function assertPlatform(value:string):asserts value is OAuthPlatform{if(!socialPlatforms.includes(value as SocialPlatform)||value==='telegram')throw new Error('OAuth is available for Facebook, Instagram, Threads, X, and LinkedIn. Telegram uses a Bot token instead.');}
function oauthConfiguration(platform:OAuthPlatform){
  if(platform==='facebook'||platform==='instagram'){
    const clientId=process.env.META_APP_ID,clientSecret=process.env.META_APP_SECRET;if(!clientId||!clientSecret)throw new Error('Add META_APP_ID and META_APP_SECRET in Railway before connecting Meta accounts.');
    return {clientId,clientSecret};
  }
  if(platform==='threads'){
    const clientId=process.env.THREADS_APP_ID,clientSecret=process.env.THREADS_APP_SECRET;if(!clientId||!clientSecret)throw new Error('Add THREADS_APP_ID and THREADS_APP_SECRET in Railway before connecting Threads.');
    return {clientId,clientSecret};
  }
  if(platform==='x'){
    const clientId=process.env.X_CLIENT_ID,clientSecret=process.env.X_CLIENT_SECRET;if(!clientId||!clientSecret)throw new Error('Add X_CLIENT_ID and X_CLIENT_SECRET in Railway before connecting X.');
    return {clientId,clientSecret};
  }
  const clientId=process.env.LINKEDIN_CLIENT_ID,clientSecret=process.env.LINKEDIN_CLIENT_SECRET;if(!clientId||!clientSecret)throw new Error('Add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in Railway before connecting LinkedIn.');
  return {clientId,clientSecret};
}
function headersForm(){return {'Content-Type':'application/x-www-form-urlencoded'};}
async function requestJson(url:string,init:RequestInit){const response=await fetch(url,{...init,signal:AbortSignal.timeout(25_000)});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body?.error?.message||body?.error_description||body?.message||`OAuth request returned ${response.status}`);return body as Record<string,any>;}
function form(values:Record<string,string>){return new URLSearchParams(values).toString();}

export async function beginSocialOAuth(db:SupabaseClient,platformInput:string,userId:string){
  assertPlatform(platformInput);encryptSocialToken('LK Newsroom connection check');const platform=platformInput;const config=oauthConfiguration(platform);const state=random();const metadata:Record<string,unknown>={};
  if(platform==='x'){const verifier=random();metadata.codeVerifier=verifier;metadata.codeChallenge=crypto.createHash('sha256').update(verifier).digest('base64url');}
  const {error}=await db.from('social_oauth_states').insert({state,platform,user_id:userId,metadata,expires_at:new Date(Date.now()+10*60_000).toISOString()});if(error)throw error;
  const redirectUri=callbackFor(platform);let authUrl='';
  if(platform==='facebook'||platform==='instagram')authUrl=`https://www.facebook.com/${graphVersion()}/dialog/oauth?client_id=${enc(config.clientId)}&redirect_uri=${enc(redirectUri)}&state=${enc(state)}&response_type=code&scope=${enc('pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish')}`;
  if(platform==='threads')authUrl=`https://threads.net/oauth/authorize?client_id=${enc(config.clientId)}&redirect_uri=${enc(redirectUri)}&state=${enc(state)}&response_type=code&scope=${enc('threads_basic,threads_content_publish')}`;
  if(platform==='x')authUrl=`https://x.com/i/oauth2/authorize?response_type=code&client_id=${enc(config.clientId)}&redirect_uri=${enc(redirectUri)}&scope=${enc('tweet.read tweet.write users.read offline.access')}&state=${enc(state)}&code_challenge=${enc(String(metadata.codeChallenge))}&code_challenge_method=S256`;
  if(platform==='linkedin')authUrl=`https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${enc(config.clientId)}&redirect_uri=${enc(redirectUri)}&state=${enc(state)}&scope=${enc('openid profile w_member_social w_organization_social')}`;
  return {authUrl,expiresAt:new Date(Date.now()+10*60_000).toISOString()};
}

async function exchange(platform:OAuthPlatform,code:string,state:OAuthState){
  const config=oauthConfiguration(platform);const redirectUri=callbackFor(platform);
  if(platform==='facebook'||platform==='instagram')return requestJson(`https://graph.facebook.com/${graphVersion()}/oauth/access_token?${form({client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:redirectUri,code})}`,{method:'GET'});
  if(platform==='threads')return requestJson('https://graph.threads.net/oauth/access_token',{method:'POST',headers:headersForm(),body:form({client_id:config.clientId,client_secret:config.clientSecret,grant_type:'authorization_code',redirect_uri:redirectUri,code})});
  if(platform==='x')return requestJson('https://api.x.com/2/oauth2/token',{method:'POST',headers:{...headersForm(),Authorization:`Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`},body:form({code,grant_type:'authorization_code',redirect_uri:redirectUri,code_verifier:String(state.metadata.codeVerifier||'')})});
  return requestJson('https://www.linkedin.com/oauth/v2/accessToken',{method:'POST',headers:headersForm(),body:form({grant_type:'authorization_code',code,redirect_uri:redirectUri,client_id:config.clientId,client_secret:config.clientSecret})});
}

async function identity(platform:OAuthPlatform,accessToken:string){
  if(platform==='facebook'||platform==='instagram'){
    const pages=await requestJson(`https://graph.facebook.com/${graphVersion()}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${enc(accessToken)}`,{method:'GET'});const page=pages.data?.[0];if(!page)throw new Error('No Facebook Page was returned. Confirm the signed-in account manages a Page and approved the requested permissions.');
    if(platform==='instagram'){const instagram=page.instagram_business_account;if(!instagram?.id)throw new Error('No Instagram professional account is linked to the selected Facebook Page.');return {accountId:String(instagram.id),displayName:String(instagram.username||page.name||'Instagram'),token:String(page.access_token||accessToken),metadata:{pageId:String(page.id),pageName:String(page.name||'')}};}
    return {accountId:String(page.id),displayName:String(page.name||'Facebook Page'),token:String(page.access_token||accessToken),metadata:{}};
  }
  if(platform==='threads'){const me=await requestJson('https://graph.threads.net/v1.0/me?fields=id,username',{headers:{Authorization:`Bearer ${accessToken}`}});return {accountId:String(me.id),displayName:String(me.username||'Threads'),token:accessToken,metadata:{}};}
  if(platform==='x'){const me=await requestJson('https://api.x.com/2/users/me',{headers:{Authorization:`Bearer ${accessToken}`}});return {accountId:String(me.data?.id),displayName:String(me.data?.name||me.data?.username||'X'),token:accessToken,metadata:{username:me.data?.username||''}};}
  const me=await requestJson('https://api.linkedin.com/v2/userinfo',{headers:{Authorization:`Bearer ${accessToken}`}});return {accountId:`urn:li:person:${String(me.sub)}`,displayName:String(me.name||me.localizedFirstName||'LinkedIn'),token:accessToken,metadata:{}};
}

export async function completeSocialOAuth(db:SupabaseClient,platformInput:string,stateValue:string,code:string){
  assertPlatform(platformInput);const platform=platformInput;const {data,error}=await db.from('social_oauth_states').select('*').eq('state',stateValue).maybeSingle();if(error)throw error;if(!data)throw new Error('This connection link is invalid or has expired. Start again from Admin → Social Media.');
  const state=data as OAuthState;if(state.platform!==platform||state.consumed_at||new Date(state.expires_at)<new Date())throw new Error('This connection link has expired. Start again from Admin → Social Media.');
  const token=await exchange(platform,code,state);const accessToken=String(token.access_token||'');if(!accessToken)throw new Error('The platform did not return an access token.');const account=await identity(platform,accessToken);
  const expiry=Number(token.expires_in||0)?new Date(Date.now()+Number(token.expires_in)*1000).toISOString():null;
  const payload={platform,display_name:account.displayName,account_id:account.accountId,credential_key:null,credentials_encrypted:encryptSocialToken(account.token),refresh_token_encrypted:token.refresh_token?encryptSocialToken(String(token.refresh_token)):null,token_expires_at:expiry,enabled:true,auto_post:true,metadata:account.metadata,created_by:state.user_id,last_error:null};
  const {error:saveError}=await db.from('social_accounts').upsert(payload,{onConflict:'platform,account_id'});if(saveError)throw saveError;
  await db.from('social_oauth_states').update({consumed_at:new Date().toISOString()}).eq('id',state.id);
  return {platform,displayName:account.displayName};
}
