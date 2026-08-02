import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { NewsWorker } from './newsWorker.js';
const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
const result=await new NewsWorker(createClient(url,key,{auth:{persistSession:false}})).run((process.env.WORKER_TRIGGER as any)||'cron');console.log(JSON.stringify(result));process.exit(result.status==='failed'?1:0);
