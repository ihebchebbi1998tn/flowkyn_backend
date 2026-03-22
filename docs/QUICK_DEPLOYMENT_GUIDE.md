# Zero-Downtime Deployment - Quick Reference

## The Problem You're Facing
```
Current: pm2 restart flowkyn-api
❌ All instances stop immediately
❌ Users get "Cannot connect" for 5-10 seconds
❌ Active game sessions disconnected
```

## The Solution
```
New: pm2 reload flowkyn-api (or gracefulReload)
✅ Instances restart one at a time
✅ Other instances handle requests
✅ ~1 second perceived downtime
```

---

## How to Deploy (3 Steps)

### Option A: Quick Deploy (Recommended)
```bash
cd /path/to/flowkyn_backend

# 1. Pull latest code
git pull origin main

# 2. Build
npm install
npm run build

# 3. Zero-downtime restart
pm2 gracefulReload flowkyn-api
```

**Total downtime: ~1-2 seconds**

---

### Option B: Automated Deploy Script (Even Better)
```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh production main
```

**What it does:**
- ✅ Validates environment
- ✅ Pulls code
- ✅ Installs dependencies
- ✅ Builds TypeScript
- ✅ Runs tests
- ✅ Gracefully restarts PM2
- ✅ Verifies health
- ✅ Rolls back on failure

---

## Why Your Current Setup Causes Downtime

### Current (Bad)
```
pm2 restart flowkyn-api
    ↓
SIGKILL all instances immediately
    ↓
Server stops accepting connections
    ↓
Active WebSocket connections die
    ↓
In-flight requests dropped
    ↓
Users see "Connection refused"
    ↓
New instance starts (2-5 seconds)
```

### New (Good) 
```
pm2 gracefulReload flowkyn-api
    ↓
Instance 1 receives SIGTERM
    ↓
Stops accepting NEW requests
    ↓
Waits for IN-FLIGHT requests (max 30s)
    ↓
Gracefully closes WebSocket connections
    ↓
Exits cleanly
    ↓
New instance starts with requests going to other instances
    ↓
Repeat for instance 2, 3, etc.
    ↓
No downtime for users on other instances
```

---

## Key Settings in ecosystem.config.cjs

```javascript
kill_timeout: 30000,           // Wait 30s for graceful shutdown
listen_timeout: 10000,         // Wait 10s for new instance to be ready
shutdown_with_message: true,   // Send SIGTERM not SIGKILL
max_memory_restart: '512M',    // Auto-restart if memory exceeds 512MB
autorestart: true,             // Auto-restart on crash
```

---

## Monitoring During Deployment

### Watch logs in real-time
```bash
pm2 logs flowkyn-api
```

### Check PM2 status
```bash
pm2 list
pm2 show flowkyn-api
```

### Health check
```bash
curl http://localhost:3000/health
```

---

## Rollback (If Something Goes Wrong)

### Automatic (script handles it)
Script detects health check failure and auto-rolls back

### Manual
```bash
git revert HEAD --no-edit
npm install
npm run build
pm2 gracefulReload flowkyn-api
```

---

## Next Steps to Minimize Downtime Even More

### 1. Load Balancer (Nginx)
If you add Nginx in front:
- **Current:** 1-2 sec downtime
- **With Nginx:** <100ms downtime (load balancer switches traffic)

### 2. Multiple Servers
If you scale to multiple servers:
- Deploy to server 1, verify
- Deploy to server 2, verify
- Deploy to server 3, verify
- Total uptime: 100% (no downtime)

### 3. Socket.IO Session Store (Redis)
Allows seamless WebSocket connection handover:
```bash
npm install @socket.io/redis-adapter
```

---

## Commands You'll Use

### Deploy
```bash
./scripts/deploy.sh production main
```

### Monitor
```bash
pm2 logs flowkyn-api
pm2 show flowkyn-api
pm2 list
```

### Restart (emergency only)
```bash
pm2 gracefulReload flowkyn-api    # Preferred
pm2 reload flowkyn-api             # Also good
pm2 restart flowkyn-api            # Avoid (full downtime)
```

### Rollback
```bash
git revert HEAD --no-edit
npm run build
pm2 gracefulReload flowkyn-api
```

---

## Testing Zero-Downtime Locally

```bash
# Terminal 1: Start PM2
pm2 start dist/index.js --instances 3

# Terminal 2: Monitor
pm2 logs

# Terminal 3: Load test
while true; do 
  curl http://localhost:3000/health
  sleep 1
done

# Terminal 4: Deploy
npm run build
pm2 gracefulReload "0"

# Watch Terminal 3 - no failed requests!
```

---

## Final Checklist

- [ ] Updated ecosystem.config.cjs with graceful settings
- [ ] Created deployment script: `scripts/deploy.sh`
- [ ] Tested graceful reload: `pm2 gracefulReload flowkyn-api`
- [ ] Verified health endpoint: `curl localhost:3000/health`
- [ ] Tested deployment script on staging
- [ ] Trained team on new deployment process
- [ ] Documented rollback procedure

---

## Questions?

**Why `gracefulReload` not `reload`?**
- `gracefulReload` sends SIGTERM (graceful shutdown)
- `reload` is older but similar
- Both restart one instance at a time

**Why 30 second timeout?**
- Gives long-running requests time to finish
- Game sessions have time to wrap up
- Database transactions can complete

**Why test on staging first?**
- Validates new code works
- Catches issues before production
- Builds confidence in process

**What if a request times out?**
- User can retry (browser handles it)
- Much better than full 5+ second outage
