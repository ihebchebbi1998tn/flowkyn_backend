# Zero-Downtime Deployment Strategy for Flowkyn Backend

## Current Setup Analysis
✅ **Good:**
- PM2 cluster mode (multiple instances)
- Graceful restart settings (kill_timeout: 30s, listen_timeout: 10s)
- Health checks in Docker
- Load balancing via PM2

❌ **Gaps:**
- No rolling restart strategy
- No load balancer handling
- No database migration strategy
- No health check validation
- No deployment verification

---

## Solution: Zero-Downtime Deployment (ZDD)

### Option 1: PM2 Zero-Downtime Restart (RECOMMENDED - Quick Win)
**What:** Restart processes one at a time instead of all at once

```bash
# Instead of:
pm2 restart flowkyn-api

# Use:
pm2 reload flowkyn-api
# or
pm2 gracefulReload flowkyn-api
```

**How it works:**
1. PM2 gracefully restarts one instance at a time
2. Other instances keep handling requests
3. New requests go to healthy instances
4. Old connections finish gracefully

**Setup:**
Update your ecosystem.config.cjs:

```javascript
{
  name: 'flowkyn-api',
  script: 'dist/index.js',
  instances: 'max',
  exec_mode: 'cluster',
  env: {
    NODE_ENV: 'production',
  },
  max_memory_restart: '512M',
  kill_timeout: 30000,        // ✅ Keep connections open 30s
  listen_timeout: 10000,       // ✅ Wait for server ready 10s
  wait_ready: true,            // ✅ Wait for signal before continuing
  // Listen for SIGTERM gracefully
  shutdown_with_message: true,
}
```

**Deployment Script:**
```bash
#!/bin/bash
set -e

echo "🚀 Starting zero-downtime deployment..."

# 1. Build new version
echo "📦 Building..."
npm install
npm run build

# 2. Gracefully reload (rolling restart)
echo "🔄 Reloading PM2 instances..."
pm2 gracefulReload flowkyn-api --watch

# 3. Verify all instances are healthy
echo "✅ Verifying deployment..."
pm2 list

echo "✨ Deployment complete!"
```

---

### Option 2: Blue-Green Deployment (Enterprise)
**What:** Run two full versions, switch traffic between them

```
     Load Balancer
          ↓
     ┌────┴────┐
     ↓         ↓
   BLUE    GREEN
   (Old)    (New)
    ✓        ✓
```

**Steps:**
1. Keep current version running (BLUE)
2. Deploy new version alongside (GREEN)
3. Run health checks on GREEN
4. Switch load balancer to GREEN
5. Keep BLUE as fallback

**Implementation with Docker:**
```bash
#!/bin/bash
# Deploy new version to GREEN environment
docker-compose up -d flowkyn-green

# Wait for health checks
sleep 10
if curl -f http://localhost:3001/health; then
  echo "✅ GREEN healthy, switching traffic..."
  # Update load balancer/nginx to point to GREEN
  systemctl reload nginx
  # Keep BLUE as fallback for rollback
  echo "✅ Deployment complete. BLUE is fallback."
else
  echo "❌ GREEN failed health check. Keeping BLUE."
  docker-compose down flowkyn-green
  exit 1
fi
```

---

### Option 3: Canary Deployment (Safest)
**What:** Deploy to subset of servers, monitor, then expand

```
Traffic: 95% to STABLE | 5% to CANARY
         (monitors errors, response times)
         → If good: expand to 50%
         → If bad: rollback
```

**With PM2:**
```bash
#!/bin/bash

# 1. Update code
git pull origin main
npm install
npm run build

# 2. Start new instance as canary
pm2 start dist/index.js --name "flowkyn-canary" --env production

# 3. Monitor for 2 minutes
echo "⏱️ Monitoring canary for 2 minutes..."
sleep 120

# 4. Check canary health
if pm2 show flowkyn-canary | grep -q "online"; then
  echo "✅ Canary healthy!"
  
  # 5. Add canary to load balancer pool
  # (depends on your load balancer setup)
  
  # 6. Monitor error rates
  sleep 60
  
  # 7. If stable, upgrade all instances
  pm2 gracefulReload flowkyn-api
  pm2 delete flowkyn-canary
else
  echo "❌ Canary failed, rolling back..."
  pm2 delete flowkyn-canary
  exit 1
fi
```

---

## Database Migrations Strategy

### Problem
Migrations might cause downtime if they lock tables or change schema while code expects old schema.

### Solution: Backwards-Compatible Migrations

**1. Add New Column (Safe)**
```sql
-- ✅ Safe: Add column with default
ALTER TABLE game_sessions ADD COLUMN new_field VARCHAR(255) DEFAULT 'value';
```

**2. Remove Column (Multi-Step)**
```sql
-- Step 1: Code stops writing to column
-- Step 2: Remove from query selects
-- Step 3: Run migration
ALTER TABLE game_sessions DROP COLUMN old_field;
```

**3. Rename Column (Multi-Step)**
```sql
-- Step 1: Add new column
ALTER TABLE game_sessions ADD COLUMN new_name VARCHAR(255);
-- Step 2: Copy data
UPDATE game_sessions SET new_name = old_name;
-- Step 3: Deploy code using new_name
-- Step 4: Drop old column
ALTER TABLE game_sessions DROP COLUMN old_name;
```

