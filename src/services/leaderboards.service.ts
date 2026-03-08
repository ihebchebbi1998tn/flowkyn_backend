import { query, queryOne } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export class LeaderboardsService {
  async getById(leaderboardId: string) {
    const lb = await queryOne('SELECT * FROM leaderboards WHERE id = $1', [leaderboardId]);
    if (!lb) throw new AppError('Leaderboard not found', 404);
    return lb;
  }

  async getEntries(leaderboardId: string) {
    return query(
      `SELECT le.*, u.name as user_name, u.avatar_url
       FROM leaderboard_entries le
       LEFT JOIN participants p ON p.id = le.participant_id
       LEFT JOIN organization_members om ON om.id = p.organization_member_id
       LEFT JOIN users u ON u.id = om.user_id
       WHERE le.leaderboard_id = $1
       ORDER BY le.rank ASC`,
      [leaderboardId]
    );
  }
}
