# Feature: Organization Ban & User Login Restriction

## Current State Analysis

### Database Schema
**Status:** ❌ **NO BAN FEATURE**

**Organizations table** (schema.sql lines 61-76):
```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY,
  name VARCHAR(100),
  slug VARCHAR(120) UNIQUE,
  logo_url TEXT,
  description TEXT,
  industry VARCHAR(50),
  company_size VARCHAR(20),
  goals TEXT[],
  owner_user_id UUID,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
  -- ❌ NO STATUS OR BAN FIELD
);
```

**Missing Column:** `status VARCHAR(20)` or `is_banned BOOLEAN`

---

## Backend Implementation Required

### 1. Database Migration
**File to create:** `database/migrations/20260321_add_organization_ban_status.sql`

```sql
-- Add ban status to organizations table
ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
ADD COLUMN IF NOT EXISTS banned_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS ban_reason TEXT;

-- Status values: 'active', 'banned', 'suspended'

-- Index for admin queries
CREATE INDEX IF NOT EXISTS idx_organizations_status 
ON organizations(status);

-- Seed existing organizations as 'active'
UPDATE organizations SET status = 'active' WHERE status IS NULL;
```

### 2. Auth Service Update
**File:** `src/services/auth.service.ts`

**Current login check** (lines 120-130):
```typescript
async login(email: string, password: string, ip: string, userAgent: string) {
  const user = await queryOne<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
  if (!user) throw new AppError('Invalid email or password', 401, 'AUTH_INVALID_CREDENTIALS');
  if (user.status === 'suspended') throw new AppError('Your account has been suspended — contact support', 403, 'AUTH_ACCOUNT_SUSPENDED');
  if (user.status !== 'active') throw new AppError('Please verify your email before logging in', 403, 'AUTH_ACCOUNT_NOT_VERIFIED');
  
  const valid = await comparePassword(password, user.password_hash);
  if (!valid) throw new AppError('Invalid email or password', 401, 'AUTH_INVALID_CREDENTIALS');

  return this.sessions.createSession(user, ip, userAgent);
}
```

**Needed change:** Add organization ban check
```typescript
async login(email: string, password: string, ip: string, userAgent: string) {
  const user = await queryOne<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
  if (!user) throw new AppError('Invalid email or password', 401, 'AUTH_INVALID_CREDENTIALS');
  if (user.status === 'suspended') throw new AppError('Your account has been suspended — contact support', 403, 'AUTH_ACCOUNT_SUSPENDED');
  if (user.status !== 'active') throw new AppError('Please verify your email before logging in', 403, 'AUTH_ACCOUNT_NOT_VERIFIED');

  // NEW: Check if user's organization is banned
  const orgStatus = await queryOne<{ status: string; ban_reason?: string }>(
    `SELECT o.status, o.ban_reason
     FROM organization_members om
     JOIN organizations o ON o.id = om.organization_id
     WHERE om.user_id = $1 AND om.status = 'active'
     LIMIT 1`,
    [user.id]
  );
  
  if (orgStatus?.status === 'banned') {
    throw new AppError(
      `Your organization has been banned${orgStatus.ban_reason ? ': ' + orgStatus.ban_reason : ''}`,
      403,
      'ORG_BANNED'
    );
  }

  const valid = await comparePassword(password, user.password_hash);
  if (!valid) throw new AppError('Invalid email or password', 401, 'AUTH_INVALID_CREDENTIALS');

  return this.sessions.createSession(user, ip, userAgent);
}
```

### 3. Admin Service Update
**File:** `src/services/admin.service.ts`

Add new method to ban/unban organizations:
```typescript
async banOrganization(organizationId: string, reason: string) {
  await query(
    `UPDATE organizations 
     SET status = 'banned', banned_at = NOW(), ban_reason = $2
     WHERE id = $1`,
    [organizationId, reason]
  );
  return { message: 'Organization banned successfully' };
}

async unbanOrganization(organizationId: string) {
  await query(
    `UPDATE organizations 
     SET status = 'active', banned_at = NULL, ban_reason = NULL
     WHERE id = $1`,
    [organizationId]
  );
  return { message: 'Organization unbanned successfully' };
}
```

