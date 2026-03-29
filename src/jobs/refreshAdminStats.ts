// src/jobs/refreshAdminStats.ts
// Purpose: Refresh admin stats materialized view every 5 minutes
// Impact: Keeps admin dashboard data fresh without blocking queries
// Deployment: Add to PM2 config as scheduled job

import { query } from '@/config/database';
import { env } from '@/config/env';

/**
 * Refresh the admin stats materialized view
 * Called every 5 minutes by PM2 scheduled job
 * 
 * Performance:
 * - Refresh time: <5 seconds
 * - No locks during refresh (uses CONCURRENTLY)
 * - Queries continue to work uninterrupted
 * - Admin dashboard always gets fresh data within 5 minutes
 */
export async function refreshAdminStats() {
  const startTime = performance.now();
  
  try {
    console.log('[Job] Starting admin stats cache refresh...');
    
    // Refresh materialized view (no locks with CONCURRENTLY)
    await query('REFRESH MATERIALIZED VIEW CONCURRENTLY admin_stats_cache');
    
    const duration = performance.now() - startTime;
    console.log(`[Job] ✅ Admin stats cache refreshed successfully (${duration.toFixed(2)}ms)`);
    
    // Optional: Log to external service for monitoring
    if (env.nodeEnv === 'production') {
      console.log('[Job] Admin stats refresh completed in', {
        duration: `${duration.toFixed(2)}ms`,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('[Job] ❌ Failed to refresh admin stats cache', {
      error: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    });
    
    // Don't throw - job should not crash if refresh fails
    // Queries will fall back to getStats() fallback method
  }
}

// For manual testing
if (require.main === module) {
  refreshAdminStats()
    .then(() => {
      console.log('Admin stats refresh completed');
      process.exit(0);
    })
    .catch(err => {
      console.error('Admin stats refresh failed:', err);
      process.exit(1);
    });
}
