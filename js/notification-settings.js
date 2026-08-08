import {renderHeader,renderFooter,toast} from './components.js';
import {supabase} from './supabase-client.js';

const api=()=>String(window.LK_AGGREGATOR_API_URL||location.origin).replace(/\/$/,'');
const topics=[['breaking_news','Breaking News Alerts'],['daily_brief','Daily Brief'],['morning_summary','Morning News Summary'],['ghana','Ghana News'],['politics','Politics'],['business','Business'],['technology','Technology'],['sports','Sports'],['entertainment','Entertainment'],['health','Health'],['world','World News'],['africa','Africa News'],['comment_replies','Comment replies'],['supporter_updates','Supporter updates']];
const field=(name)=>document.querySelector(`[name="${name}"]`);
const urlBase64ToBytes=value=>{const padded=value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'=');const raw=atob(padded);return Uint8Array.from(raw,char=>char.charCodeAt(0));};

function preferences(){return Object.fromEntries([...topics.map(([key])=>key), 'email_enabled','sms_enabled'].map(key=>[key,Boolean(field(key)?.checked)]));}
async function subscribePush(){
  if(!('serviceWorker' in navigator)||!('PushManager' in window))throw new Error('Browser notifications are not supported by this browser.');
  const keyResponse=await fetch(`${api()}/v1/notifications/public-key`);const {publicKey}=await keyResponse.json();if(!publicKey)throw new Error('Browser alerts are not configured yet. You can still receive email updates.');
  const registration=await navigator.serviceWorker.register('/sw.js');const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('Notifications were not allowed in your browser.');
  const subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToBytes(publicKey)});return subscription.toJSON();
}
async function save(event){
  event.preventDefault();const form=event.currentTarget;const email=form.elements.email.value.trim();let pushSubscription=null;
  try{if(document.querySelector('#push-enabled').checked)pushSubscription=await subscribePush();const response=await fetch(`${api()}/v1/notifications/subscribe`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,phone:form.elements.phone.value.trim(),preferences:preferences(),pushSubscription})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Unable to save notification preferences.');localStorage.setItem('lk-notification-email',email);toast(pushSubscription?'Preferences saved and browser alerts enabled.':'Preferences saved. Check your email for LK Newsroom updates.');}catch(error){toast(error.message||'Unable to save notification preferences.');}
}
document.addEventListener('DOMContentLoaded',async()=>{
  renderHeader();renderFooter();document.querySelectorAll('[data-year]').forEach(node=>node.textContent=new Date().getFullYear());
  document.querySelector('#notification-topics').innerHTML=topics.map(([key,label],index)=>`<label><input name="${key}" type="checkbox" ${index<3?'checked':''}> ${label}</label>`).join('');
  const form=document.querySelector('#notification-settings');form.elements.email.value=localStorage.getItem('lk-notification-email')||'';form.addEventListener('submit',save);
  try{const {data:{session}}=await supabase?.auth.getSession();if(session){const response=await fetch(`${api()}/v1/notifications/me`,{headers:{Authorization:`Bearer ${session.access_token}`}});if(response.ok){const data=await response.json();const subscription=data.subscription;if(subscription){form.elements.email.value=subscription.email||form.elements.email.value;form.elements.phone.value=subscription.phone||'';for(const [key,value] of Object.entries(subscription.preferences||{})){const input=field(key);if(input)input.checked=Boolean(value);}}}}}catch{}
});
