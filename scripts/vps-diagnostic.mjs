#!/usr/bin/env node
/**
 * Flowkyn VPS Diagnostic Script
 * ─────────────────────────────
 * Tests event-loop lag, DB query latency, Socket.IO round-trip,
 * memory/CPU, and network to identify timeout root causes.
 *
 * Usage:
 *   node backend/scripts/vps-diagnostic.mjs
 *   node backend/scripts/vps-diagnostic.mjs --api-url https://api.flowkyn.com
 *   node backend/scripts/vps-diagnostic.mjs --db-only
 *   node backend/scripts/vps-diagnostic.mjs --full
 */

import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { execSync } from 'node:child_process';
import net from 'node:net';

// ─── Config ───
const API_URL = process.argv.find(a => a.startsWith('--api-url='))?.split('=')[1] || process.env.API_URL || 'http://localhost:3000';
const DB_URL = process.env.DATABASE_URL || process.env.DB_URL || '';
const ONLY_DB = process.argv.includes('--db-only');
const FULL = process.argv.includes('--full');

const PASS = '\x1b[32m✓\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const results = [];

function grade(label, valueMs, goodMs, warnMs) {
  const icon = valueMs <= goodMs ? PASS : valueMs <= warnMs ? WARN : FAIL;
  const status = valueMs <= goodMs ? 'GOOD' : valueMs <= warnMs ? 'WARN' : 'BAD';
  const line = `${icon} ${label}: ${valueMs.toFixed(1)}ms (good <${goodMs}ms, warn <${warnMs}ms) [${status}]`;
  console.log(line);
  results.push({ label, valueMs, status });
  return status;
}

function gradeValue(label, value, unit, goodThreshold, warnThreshold, lowerIsBetter = true) {
  const isGood = lowerIsBetter ? value <= goodThreshold : value >= goodThreshold;
  const isWarn = lowerIsBetter ? value <= warnThreshold : value >= warnThreshold;
  const icon = isGood ? PASS : isWarn ? WARN : FAIL;
  const status = isGood ? 'GOOD' : isWarn ? 'WARN' : 'BAD';
  console.log(`${icon} ${label}: ${typeof value === 'number' ? value.toFixed(1) : value}${unit} [${status}]`);
  results.push({ label, value, status });
  return status;
}

// ─── 1. System Info ───
function systemInfo() {
  console.log(`\n${BOLD}═══ SYSTEM INFO ═══${RESET}`);
  console.log(`  OS:       ${os.type()} ${os.release()} (${os.arch()})`);
  console.log(`  CPUs:     ${os.cpus().length}x ${os.cpus()[0]?.model || 'unknown'}`);
  console.log(`  RAM:      ${(os.totalmem() / 1073741824).toFixed(1)} GB total, ${(os.freemem() / 1073741824).toFixed(1)} GB free`);
  console.log(`  Uptime:   ${(os.uptime() / 3600).toFixed(1)} hours`);
  console.log(`  Node:     ${process.version}`);
  
  const loadAvg = os.loadavg();
  const cpuCount = os.cpus().length;
  gradeValue('Load avg (1m)', loadAvg[0], ` (${cpuCount} cores)`, cpuCount * 0.7, cpuCount * 1.5);
  gradeValue('Free RAM %', (os.freemem() / os.totalmem()) * 100, '%', 20, 10, false);
}

// ─── 2. Event Loop Lag ───
async function eventLoopLag() {
  console.log(`\n${BOLD}═══ EVENT LOOP LAG ═══${RESET}`);
  
  const samples = [];
  for (let i = 0; i < 50; i++) {
    const start = performance.now();
    await new Promise(resolve => setImmediate(resolve));
    samples.push(performance.now() - start);
  }
  
  samples.sort((a, b) => a - b);
  const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  const p99 = samples[Math.floor(samples.length * 0.99)];
  const max = samples[samples.length - 1];
  
  grade('Event loop avg', avg, 2, 10);
  grade('Event loop p50', p50, 1, 5);
  grade('Event loop p95', p95, 5, 20);
  grade('Event loop p99', p99, 10, 50);
  grade('Event loop max', max, 15, 100);
}

