import { query, queryOne } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { parsePagination, buildPaginatedResponse } from '../utils/pagination';

export class LeaderboardsService {
  async getById(leaderboardId: string) {
    const lb = await queryOne('SELECT * FROM leaderboards WHERE id = $1', [leaderboardId]);
    if (!lb) throw new AppError('Leaderboard not found', 404, 'NOT_FOUND');
    return lb;
  }

  async getEntries(leaderboardId: string, pagination?: { page?: number; limit?: number }) {
    // Verify leaderboard exists first
    await this.getById(leaderboardId);
    
    const { page, limit, offset } = parsePagination(pagination || {});
    
    const [data, [{ count }]] = await Promise.all([
      query(
        `SELECT le.*, u.name as user_name, u.avatar_url
         FROM leaderboard_entries le
         LEFT JOIN participants p ON p.id = le.participant_id
         LEFT JOIN organization_members om ON om.id = p.organization_member_id
         LEFT JOIN users u ON u.id = om.user_id
         WHERE le.leaderboard_id = $1
         ORDER BY le.rank ASC
         LIMIT $2 OFFSET $3`,
        [leaderboardId, limit, offset]
      ),
      query<{ count: string }>('SELECT COUNT(*) as count FROM leaderboard_entries WHERE leaderboard_id = $1', [leaderboardId])
    ]);
    
    return buildPaginatedResponse(data, parseInt(count), page, limit);
  }
}