### 4. Admin Controller Update
**File:** `src/controllers/admin.controller.ts`

Add routes:
```typescript
async banOrganization(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { orgId } = req.params;
    const { reason } = req.body;
    const result = await adminService.banOrganization(orgId, reason);
    await audit.create(req.user!.organizationId, req.user!.userId, 'ADMIN_BAN_ORGANIZATION', { orgId, reason });
    res.json(result);
  } catch (err) { next(err); }
}

async unbanOrganization(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { orgId } = req.params;
    const result = await adminService.unbanOrganization(orgId);
    await audit.create(req.user!.organizationId, req.user!.userId, 'ADMIN_UNBAN_ORGANIZATION', { orgId });
    res.json(result);
  } catch (err) { next(err); }
}
```

### 5. Routes Update
**File:** `src/routes/admin.routes.ts`

```typescript
// Ban organization
router.post('/admin/organizations/:orgId/ban', authMiddleware, adminMiddleware, adminController.banOrganization);
router.post('/admin/organizations/:orgId/unban', authMiddleware, adminMiddleware, adminController.unbanOrganization);
```

---

## Frontend Implementation Required

### 1. i18n Translations
**File:** `src/i18n/en.json`

Add translations:
```json
{
  "auth": {
    "errors": {
      "ORG_BANNED": "Your organization has been banned. Please contact support.",
      "ORG_BANNED_WITH_REASON": "Your organization has been banned: {reason}"
    }
  },
  "admin": {
    "organizations": {
      "ban": "Ban Organization",
      "unban": "Unban Organization",
      "banReason": "Reason for ban",
      "banReasonPlaceholder": "e.g., Terms of service violation",
      "bannedAt": "Banned since",
      "status": "Status",
      "active": "Active",
      "banned": "Banned",
      "suspended": "Suspended"
    }
  }
}
```

### 2. Admin Organizations Page Update
**File:** `src/features/admin/pages/AdminOrganizations.tsx`

Add ban status column to table:
```tsx
{
  header: t('admin.organizations.status'),
  accessorKey: 'status',
  cell: ({ getValue }) => {
    const status = getValue<string>();
    return (
      <Badge variant={status === 'banned' ? 'destructive' : 'default'}>
        {t(`admin.organizations.${status}`)}
      </Badge>
    );
  },
}
```

Add ban/unban actions:
```tsx
async function handleBanOrganization(orgId: string) {
  const reason = prompt(t('admin.organizations.banReason'));
  if (!reason) return;
  
  try {
    await adminClient.post(`/admin/organizations/${orgId}/ban`, { reason });
    toast.success(t('admin.organizations.ban'));
    refetch();
  } catch (error) {
    toast.error(error.message);
  }
}

async function handleUnbanOrganization(orgId: string) {
  try {
    await adminClient.post(`/admin/organizations/${orgId}/unban`);
    toast.success(t('admin.organizations.unban'));
    refetch();
  } catch (error) {
    toast.error(error.message);
  }
}
```

### 3. Login Page Error Handling
**File:** `src/features/auth/pages/Login.tsx`

Current error handling shows generic message. Need to parse specific error codes:

```tsx
const handleLoginError = (error: any) => {
  const errorCode = error.response?.data?.code;
  
  switch(errorCode) {
    case 'ORG_BANNED':
      return t('auth.errors.ORG_BANNED');
    case 'ORG_BANNED_WITH_REASON':
      return t('auth.errors.ORG_BANNED_WITH_REASON').replace(
        '{reason}', 
        error.response?.data?.reason || 'Policy violation'
      );
    case 'AUTH_ACCOUNT_SUSPENDED':
      return t('auth.errors.AUTH_ACCOUNT_SUSPENDED');
    case 'AUTH_ACCOUNT_NOT_VERIFIED':
      return t('auth.errors.AUTH_ACCOUNT_NOT_VERIFIED');
    case 'AUTH_INVALID_CREDENTIALS':
      return t('auth.errors.AUTH_INVALID_CREDENTIALS');
    default:
      return t('auth.errors.loginFailed');
  }
};
```

