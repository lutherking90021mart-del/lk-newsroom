import type {SupabaseClient} from '@supabase/supabase-js';
import {NotificationWorker} from './notificationWorker.js';

/** Compatibility worker for a dedicated Railway delivery service; the shared lock avoids duplicate sends. */
export class EmailWorker {
  constructor(private db:SupabaseClient){}
  async run(){return new NotificationWorker(this.db).run();}
}
