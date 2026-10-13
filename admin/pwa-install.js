let deferredInstallPrompt=null;
const installButton=document.createElement('button');
installButton.type='button';
installButton.className='lk-admin-install-button';
installButton.textContent='Install Admin App';
installButton.setAttribute('aria-label','Install LK Newsroom Admin app');
installButton.hidden=true;
Object.assign(installButton.style,{position:'fixed',right:'18px',bottom:'18px',zIndex:'9999',border:'0',borderRadius:'999px',padding:'12px 18px',background:'#003366',color:'#fff',fontWeight:'700',boxShadow:'0 8px 24px rgba(0,0,0,.22)',cursor:'pointer'});
document.addEventListener('DOMContentLoaded',()=>{
  document.body.appendChild(installButton);
  if('serviceWorker' in navigator)navigator.serviceWorker.register('/admin/sw.js',{scope:'/admin/'}).catch(error=>console.warn('Admin app offline shell unavailable:',error));
  const standalone=window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
  if(standalone){installButton.hidden=true;return;}
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;installButton.hidden=false;});
  window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;installButton.hidden=true;});
  installButton.addEventListener('click',async()=>{
    if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;installButton.hidden=true;return;}
    alert('To install LK Newsroom Admin, open your browser menu and choose Install app or Apps → Install this site as an app. On iPhone or iPad, use Share → Add to Home Screen.');
  });
  if(/iPhone|iPad|iPod/i.test(navigator.userAgent)&&!standalone)installButton.hidden=false;
});
