import { v4 as uuid } from 'uuid';
import { query } from '../config/database';

export class AnalyticsService {
  async track(userId: string, eventName: string, properties: any) {
    const [event] = await query(
      `INSERT INTO analytics_events (id, user_id, event_name, properties, created_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
      [uuid(), userId, eventName, JSON.stringify(properties)]
    );
    return event;
  }
}