**4. Create Index Concurrently (Non-Blocking)**
```sql
-- ✅ Doesn't lock table
CREATE INDEX CONCURRENTLY idx_game_sessions_new ON game_sessions(new_field);
```

---

## Updated Deployment Checklist

### Pre-Deployment
- [ ] All tests passing
- [ ] Code reviewed
- [ ] Database migrations are backwards-compatible
- [ ] Environment variables configured
- [ ] Rollback plan ready

### Deployment
- [ ] Build Docker image
- [ ] Test image locally
- [ ] Push to registry
- [ ] Deploy to staging first
- [ ] Run smoke tests
- [ ] Deploy to production with `pm2 reload`
- [ ] Monitor for errors (next 5 minutes)

### Post-Deployment
- [ ] Verify all PM2 instances online
- [ ] Check application logs
- [ ] Monitor error rates and latency
- [ ] Keep old build as rollback (1 hour minimum)

---

## Automated Deployment Script

Create `scripts/deploy.sh`:

```bash
#!/bin/bash
set -e

ENVIRONMENT=${1:-production}
BRANCH=${2:-main}

echo "🚀 Starting deployment to $ENVIRONMENT from branch $BRANCH"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Check if PM2 is running
if ! pm2 list | grep -q "flowkyn-api"; then
  echo -e "${RED}❌ PM2 is not running flowkyn-api${NC}"
  exit 1
fi

# 2. Stash any local changes
echo -e "${YELLOW}📝 Stashing local changes...${NC}"
git stash

# 3. Pull latest code
echo -e "${YELLOW}📥 Pulling latest code...${NC}"
git pull origin $BRANCH

# 4. Install dependencies
echo -e "${YELLOW}📦 Installing dependencies...${NC}"
npm ci

# 5. Build
echo -e "${YELLOW}🔨 Building...${NC}"
npm run build

# 6. Run tests
echo -e "${YELLOW}🧪 Running tests...${NC}"
npm run test

# 7. Graceful reload
echo -e "${YELLOW}🔄 Reloading PM2 instances...${NC}"
pm2 gracefulReload flowkyn-api

# 8. Verify deployment
echo -e "${YELLOW}✅ Verifying deployment...${NC}"
sleep 2

if pm2 show flowkyn-api | grep -q "online"; then
  echo -e "${GREEN}✨ Deployment successful!${NC}"
  pm2 list
  exit 0
else
  echo -e "${RED}❌ Deployment failed${NC}"
  echo "Rolling back..."
  git revert HEAD --no-edit
  npm run build
  pm2 gracefulReload flowkyn-api
  exit 1
fi
```

**Usage:**
```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh production main
```

---

## Nginx Load Balancer (For Multiple Servers)

If you have multiple servers, use Nginx to load balance:

```nginx
upstream flowkyn_backend {
    # Keep connections alive
    keepalive 32;
    
    # Server pool with health checks
    server backend1.local:3000 max_fails=3 fail_timeout=30s;
    server backend2.local:3000 max_fails=3 fail_timeout=30s;
    server backend3.local:3000 max_fails=3 fail_timeout=30s;
}

server {
    listen 80;
    server_name api.flowkyn.com;

    # Connection settings
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;

    location / {
        proxy_pass http://flowkyn_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Graceful shutdown: don't drop connections
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://flowkyn_backend;
        access_log off;
    }
}
```

---

## Socket.IO Specific Considerations

Since you have WebSockets (game sessions), consider:

### 1. Session Stickiness
Ensure users stay connected to same server:
```nginx
upstream flowkyn_backend {
    least_conn;  # Or use ip_hash for WebSocket
    server backend1.local:3000;
    server backend2.local:3000;
}
```

### 2. Graceful WebSocket Shutdown
In your Socket.IO code:
```typescript
// Listen for server shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, gracefully shutting down...');
  
  // Stop accepting new connections
  io.engine.generateId = () => null;
  
  // Wait for existing connections to close (max 30s)
  setTimeout(() => {
    console.log('Force closing remaining connections');
    process.exit(0);
  }, 30000);
});
```

### 3. Session Store (Redis)
Store Socket.IO sessions in Redis for seamless handover:
```typescript
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const pubClient = createClient();
const subClient = pubClient.duplicate();

await Promise.all([pubClient.connect(), subClient.connect()]);

io.adapter(createAdapter(pubClient, subClient));
```

---

## Monitoring & Alerting

### Health Check Endpoint
Already in Dockerfile, make sure it covers:
```typescript
app.get('/health', (req, res) => {
  // Check database connection
  // Check Redis connection
  // Check cache status
  res.json({
    status: 'ok',
    timestamp: new Date(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});
```

### Monitor These Metrics
- Response time
- Error rate
- Active connections
- Memory usage
- CPU usage
- Database query time

---

## Summary: Recommended Approach

**For your current setup (single server, PM2):**

1. **Immediate:** Use `pm2 reload` instead of `pm2 restart`
2. **Short-term:** Create deployment script (deploy.sh)
3. **Medium-term:** Add Nginx in front for load balancing
4. **Long-term:** Implement Redis for Socket.IO state + multiple servers

**Expected result:** <1 second perceived downtime instead of 5-10 seconds