// ─── 3. Database Latency ───
async function dbLatency() {
  console.log(`\n${BOLD}═══ DATABASE LATENCY ═══${RESET}`);
  
  if (!DB_URL) {
    console.log(`${WARN} DATABASE_URL not set — skipping DB tests.`);
    console.log(`  Set DATABASE_URL or DB_URL env var to enable.`);
    return;
  }
  
  let pg;
  try {
    pg = await import('pg');
  } catch {
    console.log(`${WARN} pg module not installed — skipping DB tests.`);
    return;
  }
  
  const client = new pg.default.Client({ connectionString: DB_URL, connectionTimeoutMillis: 5000 });
  
  try {
    const connStart = performance.now();
    await client.connect();
    grade('DB connect', performance.now() - connStart, 100, 500);
    
    // Simple query
    const pingStart = performance.now();
    await client.query('SELECT 1');
    grade('DB ping (SELECT 1)', performance.now() - pingStart, 5, 20);
    
    // Heavier queries that mirror game operations
    const queries = [
      { label: 'DB: game_sessions lookup', sql: `SELECT id, status FROM game_sessions LIMIT 1` },
      { label: 'DB: game_snapshots lookup', sql: `SELECT id, created_at FROM game_snapshots ORDER BY created_at DESC LIMIT 1` },
      { label: 'DB: participants count', sql: `SELECT COUNT(*) FROM participants WHERE left_at IS NULL` },
      { label: 'DB: audit_logs insert test', sql: `SELECT NOW()` },
    ];
    
    for (const q of queries) {
      try {
        const start = performance.now();
        await client.query(q.sql);
        grade(q.label, performance.now() - start, 10, 50);
      } catch (err) {
        console.log(`${WARN} ${q.label}: ${err.message}`);
      }
    }
    
    // Concurrent query pressure test
    const concStart = performance.now();
    await Promise.all(Array.from({ length: 10 }, () => client.query('SELECT 1')));
    grade('DB: 10 concurrent SELECTs', performance.now() - concStart, 30, 100);
    
    // Check active connections
    try {
      const { rows } = await client.query(`SELECT count(*) as c FROM pg_stat_activity WHERE state = 'active'`);
      gradeValue('DB active connections', parseInt(rows[0].c), '', 20, 50);
    } catch {}
    
  } catch (err) {
    console.log(`${FAIL} DB connection failed: ${err.message}`);
  } finally {
    try { await client.end(); } catch {}
  }
}

// ─── 4. HTTP API Latency ───
async function apiLatency() {
  console.log(`\n${BOLD}═══ API HTTP LATENCY ═══${RESET}`);
  console.log(`  Target: ${API_URL}`);
  
  try {
    // Health check
    const start = performance.now();
    const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(5000) });
    const elapsed = performance.now() - start;
    grade('API /health', elapsed, 50, 200);
    console.log(`  Status: ${res.status}`);
  } catch (err) {
    console.log(`${WARN} API /health unreachable: ${err.message}`);
  }
}

// ─── 5. Socket.IO Connectivity ───
async function socketLatency() {
  console.log(`\n${BOLD}═══ SOCKET.IO CONNECTIVITY ═══${RESET}`);
  
  const wsUrl = API_URL.replace(/^http/, 'ws');
  
  // Test raw TCP connectivity to the port
  const url = new URL(API_URL);
  const port = parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80);
  const host = url.hostname;
  
  await new Promise((resolve) => {
    const start = performance.now();
    const sock = net.createConnection({ host, port, timeout: 5000 }, () => {
      grade('TCP connect to API', performance.now() - start, 10, 100);
      sock.destroy();
      resolve();
    });
    sock.on('error', (err) => {
      console.log(`${FAIL} TCP connect failed: ${err.message}`);
      resolve();
    });
    sock.on('timeout', () => {
      console.log(`${FAIL} TCP connect timed out after 5s`);
      sock.destroy();
      resolve();
    });
  });
  
  // Test Socket.IO upgrade endpoint
  try {
    const start = performance.now();
    const res = await fetch(`${API_URL}/socket.io/?EIO=4&transport=polling`, {
      signal: AbortSignal.timeout(5000),
    });
    grade('Socket.IO handshake (polling)', performance.now() - start, 100, 500);
    console.log(`  Status: ${res.status}`);
  } catch (err) {
    console.log(`${WARN} Socket.IO polling endpoint: ${err.message}`);
  }
}

// ─── 6. DNS + Network ───
async function networkChecks() {
  console.log(`\n${BOLD}═══ NETWORK ═══${RESET}`);
  
  try {
    const start = performance.now();
    const res = await fetch('https://1.1.1.1/dns-query?name=api.flowkyn.com&type=A', {
      headers: { Accept: 'application/dns-json' },
      signal: AbortSignal.timeout(5000),
    });
    grade('DNS resolve (Cloudflare)', performance.now() - start, 50, 200);
  } catch (err) {
    console.log(`${WARN} DNS check: ${err.message}`);
  }
  
  // Outbound HTTPS
  try {
    const start = performance.now();
    await fetch('https://httpbin.org/get', { signal: AbortSignal.timeout(5000) });
    grade('Outbound HTTPS', performance.now() - start, 200, 1000);
  } catch (err) {
    console.log(`${WARN} Outbound HTTPS: ${err.message}`);
  }
}

