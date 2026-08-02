import {createClient} from '@supabase/supabase-js';
import {NewsWorker} from '../../worker/newsWorker.js';

/** Vercel Cron entry point. The platform calls this securely with CRON_SECRET. */
export default async function handler(req:any,res:any){
  if(!['GET','POST'].includes(req.method||''))return res.status(405).json({error:'Method not allowed'});
  const secret=process.env.CRON_SECRET;
  if(!secret||req.headers?.authorization!==`Bearer ${secret}`)return res.status(401).json({error:'Unauthorized'});
  const url=process.env.SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return res.status(500).json({error:'Server configuration is incomplete'});
  try{
    const source=typeof req.query?.source==='string'?req.query.source:undefined;
    const result=await new NewsWorker(createClient(url,key,{auth:{persistSession:false}})).run('vercel',source);
    return res.status(result.status==='skipped'?202:result.status==='failed'?500:200).json({data:result});
  }catch(error){return res.status(500).json({error:error instanceof Error?error.message:'Worker failed'});}
}
