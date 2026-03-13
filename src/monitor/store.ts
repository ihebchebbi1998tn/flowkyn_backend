/**
 * Professional monitoring system - In-memory store with complete log retention
 * Keeps ALL logs for analysis and debugging
 */
import * as fs from 'fs';
import * as path from 'path';

export interface RequestLog {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  duration: number;       // ms
  ip: string;
  userAgent: string;
  userId?: string;
  requestBody?: unknown;
  queryParams?: Record<string, string>;
  requestHeaders?: Record<string, string>;
  responseBody?: unknown;
  error?: string;
  tags: string[];         // e.g. ['auth', 'error', 'slow']
}

export interface SystemMetrics {
  startedAt: string;
  totalRequests: number;
  totalErrors: number;
  avgResponseTime: number;
  activeConnections: number;
  requestsPerMinute: number;
  statusCodes: Record<string, number>;
  topEndpoints: { path: string; count: number; avgMs: number }[];
}

// ============= CONFIGURATION =============
const MAX_LOGS = 100000;        // Keep 100,000 logs in memory (all recent requests)
const MAX_ENDPOINTS = 1000;     // Track up to 1000 unique endpoints
const LOG_DIR = path.join(process.cwd(), '.logs');
const ENABLE_FILE_LOGGING = true; // Enable persistent file logs

// Create logs directory if it doesn't exist
if (ENABLE_FILE_LOGGING && !fs.existsSync(LOG_DIR)) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    console.log(`[Monitor] Log directory created: ${LOG_DIR}`);
  } catch (err) {
    console.error('[Monitor] Failed to create log directory:', err);
  }
}

// ============= STORAGE =============
const logs: RequestLog[] = [];
let totalRequests = 0;
let totalErrors = 0;
let totalDuration = 0;
const startedAt = new Date().toISOString();

// Per-minute tracking
const minuteBuckets: number[] = [];
let currentMinute = Math.floor(Date.now() / 60000);

// Status code counters
const statusCodes: Record<string, number> = {};

// Endpoint stats — with size limit to prevent memory leaks
const endpointStats: Map<string, { count: number; totalMs: number }> = new Map();

export function addLog(log: RequestLog) {
  logs.push(log);
  if (logs.length > MAX_LOGS) {
    logs.shift(); // Remove oldest log when exceeding max
  }

  totalRequests++;
  totalDuration += log.duration;
  if (log.statusCode >= 400) totalErrors++;

  // Status code tracking
  const codeGroup = `${Math.floor(log.statusCode / 100)}xx`;
  statusCodes[codeGroup] = (statusCodes[codeGroup] || 0) + 1;

  // Endpoint tracking
  const pathNormalized = log.path
    .replace(/\/[0-9a-f-]{36}/gi, '/:id')      // Replace UUIDs
    .replace(/\/\d+/g, '/:id')                  // Replace numeric IDs
    .split('?')[0];                             // Remove query string
  
  const key = `${log.method} ${pathNormalized}`;
  const ep = endpointStats.get(key) || { count: 0, totalMs: 0 };
  ep.count++;
  ep.totalMs += log.duration;
  endpointStats.set(key, ep);

  // Prevent unbounded growth: if exceeding limit, remove least accessed endpoint
  if (endpointStats.size > MAX_ENDPOINTS) {
    let leastUsedKey: string | null = null;
    let leastCount = Infinity;
    for (const [k, v] of endpointStats.entries()) {
      if (v.count < leastCount) {
        leastCount = v.count;
        leastUsedKey = k;
      }
    }
    if (leastUsedKey) endpointStats.delete(leastUsedKey);
  }

  // Per-minute bucket
  const min = Math.floor(Date.now() / 60000);
  if (min !== currentMinute) {
    minuteBuckets.push(0);
    if (minuteBuckets.length > 60) minuteBuckets.shift();
    currentMinute = min;
  }
  minuteBuckets[minuteBuckets.length - 1] = (minuteBuckets[minuteBuckets.length - 1] || 0) + 1;

  // PROFESSIONAL FILE LOGGING - All requests logged to file
  if (ENABLE_FILE_LOGGING) {
    writeLogToFile(log);
  }
}

/**
 * Write log to file with professional formatting
 * Creates daily log files for easy analysis
 */
function writeLogToFile(log: RequestLog) {
  try {
    const date = new Date(log.timestamp);
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const logFile = path.join(LOG_DIR, `api-${dateStr}.log`);

    // Format: [HH:MM:SS] METHOD /path → STATUS (Xms) [ID] [Error: msg]
    const time = date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const statusStr = log.statusCode >= 500 ? `ERROR(${log.statusCode})` : log.statusCode >= 400 ? `FAILED(${log.statusCode})` : `OK(${log.statusCode})`;
    const errorStr = log.error ? ` [Error: ${log.error}]` : '';
    const userStr = log.userId ? ` [User: ${log.userId}]` : '';
    
    const logStr = `[${time}] ${log.method.padEnd(6)} ${log.path.substring(0, 80).padEnd(80)} → ${statusStr} (${log.duration}ms) [${log.id.substring(0, 8)}]${userStr}${errorStr}\n`;
    
    fs.appendFileSync(logFile, logStr, 'utf8');

    // Also write detailed JSON log for full analysis
    const jsonLogFile = path.join(LOG_DIR, `api-${dateStr}.json`);
    fs.appendFileSync(jsonLogFile, JSON.stringify(log) + '\n', 'utf8');
  } catch (err) {
    console.error('[Monitor] Error writing log file:', err);
  }
}

export function getLogs(limit = 1000, filter?: { method?: string; status?: string; search?: string }): RequestLog[] {
  let result = logs;
  if (filter?.method) result = result.filter(l => l.method === filter.method);
  if (filter?.status === 'error') result = result.filter(l => l.statusCode >= 400);
  if (filter?.status === 'slow') result = result.filter(l => l.duration > 1000);
  if (filter?.search) {
    const s = filter.search.toLowerCase();
    result = result.filter(l => l.path.toLowerCase().includes(s) || l.error?.toLowerCase().includes(s));
  }
  return result.slice(-limit).reverse(); // Most recent first
}

export function getMetrics(): SystemMetrics {
  const topEndpoints = [...endpointStats.entries()]
    .map(([path, s]) => ({ path, count: s.count, avgMs: Math.round(s.totalMs / s.count) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return {
    startedAt,
    totalRequests,
    totalErrors,
    avgResponseTime: totalRequests > 0 ? Math.round(totalDuration / totalRequests) : 0,
    activeConnections: 0,
    requestsPerMinute: minuteBuckets.length > 0 ? minuteBuckets[minuteBuckets.length - 1] || 0 : 0,
    statusCodes,
    topEndpoints,
  };
}

export function clearLogs() {
  logs.length = 0;
  totalRequests = 0;
  totalErrors = 0;
  totalDuration = 0;
  endpointStats.clear();
  Object.keys(statusCodes).forEach(k => delete statusCodes[k]);
}
