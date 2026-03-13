/**
 * Monitor dashboard — serves a self-contained HTML page + JSON API
 * at /monitor for real-time backend observability.
 *
 * Protected by a simple token from MONITOR_SECRET env var.
 */
import { Router, Request, Response } from 'express';
import { getLogs, getMetrics, clearLogs, subscribeLogs } from './store';
import { env } from '../config/env';

const router = Router();

// Simple auth check
function checkMonitorAuth(req: Request, res: Response): boolean {
  const secret = process.env.MONITOR_SECRET;
  if (!secret) {
    // No secret configured = allow in development only
    if (process.env.NODE_ENV === 'production') {
      res.status(401).json({ error: 'Monitor disabled — set MONITOR_SECRET in production' });
      return false;
    }
    return true;
  }

  // Check token from query param or header
  const token = req.query.token || req.headers['x-monitor-token'];
  if (token !== secret) {
    console.warn('[Monitor] Auth attempt with wrong token:', token ? token.toString().substring(0, 5) + '...' : 'none');
    res.status(401).json({ error: 'Unauthorized — provide ?token=YOUR_MONITOR_SECRET or X-Monitor-Token header' });
    return false;
  }
  return true;
}

// ─── JSON API ───

router.get('/api/logs', (req, res) => {
  if (!checkMonitorAuth(req, res)) return;
  const { limit = '1000', method, status, search } = req.query;
  const logs = getLogs(Number(limit), {
    method: method as string,
    status: status as string,
    search: search as string,
  });
  res.json(logs);
});

router.get('/api/metrics', (req, res) => {
  if (!checkMonitorAuth(req, res)) return;
  res.json(getMetrics());
});

router.post('/api/clear', (req, res) => {
  if (!checkMonitorAuth(req, res)) return;
  clearLogs();
  console.log('[Monitor] Logs cleared');
  res.json({ message: 'Logs cleared', timestamp: new Date().toISOString() });
});

// Health/status endpoint (for debugging)
router.get('/api/status', (req, res) => {
  if (!checkMonitorAuth(req, res)) return;
  const metrics = getMetrics();
  res.json({
    ok: true,
    middleware: 'active',
    timestamp: new Date().toISOString(),
    secretConfigured: !!process.env.MONITOR_SECRET,
    logsCount: metrics.totalRequests,
    nodeEnv: process.env.NODE_ENV,
  });
});

// ─── Server-Sent Events stream (real-time updates) ───

router.get('/api/stream', (req, res) => {
  if (!checkMonitorAuth(req, res)) return;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // In some environments, flushHeaders is available to send headers immediately.
  (res as any).flushHeaders?.();

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send initial snapshot so the dashboard can render immediately
  try {
    const logs = getLogs(500);
    const metrics = getMetrics();
    sendEvent('snapshot', { logs, metrics });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[Monitor] Failed to send initial snapshot:', err?.message || err);
  }

  // Stream new logs as they arrive
  const unsubscribe = subscribeLogs((log) => {
    try {
      sendEvent('log', log);
      // Optionally send lightweight metrics update alongside each log
      const metrics = getMetrics();
      sendEvent('metrics', metrics);
    } catch (err: any) {
      // If writing fails, just detach this subscriber
      // eslint-disable-next-line no-console
      console.error('[Monitor] SSE write error:', err?.message || err);
      unsubscribe();
      res.end();
    }
  });

  // Cleanup on client disconnect
  req.on('close', () => {
    unsubscribe();
    res.end();
  });
});

// ─── HTML Dashboard ───

router.get('/', (req, res) => {
  if (!checkMonitorAuth(req, res)) return;
  const token = req.query.token || '';
  res.setHeader('Content-Type', 'text/html');
  res.send(getDashboardHTML(token as string));
});

