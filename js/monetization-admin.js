const $=(selector,parent=document)=>parent.querySelector(selector);
const esc=(value='')=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const apiRoot=()=>window.LK_AGGREGATOR_API_URL||location.origin;
async function adminRequest(path,options={}){const {data:session}=await (await import('./admin-client.js')).supabase.auth.getSession();const response=await fetch(`${apiRoot()}${path}`,{...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.session?.access_token||''}`,...(options.headers||{})}});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Request failed.');return payload;}

export async function mountMonetizationSuite(){
  const view=$('#admin-view');
  if(!view)return;
  view.innerHTML=`
    <div class="monetization-suite">
      <section class="panel">
        <div class="section-heading">
          <div>
            <h3>Free public access policy</h3>
            <p class="text-muted">LK Newsroom does not charge readers for news, articles, videos, categories, community announcements or public features.</p>
          </div>
        </div>
        <p>Paid reader memberships, premium-content gates, paid community submissions, advertising package checkout and payment links are disabled. Do not make content access depend on a payment.</p>
        <p><a class="text-link" href="/pages/support.html" target="_blank" rel="noopener">View the public optional-support page</a></p>
      </section>
      <section class="panel">
        <div class="section-heading">
          <div>
            <h3>Voluntary support</h3>
            <p class="text-muted">A reader may choose to help, but contributions are never requested as a condition of access or service.</p>
          </div>
        </div>
        <p>Online checkout is disabled. If a reader asks to contribute, direct them to contact LK Newsroom through the official contact page for current, verified options. Do not send unsolicited payment requests, and never share payment instructions from an unverified message.</p>
        <p><a class="text-link" href="/pages/company.html#support" target="_blank" rel="noopener">Open LK Newsroom support information</a></p>
      </section>
      <section class="panel">
        <div class="section-heading">
          <div>
            <h3>Existing records preserved</h3>
            <p class="text-muted">Legacy package, membership and transaction records are retained for audit/compatibility.</p>
          </div>
        </div>
        <p>This screen no longer creates paid packages, membership plans, or checkout links. Existing financial records have not been deleted or altered.</p>
      </section>
    </div>`;
}