---

## Implementation Checklist

### Database
- [ ] Create migration: `20260321_add_organization_ban_status.sql`
- [ ] Add `status`, `banned_at`, `ban_reason` columns
- [ ] Create index on `status` column
- [ ] Run migration: `npm run db:migrate`

### Backend
- [ ] Update `AuthService.login()` to check organization ban status
- [ ] Update `AdminService` with `banOrganization()` and `unbanOrganization()` methods
- [ ] Update `AdminController` with ban/unban endpoints
- [ ] Update `admin.routes.ts` with new routes
- [ ] Add audit logging for ban/unban actions
- [ ] Update error responses with `ORG_BANNED` code

### Frontend
- [ ] Add translations for ban-related messages (en, fr, de)
- [ ] Update `AdminOrganizations.tsx` to show status column
- [ ] Add ban/unban action buttons
- [ ] Update login error handling for `ORG_BANNED` error code
- [ ] Show translated ban reason if available

### Testing
- [ ] Test login with banned organization → should show error
- [ ] Test admin can ban organization with reason
- [ ] Test admin can unban organization
- [ ] Test audit logs record ban/unban actions
- [ ] Test error messages are properly translated (en, fr, de)

---

## API Endpoints

### Ban Organization
```http
POST /api/admin/organizations/:orgId/ban
Content-Type: application/json
Authorization: Bearer <admin-token>

{
  "reason": "Violation of Terms of Service"
}

Response: 200 OK
{
  "message": "Organization banned successfully"
}
```

### Unban Organization
```http
POST /api/admin/organizations/:orgId/unban
Content-Type: application/json
Authorization: Bearer <admin-token>

Response: 200 OK
{
  "message": "Organization unbanned successfully"
}
```

---

## Error Codes

| Code | Status | Message | Translation Key |
|------|--------|---------|-----------------|
| `ORG_BANNED` | 403 | "Your organization has been banned" | `auth.errors.ORG_BANNED` |
| `AUTH_ACCOUNT_SUSPENDED` | 403 | "Account suspended" | `auth.errors.AUTH_ACCOUNT_SUSPENDED` |
| `AUTH_ACCOUNT_NOT_VERIFIED` | 403 | "Email not verified" | `auth.errors.AUTH_ACCOUNT_NOT_VERIFIED` |

---

## Translation Keys Required

### English (en.json)
```json
{
  "auth.errors.ORG_BANNED": "Your organization has been banned. Please contact support.",
  "admin.organizations.ban": "Ban Organization",
  "admin.organizations.unban": "Unban Organization",
  "admin.organizations.status": "Status",
  "admin.organizations.active": "Active",
  "admin.organizations.banned": "Banned"
}
```

### French (fr.json)
```json
{
  "auth.errors.ORG_BANNED": "Votre organisation a été bannie. Veuillez contacter le support.",
  "admin.organizations.ban": "Bannir l'organisation",
  "admin.organizations.unban": "Débannir l'organisation",
  "admin.organizations.status": "Statut",
  "admin.organizations.active": "Actif",
  "admin.organizations.banned": "Banni"
}
```

### German (de.json)
```json
{
  "auth.errors.ORG_BANNED": "Ihre Organisation wurde gesperrt. Bitte kontaktieren Sie den Support.",
  "admin.organizations.ban": "Organisation sperren",
  "admin.organizations.unban": "Organisation entsperren",
  "admin.organizations.status": "Status",
  "admin.organizations.active": "Aktiv",
  "admin.organizations.banned": "Gesperrt"
}
```

---

## Benefits

✅ **Admin Control:** Admins can ban organizations that violate policies  
✅ **User Notification:** Users see clear, translated error messages  
✅ **Audit Trail:** All ban/unban actions logged  
✅ **Reason Tracking:** Store reason for future reference  
✅ **Easy Reversal:** Can unban if needed  
✅ **Multi-language Support:** Error messages in en, fr, de  

---

## Priority: HIGH
This is a critical administrative feature for compliance and policy enforcement.

---

**Status:** 📋 **DESIGN COMPLETE - READY FOR IMPLEMENTATION**
