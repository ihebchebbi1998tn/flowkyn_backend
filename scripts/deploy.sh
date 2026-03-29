#!/bin/bash

###############################################################################
# Flowkyn Backend - Zero-Downtime Deployment Script
# 
# Usage: ./scripts/deploy.sh [environment] [branch]
# 
# Examples:
#   ./scripts/deploy.sh production main
#   ./scripts/deploy.sh staging develop
#   ./scripts/deploy.sh production main --skip-tests
###############################################################################

set -e

# Configuration
ENVIRONMENT=${1:-production}
BRANCH=${2:-main}
SKIP_TESTS=false

# Parse options
while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-tests)
      SKIP_TESTS=true
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }

# Configuration validation
log_info "Deploying to $ENVIRONMENT from branch $BRANCH"

# Step 1: Validate environment
log_info "Step 1/7: Validating environment..."
if [ "$ENVIRONMENT" != "production" ] && [ "$ENVIRONMENT" != "staging" ] && [ "$ENVIRONMENT" != "development" ]; then
  log_error "Invalid environment: $ENVIRONMENT (must be production, staging, or development)"
  exit 1
fi

if ! command -v pm2 &> /dev/null; then
  log_error "PM2 is not installed. Install with: npm install -g pm2"
  exit 1
fi

if ! pm2 list | grep -q "flowkyn-api"; then
  log_error "PM2 is not running 'flowkyn-api' process"
  exit 1
fi
log_success "Environment validated"

# Step 2: Prepare repository
log_info "Step 2/7: Preparing repository..."
BACKUP_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git stash --quiet || true
log_success "Repository prepared (current branch: $BACKUP_BRANCH)"

# Step 3: Pull code
log_info "Step 3/7: Pulling latest code from $BRANCH..."
if ! git pull origin $BRANCH --quiet; then
  log_error "Failed to pull from branch $BRANCH"
  git checkout $BACKUP_BRANCH --quiet
  exit 1
fi
COMMIT_HASH=$(git rev-parse --short HEAD)
log_success "Code pulled (commit: $COMMIT_HASH)"

# Step 4: Install dependencies
log_info "Step 4/7: Installing dependencies..."
npm ci --silent || {
  log_error "Failed to install dependencies"
  git checkout $BACKUP_BRANCH --quiet
  exit 1
}
log_success "Dependencies installed"

# Step 5: Build
log_info "Step 5/7: Building TypeScript..."
npm run build --silent || {
  log_error "Build failed"
  git checkout $BACKUP_BRANCH --quiet
  exit 1
}
log_success "Build successful"

# Step 6: Run tests (optional)
if [ "$SKIP_TESTS" = false ]; then
  log_info "Step 6/7: Running tests..."
  npm run test --silent || {
    log_error "Tests failed"
    git checkout $BACKUP_BRANCH --quiet
    exit 1
  }
  log_success "All tests passed"
else
  log_warning "Step 6/7: Skipping tests (--skip-tests flag)"
fi

# Step 7: Reset PM2 to the exact ecosystem state
log_info "Step 7/7: Resetting PM2 with single-instance ecosystem config..."

pm2 delete flowkyn-api >/dev/null 2>&1 || true
pm2 delete refresh-admin-stats >/dev/null 2>&1 || true

pm2 start ecosystem.config.cjs --update-env || {
  log_error "PM2 start failed"
  git checkout $BACKUP_BRANCH --quiet
  exit 1
}

pm2 save >/dev/null 2>&1 || true

# Wait for instances to come online
log_info "Waiting for instances to come online..."
ONLINE_COUNT=0
for i in {1..10}; do
  ONLINE_COUNT=$(pm2 list | grep -c "flowkyn-api.*online" || true)
  if [ "$ONLINE_COUNT" -gt 0 ]; then
    break
  fi
  sleep 1
done

# Verify exact PM2 shape
API_INSTANCE_COUNT=$(pm2 list | grep -c "flowkyn-api" || true)
API_FORK_COUNT=$(pm2 list | grep -c "flowkyn-api.*fork" || true)
if [ "$API_INSTANCE_COUNT" -ne 1 ] || [ "$API_FORK_COUNT" -ne 1 ]; then
  log_error "PM2 shape verification failed"
  log_error "Expected exactly 1 flowkyn-api in fork mode"
  pm2 list
  exit 1
fi

# Health check
log_info "Running health checks..."
HEALTH_CHECK_PASSED=false
for i in {1..5}; do
  if curl -f -s http://localhost:3000/health/live > /dev/null 2>&1; then
    HEALTH_CHECK_PASSED=true
    break
  fi
  sleep 1
done

if [ "$HEALTH_CHECK_PASSED" = true ]; then
  log_success "Health checks passed"
  
  # Final status
  log_info ""
  log_success "✨ Deployment successful!"
  log_info "Environment: $ENVIRONMENT"
  log_info "Branch: $BRANCH"
  log_info "Commit: $COMMIT_HASH"
  log_info "Online instances: $ONLINE_COUNT"
  log_info ""
  
  # Show PM2 status
  echo "PM2 Status:"
  pm2 list flowkyn-api
  
  exit 0
else
  log_error "Health check failed"
  log_warning "Rolling back to previous version..."
  
  git checkout $BACKUP_BRANCH --quiet
  npm ci --silent
  npm run build --silent
  pm2 delete flowkyn-api >/dev/null 2>&1 || true
  pm2 delete refresh-admin-stats >/dev/null 2>&1 || true
  pm2 start ecosystem.config.cjs --update-env
  pm2 save >/dev/null 2>&1 || true
  
  log_error "Rollback completed. Check logs with: pm2 logs flowkyn-api"
  exit 1
fi
