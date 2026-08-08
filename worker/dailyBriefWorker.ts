import type {SupabaseClient} from '@supabase/supabase-js';
import {NotificationWorker} from './notificationWorker.js';

/** Dedicated entry point for hosts that schedule only the morning briefing. */
export class DailyBriefWorker {
  constructor(private db:SupabaseClient){}
  async run(force=false){return new NotificationWorker(this.db).createDailyBrief(force);}
}
