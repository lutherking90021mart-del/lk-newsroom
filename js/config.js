// Public client configuration. Set these values locally or in your deployment pipeline.
window.LK_SUPABASE_URL = window.LK_SUPABASE_URL || 'https://ebfqwczwavxdksnsoixo.supabase.co';
window.LK_SUPABASE_ANON_KEY = window.LK_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViZnF3Y3p3YXZ4ZGtzbnNvaXhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2MjQ1MTMsImV4cCI6MjEwMTIwMDUxM30.t4AtGQ0qAPWD6_xFNN0nX5QTw1fOZc5PcN_4wqsMwbg';
window.LK_AGGREGATOR_API_URL = window.LK_AGGREGATOR_API_URL || location.origin;

// Load Google AdSense on public pages so Auto ads can work throughout the newsroom.
// The homepage already includes the script in its <head>; avoid loading it twice.
// Keep the newsroom admin area free of public advertising scripts.
(() => {
  const publisherId = 'ca-pub-3173828836991185';
  if (document.body?.hasAttribute('data-admin-page')) return;
  const scriptUrl = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + publisherId;
  if (document.querySelector('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]')) return;
  const script = document.createElement('script');
  script.async = true;
  script.src = scriptUrl;
  script.crossOrigin = 'anonymous';
  document.head.appendChild(script);
})();
