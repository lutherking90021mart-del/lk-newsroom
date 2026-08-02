import { signIn, forgotPassword } from './auth.js';
import { toast } from './components.js';

document.addEventListener('DOMContentLoaded',()=>{
  const login=document.querySelector('#login-form');
  const reset=document.querySelector('#reset-form');
  login?.addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget;
    const button=form.querySelector('[type="submit"]');
    const email=form.elements.email?.value?.trim();
    const password=form.elements.password?.value||'';
    const remember=Boolean(form.elements.remember?.checked);
    if(!email||!password){toast('Enter your email address and password.');return;}
    button.disabled=true;button.textContent='Signing in…';
    try{await signIn(email,password,remember);location.href='index.html';}
    catch(error){toast(error.message||'Unable to sign in.');}
    finally{button.disabled=false;button.textContent='Sign in securely';}
  });
  reset?.addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget;
    const email=form.elements.email?.value?.trim();
    if(!email){toast('Enter your email address.');return;}
    try{await forgotPassword(email);toast('Check your inbox for a password reset link.');form.reset();}
    catch(error){toast(error.message||'Unable to request a reset link.');}
  });
});