// ─── 7. Disk I/O ───
async function diskIO() {
  console.log(`\n${BOLD}═══ DISK I/O ═══${RESET}`);
  
  const fs = await import('node:fs/promises');
  const path = '/tmp/flowkyn-diag-' + Date.now();
  const data = Buffer.alloc(1024 * 1024, 'x'); // 1MB
  
  try {
    const writeStart = performance.now();
    await fs.writeFile(path, data);
    grade('Disk write 1MB', performance.now() - writeStart, 10, 50);
    
    const readStart = performance.now();
    await fs.readFile(path);
    grade('Disk read 1MB', performance.now() - readStart, 5, 30);
    
    await fs.unlink(path);
  } catch (err) {
    console.log(`${WARN} Disk I/O: ${err.message}`);
  }
}

// ─── 8. Process / PM2 Info ───
function processInfo() {
  console.log(`\n${BOLD}═══ PROCESS INFO ═══${RESET}`);
  
  const memUsage = process.memoryUsage();
  gradeValue('Heap used', memUsage.heapUsed / 1048576, ' MB', 200, 500);
  gradeValue('RSS', memUsage.rss / 1048576, ' MB', 300, 800);
  
  // Check if PM2 is running
  try {
    const pm2List = execSync('pm2 jlist 2>/dev/null', { timeout: 5000 }).toString();
    const procs = JSON.parse(pm2List);
    console.log(`  PM2 processes: ${procs.length}`);
    for (const p of procs) {
      const restarts = p.pm2_env?.restart_time || 0;
      const uptime = p.pm2_env?.pm_uptime ? ((Date.now() - p.pm2_env.pm_uptime) / 3600000).toFixed(1) : '?';
      const mem = ((p.monit?.memory || 0) / 1048576).toFixed(0);
      const cpu = p.monit?.cpu || 0;
      const icon = restarts > 5 ? FAIL : restarts > 0 ? WARN : PASS;
      console.log(`  ${icon} ${p.name}: ${p.pm2_env?.status} | ${mem}MB RAM | ${cpu}% CPU | ${restarts} restarts | uptime ${uptime}h`);
      if (restarts > 5) {
        results.push({ label: `PM2 ${p.name} restarts`, value: restarts, status: 'BAD' });
      }
    }
  } catch {
    console.log(`  PM2 not available or not running`);
  }
}

// ─── 9. Game-Specific Timing Simulation ───
async function gameTimingSimulation() {
  console.log(`\n${BOLD}═══ GAME TIMING SIMULATION ═══${RESET}`);
  console.log(`  Simulates the typical server-side work for a game:action`);
  
  // Simulate: JSON parse + validation + serialize
  const payload = {
    sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    actionType: 'two_truths:vote',
    payload: { statementId: 's0' },
  };
  
  const parseStart = performance.now();
  for (let i = 0; i < 1000; i++) {
    JSON.parse(JSON.stringify(payload));
  }
  grade('JSON parse+stringify x1000', performance.now() - parseStart, 5, 20);
  
  // Simulate: state reducer (pure CPU)
  const reducerStart = performance.now();
  let state = { votes: {}, scores: {}, round: 1 };
  for (let i = 0; i < 1000; i++) {
    state = { ...state, votes: { ...state.votes, [`p${i}`]: 's0' } };
  }
  grade('Reducer simulation x1000', performance.now() - reducerStart, 10, 50);
  
  // Simulate: snapshot serialization (large state)
  const bigState = {
    kind: 'two-truths',
    phase: 'vote',
    round: 5,
    totalRounds: 30,
    votes: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`p${i}`, 's0'])),
    scores: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`p${i}`, i * 100])),
    statements: [{ id: 's0', text: 'a'.repeat(300) }, { id: 's1', text: 'b'.repeat(300) }, { id: 's2', text: 'c'.repeat(300) }],
  };
  const serStart = performance.now();
  for (let i = 0; i < 100; i++) {
    JSON.stringify(bigState);
  }
  grade('Large state serialize x100', performance.now() - serStart, 5, 20);
}

