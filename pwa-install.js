let lkInstallPrompt=null;
document.addEventListener('DOMContentLoaded',()=>{
  if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js?v=lk-newsroom-mobile-cache-v4',{scope:'/',updateViaCache:'none'}).then(registration=>registration.update()).catch(error=>console.warn('LK Newsroom offline shell unavailable:',error));
  const installed=window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
  if(installed)return;
  const button=document.createElement('button');
  button.type='button';
  button.className='lk-public-install-button';
  button.textContent='Install LK Newsroom';
  button.setAttribute('aria-label','Install LK Newsroom app');
  Object.assign(button.style,{position:'fixed',right:'18px',bottom:'18px',zIndex:'9998',border:'0',borderRadius:'999px',padding:'12px 18px',background:'#003366',color:'#fff',fontWeight:'700',boxShadow:'0 8px 24px rgba(0,0,0,.22)',cursor:'pointer'});
  document.body.appendChild(button);
  const hide=()=>{button.hidden=true;};
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();lkInstallPrompt=event;button.hidden=false;});
  window.addEventListener('appinstalled',()=>{lkInstallPrompt=null;hide();});
  button.addEventListener('click',async()=>{
    if(lkInstallPrompt){lkInstallPrompt.prompt();await lkInstallPrompt.userChoice;lkInstallPrompt=null;hide();return;}
    if(/iPhone|iPad|iPod/i.test(navigator.userAgent)){alert('To install LK Newsroom, tap Share in Safari, then choose Add to Home Screen.');return;}
    alert('To install LK Newsroom, open your browser menu and choose Install app or Apps → Install this site as an app.');
  });
  if(!/iPhone|iPad|iPod/i.test(navigator.userAgent))button.hidden=true;
});
