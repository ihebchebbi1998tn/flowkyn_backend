#!/usr/bin/env node

/**
 * Test Script for Session Details Fix
 * 
 * This script helps verify that all session details queries are working correctly
 * after the fixes have been applied.
 * 
 * Usage:
 *   npx ts-node test-session-details.ts <SESSION_ID>
 *   
 * Example:
 *   npx ts-node test-session-details.ts 550e8400-e29b-41d4-a716-446655440000
 */

import { pool, query } from './src/config/database';
import { SessionDetailsService } from './src/services/sessionDetails.service';

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  duration: number;
  details?: string;
  error?: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({
      name,
      status: 'pass',
      duration: Date.now() - start,
    });
    console.log(`✅ ${name} (${Date.now() - start}ms)`);
  } catch (error) {
    results.push({
      name,
      status: 'fail',
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    });
    console.log(`❌ ${name}`);
    console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  const sessionId = process.argv[2];
  
  if (!sessionId) {
    console.error('❌ Missing argument: SESSION_ID');
    console.error('Usage: npx ts-node test-session-details.ts <SESSION_ID>');
    process.exit(1);
  }

  console.log(`\n🧪 Testing Session Details Fix for session: ${sessionId}\n`);

  // Test 1: Verify session exists
  await test('Session exists in database', async () => {
    const rows = await query<any>(
      'SELECT id, event_id, status FROM game_sessions WHERE id = $1',
      [sessionId]
    );
    if (rows.length === 0) {
      throw new Error('Session not found');
    }
    console.log(`   Event ID: ${rows[0].event_id}, Status: ${rows[0].status}`);
  });

  // Test 2: Verify event exists
  let eventId: string;
  await test('Event exists in database', async () => {
    const rows = await query<any>(
      'SELECT id, title FROM events WHERE id = (SELECT event_id FROM game_sessions WHERE id = $1)',
      [sessionId]
    );
    if (rows.length === 0) {
      throw new Error('Event not found');
    }
    eventId = rows[0].id;
    console.log(`   Event Title: ${rows[0].title}`);
  });

  // Test 3: Verify participants exist
  await test('Participants exist for event', async () => {
    const rows = await query<any>(
      'SELECT COUNT(*) as count FROM participants WHERE event_id = (SELECT event_id FROM game_sessions WHERE id = $1)',
      [sessionId]
    );
    const count = rows[0].count;
    console.log(`   Total participants: ${count}`);
  });

  // Test 4: Verify organization_members have associated users
  await test('Organization members have associated users', async () => {
    const rows = await query<any>(
      `
      SELECT COUNT(om.id) as count
      FROM participants p
      LEFT JOIN organization_members om ON p.organization_member_id = om.id
      LEFT JOIN users u ON om.user_id = u.id
      WHERE p.event_id = (SELECT event_id FROM game_sessions WHERE id = $1)
      AND om.id IS NOT NULL AND u.id IS NULL
      `,
      [sessionId]
    );
    const orphanCount = rows[0].count;
    if (orphanCount > 0) {
      console.log(`   ⚠️  Warning: ${orphanCount} organization_members have no associated user`);
    } else {
      console.log(`   All organization_members have associated users`);
    }
  });

  // Test 5: Test participants query directly
  await test('Participants query works', async () => {
    const rows = await query<any>(
      `
      SELECT
        om.id,
        p.id as participant_id,
        COALESCE(u.name, p.guest_name) as display_name,
        p.participant_type,
        COUNT(DISTINCT ga.id) as action_count,
        COUNT(DISTINCT em.id) as message_count
      FROM participants p
      LEFT JOIN organization_members om ON p.organization_member_id = om.id
      LEFT JOIN users u ON om.user_id = u.id
      LEFT JOIN game_actions ga ON p.id = ga.participant_id AND ga.game_session_id = $1
      LEFT JOIN event_messages em ON p.id = em.participant_id AND em.event_id = $2
      WHERE p.event_id = $2
      GROUP BY om.id, p.id, u.name, p.guest_name, p.participant_type
      LIMIT 5
      `,
      [sessionId, eventId || 'null']
    );
    console.log(`   Found ${rows.length} participants (showing first 5)`);
    for (const p of rows.slice(0, 3)) {
      console.log(`     - ${p.display_name}: ${p.action_count} actions, ${p.message_count} messages`);
    }
  });

  // Test 6: Test messages query directly
  await test('Messages query works', async () => {
    const rows = await query<any>(
      `
      SELECT COUNT(*) as count
      FROM event_messages em
      WHERE em.event_id = (SELECT event_id FROM game_sessions WHERE id = $1)
      `,
      [sessionId]
    );
    console.log(`   Total messages: ${rows[0].count}`);
  });

  // Test 7: Test actions query directly
  await test('Actions query works', async () => {
    const rows = await query<any>(
      `
      SELECT COUNT(*) as count
      FROM game_actions ga
      WHERE ga.game_session_id = $1
      `,
      [sessionId]
    );
    console.log(`   Total actions: ${rows[0].count}`);
  });

  // Test 8: Full session details service call
  await test('SessionDetailsService.getSessionDetails() works', async () => {
    const service = new SessionDetailsService();
    const details = await service.getSessionDetails(sessionId);
    console.log(`   Session: ${details.game_name}`);
    console.log(`   Participants: ${details.participants?.length || 0}`);
    console.log(`   Messages: ${details.total_messages}`);
    console.log(`   Actions: ${details.total_actions}`);
  });

  // Summary
  console.log(`\n📊 Test Summary\n`);
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  
  for (const result of results) {
    const icon = result.status === 'pass' ? '✅' : '❌';
    console.log(`${icon} ${result.name} (${result.duration}ms)`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  }

  console.log(`\n${passed}/${results.length} tests passed`);
  
  if (failed === 0) {
    console.log('\n🎉 All tests passed! Session details fix is working correctly.\n');
  } else {
    console.log(`\n⚠️  ${failed} test(s) failed. See details above.\n`);
  }

  await pool.end();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