// ─── Summary ───
function summary() {
  console.log(`\n${BOLD}═══════════════════════════${RESET}`);
  console.log(`${BOLD}        SUMMARY${RESET}`);
  console.log(`${BOLD}═══════════════════════════${RESET}`);
  
  const bads = results.filter(r => r.status === 'BAD');
  const warns = results.filter(r => r.status === 'WARN');
  const goods = results.filter(r => r.status === 'GOOD');
  
  console.log(`  ${PASS} ${goods.length} checks passed`);
  console.log(`  ${WARN} ${warns.length} warnings`);
  console.log(`  ${FAIL} ${bads.length} failures`);
  
  if (bads.length > 0) {
    console.log(`\n${BOLD}CRITICAL ISSUES:${RESET}`);
    for (const b of bads) {
      console.log(`  ${FAIL} ${b.label}: ${b.valueMs ? b.valueMs.toFixed(1) + 'ms' : b.value}`);
    }
  }
  
  if (warns.length > 0) {
    console.log(`\n${BOLD}WARNINGS:${RESET}`);
    for (const w of warns) {
      console.log(`  ${WARN} ${w.label}: ${w.valueMs ? w.valueMs.toFixed(1) + 'ms' : w.value}`);
    }
  }
  
  console.log(`\n${BOLD}RECOMMENDATIONS:${RESET}`);
  
  const hasEventLoopIssue = bads.some(b => b.label.includes('Event loop'));
  const hasDbIssue = bads.some(b => b.label.includes('DB'));
  const hasMemIssue = bads.some(b => b.label.includes('RAM') || b.label.includes('Heap'));
  const hasRestarts = bads.some(b => b.label.includes('restart'));
  
  if (hasEventLoopIssue) {
    console.log(`  1. ${FAIL} EVENT LOOP BLOCKED — Your Node.js process is spending too long on CPU tasks.`);
    console.log(`     → Move heavy computation (score calc, pairing) to a worker thread or setImmediate chunks`);
    console.log(`     → Check for synchronous file I/O or JSON.parse of huge payloads`);
    console.log(`     → Run: node --prof your-app.js, then node --prof-process to find hot functions`);
  }
  
  if (hasDbIssue) {
    console.log(`  2. ${FAIL} DATABASE SLOW — Queries are taking too long.`);
    console.log(`     → Check pg_stat_activity for lock waits: SELECT * FROM pg_stat_activity WHERE wait_event IS NOT NULL`);
    console.log(`     → Add indexes: CREATE INDEX CONCURRENTLY idx_snapshots_session ON game_snapshots(game_session_id, created_at DESC)`);
    console.log(`     → Use connection pooling (PgBouncer) if not already`);
    console.log(`     → Check EXPLAIN ANALYZE on your snapshot queries`);
  }
  
  if (hasMemIssue) {
    console.log(`  3. ${FAIL} MEMORY PRESSURE — Node.js or the system is low on memory.`);
    console.log(`     → Increase VPS RAM or add swap: fallocate -l 2G /swapfile && mkswap /swapfile && swapon /swapfile`);
    console.log(`     → Set Node max old space: NODE_OPTIONS="--max-old-space-size=512" pm2 restart all`);
    console.log(`     → Check for memory leaks: node --inspect your-app.js → Chrome DevTools heap snapshot`);
  }
  
  if (hasRestarts) {
    console.log(`  4. ${FAIL} PM2 RESTARTS — The app is crashing and restarting.`);
    console.log(`     → Check crash logs: pm2 logs --err --lines 100`);
    console.log(`     → Increase memory limit: pm2 restart app --max-memory-restart 512M`);
    console.log(`     → Enable crash reporting: pm2 install pm2-server-monit`);
  }
  
  if (bads.length === 0 && warns.length <= 2) {
    console.log(`  ${PASS} VPS looks healthy! Timeout issues are likely in the Socket.IO application layer.`);
    console.log(`     The backend code fixes (ack callbacks, reliable emit, pending signal queue) should resolve them.`);
  }
  
  console.log(`\n  Run again with --full for all checks, or --db-only for database-focused diagnostics.`);
}

// ─── Main ───
async function main() {
  console.log(`${BOLD}╔═══════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║  Flowkyn VPS Diagnostic Tool v1.0     ║${RESET}`);
  console.log(`${BOLD}║  ${new Date().toISOString()}    ║${RESET}`);
  console.log(`${BOLD}╚═══════════════════════════════════════╝${RESET}`);
  
  systemInfo();
  await eventLoopLag();
  await dbLatency();
  
  if (!ONLY_DB) {
    await apiLatency();
    await socketLatency();
    await gameTimingSimulation();
  }
  
  if (FULL) {
    await networkChecks();
    await diskIO();
  }
  
  processInfo();
  summary();
}

main().catch(err => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