function getDashboardHTML(token: string): string {
  const tokenParam = token ? `?token=${token}` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Flowkyn — API Monitor</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0a0f;--card:#12121a;--border:#1e1e2e;--text:#e0e0e8;--dim:#6b6b80;--primary:#6c5ce7;--green:#00b894;--red:#ff6b6b;--orange:#fdcb6e;--blue:#74b9ff;--font:'SF Mono',Monaco,'Cascadia Code',monospace}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;line-height:1.5}
.header{background:var(--card);border-bottom:1px solid var(--border);padding:12px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10}
.header h1{font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px}
.header h1 span{color:var(--primary)}
.live-dot{width:8px;height:8px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;padding:16px 24px}
.stat-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
.stat-card .label{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);margin-bottom:4px}
.stat-card .value{font-size:22px;font-weight:700;font-family:var(--font)}
.stat-card .value.green{color:var(--green)}.stat-card .value.red{color:var(--red)}.stat-card .value.blue{color:var(--blue)}.stat-card .value.orange{color:var(--orange)}
.toolbar{padding:8px 24px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--border)}
.toolbar select,.toolbar input{background:var(--card);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-size:12px;outline:none}
.toolbar input{flex:1;min-width:200px;max-width:350px}
.toolbar select:focus,.toolbar input:focus{border-color:var(--primary)}
.toolbar button{background:var(--primary);color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600}
.toolbar button:hover{opacity:.9}
.toolbar button.danger{background:var(--red)}
.toolbar .spacer{flex:1}
.toolbar .auto-refresh{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dim)}
.toolbar .auto-refresh input[type=checkbox]{accent-color:var(--primary)}
.content{padding:0 24px 24px}
.log-table{width:100%;border-collapse:collapse;margin-top:12px}
.log-table th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);padding:8px 10px;border-bottom:1px solid var(--border);position:sticky;top:52px;background:var(--bg)}
.log-table td{padding:7px 10px;border-bottom:1px solid var(--border);font-size:12px;vertical-align:top;white-space:nowrap}
.log-table tr:hover{background:rgba(108,92,231,.06)}
.log-table tr.error{background:rgba(255,107,107,.04)}
.log-table tr.slow{background:rgba(253,203,110,.04)}
.method{font-family:var(--font);font-weight:700;font-size:11px;padding:2px 6px;border-radius:4px;display:inline-block;min-width:48px;text-align:center}
.method.GET{background:rgba(116,185,255,.15);color:var(--blue)}
.method.POST{background:rgba(0,184,148,.15);color:var(--green)}
.method.PUT,.method.PATCH{background:rgba(253,203,110,.15);color:var(--orange)}
.method.DELETE{background:rgba(255,107,107,.15);color:var(--red)}
.status{font-family:var(--font);font-weight:700;font-size:11px}
.status.s2{color:var(--green)}.status.s3{color:var(--blue)}.status.s4{color:var(--orange)}.status.s5{color:var(--red)}
.duration{font-family:var(--font);font-size:11px}
.duration.slow{color:var(--orange)}.duration.very-slow{color:var(--red)}
.tag{display:inline-block;font-size:9px;padding:1px 5px;border-radius:3px;margin-left:3px;text-transform:uppercase;letter-spacing:.3px;font-weight:600}
.tag.error{background:rgba(255,107,107,.15);color:var(--red)}
.tag.slow{background:rgba(253,203,110,.15);color:var(--orange)}
.tag.auth{background:rgba(108,92,231,.15);color:var(--primary)}
.tag.admin{background:rgba(116,185,255,.15);color:var(--blue)}
.tag.mutation{background:rgba(0,184,148,.1);color:var(--green)}
.path{font-family:var(--font);font-size:11px;color:var(--text);max-width:350px;overflow:hidden;text-overflow:ellipsis}
.ip{font-family:var(--font);font-size:10px;color:var(--dim)}
.time{font-family:var(--font);font-size:10px;color:var(--dim)}
.error-msg{font-size:11px;color:var(--red);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.endpoints{margin-top:16px}
.endpoints h3{font-size:13px;font-weight:600;margin-bottom:10px;color:var(--dim)}
.ep-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px}
.ep-item{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center}
.ep-item .ep-path{font-family:var(--font);font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ep-item .ep-stats{display:flex;gap:12px;font-family:var(--font);font-size:11px;color:var(--dim);flex-shrink:0}
.detail-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100;display:flex;align-items:center;justify-content:center}
.detail-panel{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;max-width:650px;width:90%;max-height:80vh;overflow-y:auto}
.detail-panel h3{font-size:14px;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.detail-panel pre{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;font-family:var(--font);font-size:11px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;max-height:250px;overflow-y:auto}
.detail-panel .section{margin-bottom:14px}
.detail-panel .section-label{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);margin-bottom:4px}
.detail-panel .close-btn{float:right;background:none;border:none;color:var(--dim);font-size:18px;cursor:pointer;padding:4px 8px}
.empty{text-align:center;padding:40px;color:var(--dim)}
</style>
</head>
<body>

