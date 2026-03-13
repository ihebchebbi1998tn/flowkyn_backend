/**
 * In-memory request/response log store with circular buffer.
 * Stores the last N requests for the live monitor dashboard.
 */

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

const MAX_LOGS = 500;
const MAX_ENDPOINTS = 500; // Prevent unbounded growth of endpoint stats
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
  logs.unshift(log);
  if (logs.length > MAX_LOGS) logs.pop();

  totalRequests++;
  totalDuration += log.duration;
  if (log.statusCode >= 400) totalErrors++;

  // Status code tracking
  const codeGroup = `${Math.floor(log.statusCode / 100)}xx`;
  statusCodes[codeGroup] = (statusCodes[codeGroup] || 0) + 1;

  // Endpoint tracking
  const key = `${log.method} ${log.path.replace(/\/[0-9a-f-]{36}/g, '/:id').replace(/\/\d+/g, '/:n')}`;
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

  // Debug logging for slow/error requests
  if (log.statusCode >= 400 || log.duration > 2000) {
    console.log(
      `[Monitor] ${log.method} ${log.path} — ${log.statusCode} (${log.duration}ms)`,
      log.error ? `— Error: ${log.error}` : ''
    );
  }
}

export function getLogs(limit = 100, filter?: { method?: string; status?: string; search?: string }): RequestLog[] {
  let result = logs;
  if (filter?.method) result = result.filter(l => l.method === filter.method);
  if (filter?.status === 'error') result = result.filter(l => l.statusCode >= 400);
  if (filter?.status === 'slow') result = result.filter(l => l.duration > 1000);
  if (filter?.search) {
    const s = filter.search.toLowerCase();
    result = result.filter(l => l.path.toLowerCase().includes(s) || l.error?.toLowerCase().includes(s));
  }
  return result.slice(0, limit);
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