<div class="header">
  <h1><span>⚡</span> Flowkyn <span>API Monitor</span></h1>
  <div style="display:flex;align-items:center;gap:12px">
    <div class="live-dot" id="liveDot"></div>
    <span style="font-size:11px;color:var(--dim)" id="uptime"></span>
  </div>
</div>

<div class="stats" id="statsGrid"></div>

<div class="toolbar">
  <select id="methodFilter"><option value="">All Methods</option><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select>
  <select id="statusFilter"><option value="">All Status</option><option value="error">Errors Only</option><option value="slow">Slow Only</option></select>
  <input type="text" id="searchInput" placeholder="Search path or error..." />
  <div class="spacer"></div>
  <div class="auto-refresh"><input type="checkbox" id="autoRefresh" checked><label for="autoRefresh">Auto-refresh (2s)</label></div>
  <button onclick="fetchData()">↻ Refresh</button>
  <button class="danger" onclick="clearAll()">Clear</button>
</div>

<div class="content">
  <table class="log-table">
    <thead><tr>
      <th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>Duration</th><th>IP</th><th>Tags</th><th>Error</th>
    </tr></thead>
    <tbody id="logsBody"></tbody>
  </table>
  <div class="endpoints" id="endpointsSection"></div>
</div>

<div class="detail-overlay" id="detailOverlay" style="display:none" onclick="if(event.target===this)closeDetail()">
  <div class="detail-panel" id="detailPanel"></div>
</div>

<script>
const tokenParam = '${tokenParam}';
const BASE = '/monitor/api';
let allLogs = [];
let sse;

// Extract token from URL params if present
const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get('token');

function url(path) { 
  // Build query string: if tokenParam exists (e.g., "?token=xyz"), append with "&" or "?"
  if (!tokenParam) return BASE + path;
  const separator = path.includes('?') ? '&' : '?';
  return BASE + path + separator + tokenParam.slice(1); // slice(1) removes the leading "?"
}

// Fetch with token in header (fallback method)
function fetchWithToken(url_path) {
  const options = {
    headers: token ? { 'X-Monitor-Token': token } : {}
  };
  return fetch(url(url_path), options);
}

function showAuthError() {
  document.getElementById('logsBody').innerHTML = '<tr><td colspan="8" class="empty" style="color:var(--red)">❌ Authentication failed. Check your token.</td></tr>';
  document.getElementById('liveDot').style.background = 'var(--red)';
}

function renderStats(m) {
  const errorRate = m.totalRequests > 0 ? ((m.totalErrors / m.totalRequests) * 100).toFixed(1) : '0';
  document.getElementById('statsGrid').innerHTML = \`
    <div class="stat-card"><div class="label">Total Requests</div><div class="value blue">\${m.totalRequests.toLocaleString()}</div></div>
    <div class="stat-card"><div class="label">Errors</div><div class="value red">\${m.totalErrors.toLocaleString()}</div></div>
    <div class="stat-card"><div class="label">Error Rate</div><div class="value \${Number(errorRate)>5?'red':'green'}">\${errorRate}%</div></div>
    <div class="stat-card"><div class="label">Avg Response</div><div class="value \${m.avgResponseTime>500?'orange':'green'}">\${m.avgResponseTime}ms</div></div>
    <div class="stat-card"><div class="label">Req/min</div><div class="value blue">\${m.requestsPerMinute}</div></div>
    <div class="stat-card"><div class="label">Status Codes</div><div class="value" style="font-size:13px">\${Object.entries(m.statusCodes).map(([k,v])=>\`<span class="status s\${k[0]}">\${k}:\${v}</span> \`).join('')}</div></div>
  \`;
}

function getActiveFilters() {
  return {
    method: document.getElementById('methodFilter').value,
    status: document.getElementById('statusFilter').value,
    search: document.getElementById('searchInput').value.trim().toLowerCase(),
  };
}

function applyFilters(logs) {
  const { method, status, search } = getActiveFilters();
  return logs.filter(l => {
    if (method && l.method !== method) return false;
    if (status === 'error' && l.statusCode < 400) return false;
    if (status === 'slow' && l.duration <= 1000) return false;
    if (search) {
      const path = (l.path || '').toLowerCase();
      const err = (l.error || '').toLowerCase();
      if (!path.includes(search) && !err.includes(search)) return false;
    }
    return true;
  });
}

function renderLogs(logs) {
  const filtered = applyFilters(logs);
  if (!filtered.length) { document.getElementById('logsBody').innerHTML = '<tr><td colspan="8" class="empty">No matching requests. Try clearing filters.</td></tr>'; return; }
  document.getElementById('logsBody').innerHTML = filtered.map(l => \`
    <tr class="\${l.statusCode>=400?'error':''} \${l.duration>1000?'slow':''}" onclick='showDetail("\${l.id}")' style="cursor:pointer">
      <td class="time">\${new Date(l.timestamp).toLocaleTimeString()}</td>
      <td><span class="method \${l.method}">\${l.method}</span></td>
      <td class="path">\${l.path}</td>
      <td><span class="status s\${String(l.statusCode)[0]}">\${l.statusCode}</span></td>
      <td><span class="duration \${l.duration>3000?'very-slow':l.duration>1000?'slow':''}">\${l.duration}ms</span></td>
      <td class="ip">\${l.ip||'—'}</td>
      <td>\${l.tags.map(t=>\`<span class="tag \${t}">\${t}</span>\`).join('')}</td>
      <td class="error-msg">\${l.error||''}</td>
    </tr>
  \`).join('');
}

function renderEndpoints(eps) {
  if (!eps.length) return;
  document.getElementById('endpointsSection').innerHTML = \`
    <h3>Top Endpoints</h3>
    <div class="ep-grid">\${eps.map(e=>\`
      <div class="ep-item">
        <span class="ep-path">\${e.path}</span>
        <span class="ep-stats"><span>\${e.count} calls</span><span>\${e.avgMs}ms avg</span></span>
      </div>
    \`).join('')}</div>
  \`;
}

function renderUptime(startedAt) {
  const ms = Date.now() - new Date(startedAt).getTime();
  const h = Math.floor(ms/3600000); const m = Math.floor((ms%3600000)/60000);
  document.getElementById('uptime').textContent = \`Uptime: \${h}h \${m}m\`;
}

function showDetail(id) {
  const log = allLogs.find(l => l.id === id);
  if (!log) return;
  document.getElementById('detailPanel').innerHTML = \`
    <button class="close-btn" onclick="closeDetail()">✕</button>
    <h3><span class="method \${log.method}">\${log.method}</span> \${log.path}</h3>
    <div class="section"><div class="section-label">General</div><pre>\${JSON.stringify({
      id: log.id, timestamp: log.timestamp, status: log.statusCode,
      duration: log.duration + 'ms', ip: log.ip, userId: log.userId || 'anonymous',
      userAgent: log.userAgent, tags: log.tags,
    }, null, 2)}</pre></div>
    \${log.requestBody ? \`<div class="section"><div class="section-label">Request Body</div><pre>\${JSON.stringify(log.requestBody, null, 2)}</pre></div>\` : ''}
    \${log.responseBody ? \`<div class="section"><div class="section-label">Response Body</div><pre>\${JSON.stringify(log.responseBody, null, 2)}</pre></div>\` : ''}
    \${log.error ? \`<div class="section"><div class="section-label">Error</div><pre style="color:var(--red)">\${log.error}</pre></div>\` : ''}
  \`;
  document.getElementById('detailOverlay').style.display = 'flex';
}

function closeDetail() { document.getElementById('detailOverlay').style.display = 'none'; }

async function clearAll() {
  if (!confirm('Clear all logs?')) return;
  try {
    const res = await fetchWithToken('/clear');
    if (!res.ok) {
      console.error('Clear failed:', res.status, res.statusText);
      if (res.status === 401) showAuthError();
      return;
    }
    await res.json();
    // After clear, reload a fresh snapshot
    fetchSnapshot();
  } catch (e) {
    console.error('[Monitor] Clear error:', e);
  }
}

// Fallback one-off fetch (used on clear / error)
async function fetchSnapshot() {
  try {
    const [logsRes, metricsRes] = await Promise.all([
      fetchWithToken('/logs').then(r => {
        if (!r.ok) {
          console.error('Logs fetch error:', r.status, r.statusText);
          if (r.status === 401) showAuthError();
        }
        return r.json();
      }).catch(e => { console.error('Logs fetch failed:', e); return []; }),
      fetchWithToken('/metrics').then(r => {
        if (!r.ok) {
          console.error('Metrics fetch error:', r.status, r.statusText);
          if (r.status === 401) showAuthError();
        }
        return r.json();
      }).catch(e => { console.error('Metrics fetch failed:', e); return { totalRequests: 0, totalErrors: 0, avgResponseTime: 0, requestsPerMinute: 0, statusCodes: {}, topEndpoints: [], startedAt: new Date().toISOString() }; }),
    ]);

    if (Array.isArray(logsRes)) {
      allLogs = logsRes;
      renderStats(metricsRes);
      renderLogs(allLogs);
      renderEndpoints(metricsRes.topEndpoints);
      renderUptime(metricsRes.startedAt);
    }
  } catch (e) {
    console.error('[Monitor] Snapshot fetch error:', e);
  }
}

// Real-time SSE stream
function startStream() {
  if (sse) {
    sse.close();
  }
  try {
    const streamUrl = url('/stream');
    sse = new EventSource(streamUrl);

    sse.onopen = () => {
      document.getElementById('liveDot').style.background = 'var(--green)';
    };

    sse.onerror = (err) => {
      console.error('[Monitor] SSE error:', err);
      document.getElementById('liveDot').style.background = 'var(--orange)';
    };

    sse.addEventListener('snapshot', (event) => {
      try {
        const payload = JSON.parse(event.data);
        allLogs = Array.isArray(payload.logs) ? payload.logs : [];
        renderStats(payload.metrics);
        renderLogs(allLogs);
        renderEndpoints(payload.metrics.topEndpoints || []);
        renderUptime(payload.metrics.startedAt);
      } catch (e) {
        console.error('[Monitor] Snapshot parse error:', e);
      }
    });

    sse.addEventListener('log', (event) => {
      try {
        const log = JSON.parse(event.data);
        allLogs.unshift(log);
        if (allLogs.length > 1000) allLogs.pop();
        renderLogs(allLogs);
      } catch (e) {
        console.error('[Monitor] Log event parse error:', e);
      }
    });

    sse.addEventListener('metrics', (event) => {
      try {
        const metrics = JSON.parse(event.data);
        renderStats(metrics);
        renderEndpoints(metrics.topEndpoints || []);
        renderUptime(metrics.startedAt);
      } catch (e) {
        console.error('[Monitor] Metrics event parse error:', e);
      }
    });
  } catch (e) {
    console.error('[Monitor] Failed to start SSE stream:', e);
  }
}

// Toolbar interactions — now just re-render from local logs
document.getElementById('methodFilter').addEventListener('change', () => renderLogs(allLogs));
document.getElementById('statusFilter').addEventListener('change', () => renderLogs(allLogs));
let searchTimeout;
document.getElementById('searchInput').addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => renderLogs(allLogs), 250);
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });

startStream();
</script>
</body>
</html>`;
}

export { router as monitorRoutes };
