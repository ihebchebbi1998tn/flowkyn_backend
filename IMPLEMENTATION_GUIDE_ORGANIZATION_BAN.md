# Organization Ban Feature - Deep Analysis & Implementation Plan

## 🔍 Current State: What's Missing

### ❌ Backend Issues Found

1. **No organization ban capability**
   - Organizations table has no `status`, `is_banned`, or `banned_at` fields
   - Admins cannot ban organizations
   - No way to prevent banned org users from logging in

2. **Login check incomplete**
   - `AuthService.login()` only checks user.status (pending/active/suspended)
   - Does NOT check if user's organization is banned
   - All org members can login even if org should be banned

3. **Missing admin endpoints**
   - No `/admin/organizations/:id/ban` endpoint
   - No `/admin/organizations/:id/unban` endpoint
   - No way to view/manage banned organizations

4. **No audit logging for bans**
   - Admin ban actions not tracked in audit_logs
   - No way to know who banned an org or when

### ❌ Frontend Issues Found

1. **No ban error handling in login**
   - Login page doesn't handle `ORG_BANNED` error code
   - Users see generic "login failed" message
   - No translated error messages for ban reason

2. **No admin interface to ban orgs**
   - AdminOrganizations page doesn't show organization status
   - No ban/unban buttons
   - No way for admins to manage bans

3. **Missing translations**
   - No translations for ban-related messages
   - Error messages not available in en, fr, de

---

## 📋 Implementation Plan

### Phase 1: Database (10 minutes)

**File to create:** `database/migrations/20260321_add_organization_ban_status.sql`

```sql
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
ADD COLUMN IF NOT EXISTS banned_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS ban_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);
```

**Changes:**
- ✅ Already created at `flowkyn_backend\database\migrations\20260321_add_organization_ban_status.sql`

---

### Phase 2: Backend Authentication (20 minutes)

**File:** `src/services/auth.service.ts` - `login()` method

**Current code (lines 120-132):**
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

**Needed addition after user.status checks:**
```typescript
// Check if user's organization is banned
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
```

**Impact:**
- Blocks all users in banned organization from logging in
- Provides reason for ban if available
- Returns specific error code for frontend handling

---

### Phase 3: Backend Admin Management (25 minutes)

**File:** `src/services/admin.service.ts` - Add new methods

```typescript
async banOrganization(organizationId: string, reason: string) {
  await query(
    `UPDATE organizations 
     SET status = 'banned', banned_at = NOW(), ban_reason = $2
     WHERE id = $1`,
    [organizationId, reason]
  );
}

async unbanOrganization(organizationId: string) {
  await query(
    `UPDATE organizations 
     SET status = 'active', banned_at = NULL, ban_reason = NULL
     WHERE id = $1`,
    [organizationId]
  );
}
```

**File:** `src/controllers/admin.controller.ts` - Add endpoints

```typescript
async banOrganization(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { orgId } = req.params;
    const { reason } = req.body;
    await adminService.banOrganization(orgId, reason);
    await audit.create(req.user!.organizationId, req.user!.userId, 'ADMIN_BAN_ORGANIZATION', { orgId, reason });
    res.json({ message: 'Organization banned successfully' });
  } catch (err) { next(err); }
}

async unbanOrganization(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { orgId } = req.params;
    await adminService.unbanOrganization(orgId);
    await audit.create(req.user!.organizationId, req.user!.userId, 'ADMIN_UNBAN_ORGANIZATION', { orgId });
    res.json({ message: 'Organization unbanned successfully' });
  } catch (err) { next(err); }
}
```

**File:** `src/routes/admin.routes.ts` - Add routes

```typescript
router.post('/admin/organizations/:orgId/ban', authMiddleware, adminMiddleware, adminController.banOrganization);
router.post('/admin/organizations/:orgId/unban', authMiddleware, adminMiddleware, adminController.unbanOrganization);
```

**Impact:**
- Admins can ban organizations with a reason
- Admins can unban organizations
- All actions audited and logged

---

### Phase 4: Frontend Login Error Handling (15 minutes)

**File:** `src/features/auth/pages/Login.tsx` - Update error handling

**Current error display:**
```tsx
// Generic error message - doesn't distinguish between different error types
```

**Needed update:**
```typescript
const handleLoginError = (error: any) => {
  const errorCode = error.response?.data?.code;
  const errorMessage = error.response?.data?.error;
  
  switch(errorCode) {
    case 'ORG_BANNED':
      // Show specific ban message (from backend) or generic translated message
      return errorMessage || t('auth.errors.ORG_BANNED');
    
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

**Impact:**
- Users in banned organizations see clear message about ban
- Ban reason is displayed if admin provided one
- Messages are properly translated

---

### Phase 5: Frontend Admin Interface (20 minutes)

**File:** `src/features/admin/pages/AdminOrganizations.tsx`

**Add status column to table:**
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

**Add action buttons:**
```tsx
{
  header: 'Actions',
  id: 'actions',
  cell: ({ row }) => {
    const org = row.original;
    return org.status === 'banned' ? (
      <Button 
        variant="outline" 
        onClick={() => handleUnbanOrganization(org.id)}
      >
        {t('admin.organizations.unban')}
      </Button>
    ) : (
      <Button 
        variant="destructive" 
        onClick={() => handleBanOrganization(org.id)}
      >
        {t('admin.organizations.ban')}
      </Button>
    );
  },
}
```

**Add handler functions:**
```typescript
async function handleBanOrganization(orgId: string) {
  const reason = prompt(t('admin.organizations.banReason'));
  if (!reason) return;
  
  try {
    await adminClient.post(`/api/admin/organizations/${orgId}/ban`, { reason });
    toast.success(t('admin.organizations.ban'));
    await refetch(); // Reload table
  } catch (error) {
    toast.error(error.message);
  }
}

async function handleUnbanOrganization(orgId: string) {
  if (!confirm(t('admin.organizations.confirmUnban'))) return;
  
  try {
    await adminClient.post(`/api/admin/organizations/${orgId}/unban`);
    toast.success(t('admin.organizations.unban'));
    await refetch(); // Reload table
  } catch (error) {
    toast.error(error.message);
  }
}
```

**Impact:**
- Admins see status of each organization
- One-click ban/unban functionality
- Confirmation before unban to prevent accidents

---

### Phase 6: Translations (10 minutes)

**File:** `src/i18n/en.json`
```json
{
  "auth": {
    "errors": {
      "ORG_BANNED": "Your organization has been banned. Please contact support."
    }
  },
  "admin": {
    "organizations": {
      "status": "Status",
      "ban": "Ban Organization",
      "unban": "Unban Organization",
      "banReason": "Reason for ban (visible to users)",
      "banReasonPlaceholder": "e.g., Terms of Service violation",
      "active": "Active",
      "banned": "Banned",
      "confirmUnban": "Are you sure you want to unban this organization?"
    }
  }
}
```

**File:** `src/i18n/fr.json`
```json
{
  "auth": {
    "errors": {
      "ORG_BANNED": "Votre organisation a été bannie. Veuillez contacter le support."
    }
  },
  "admin": {
    "organizations": {
      "status": "Statut",
      "ban": "Bannir l'organisation",
      "unban": "Débannir l'organisation",
      "banReason": "Raison du bannissement (visible aux utilisateurs)",
      "banReasonPlaceholder": "ex: Violation des conditions de service",
      "active": "Actif",
      "banned": "Banni",
      "confirmUnban": "Êtes-vous sûr de vouloir débannir cette organisation?"
    }
  }
}
```

**File:** `src/i18n/de.json`
```json
{
  "auth": {
    "errors": {
      "ORG_BANNED": "Ihre Organisation wurde gesperrt. Bitte kontaktieren Sie den Support."
    }
  },
  "admin": {
    "organizations": {
      "status": "Status",
      "ban": "Organisation sperren",
      "unban": "Organisation entsperren",
      "banReason": "Grund für Sperrung (für Benutzer sichtbar)",
      "banReasonPlaceholder": "z.B. Verstoß gegen Nutzungsbedingungen",
      "active": "Aktiv",
      "banned": "Gesperrt",
      "confirmUnban": "Sind Sie sicher, dass Sie diese Organisation entsperren möchten?"
    }
  }
}
```

**Impact:**
- All UI elements properly translated
- Ban reasons shown in user's language
- Consistent terminology across app

---

## 🧪 Testing Checklist

### Backend Testing
- [ ] Migrate database: `npm run db:migrate`
- [ ] Login with user in active org → ✅ Success
- [ ] Login with user in banned org → ✅ Error code `ORG_BANNED`
- [ ] Ban org via API: `POST /api/admin/organizations/{id}/ban`
- [ ] Verify all users in org can't login
- [ ] Unban org via API: `POST /api/admin/organizations/{id}/unban`
- [ ] Verify users can login again
- [ ] Check audit logs for ban/unban entries

### Frontend Testing
- [ ] Login with banned org → See translated error message
- [ ] Admin page shows organization status badges
- [ ] Admin can ban organization with reason
- [ ] Admin can unban organization
- [ ] Test on all 3 languages (en, fr, de)

### Edge Cases
- [ ] User in multiple orgs, one banned, one active → ✅ Can't login (one is banned)
- [ ] Ban reason with special characters → ✅ Properly escaped
- [ ] Very long ban reason → ✅ Displayed correctly
- [ ] Unban and re-ban organization → ✅ Works correctly

---

## 📊 Impact Summary

| Component | Change | Impact |
|-----------|--------|--------|
| Database | Add 3 columns to organizations | Backward compatible, no breaking changes |
| Login check | Add 1 query per login | +1-2ms per login (negligible) |
| Admin interface | Add status column, ban/unban buttons | Better visibility and control |
| Error handling | Parse `ORG_BANNED` error code | Better UX for banned users |
| Translations | Add ~8 new keys per language | Consistent messaging |

---

## 🎯 Deliverables

**Backend:**
- ✅ `database/migrations/20260321_add_organization_ban_status.sql` (READY)
- ⏳ `src/services/auth.service.ts` - Update login method
- ⏳ `src/services/admin.service.ts` - Add ban/unban methods
- ⏳ `src/controllers/admin.controller.ts` - Add endpoints
- ⏳ `src/routes/admin.routes.ts` - Add routes

**Frontend:**
- ⏳ `src/features/auth/pages/Login.tsx` - Update error handling
- ⏳ `src/features/admin/pages/AdminOrganizations.tsx` - Add status column & buttons
- ⏳ `src/i18n/en.json` - English translations
- ⏳ `src/i18n/fr.json` - French translations
- ⏳ `src/i18n/de.json` - German translations

---

## ⏱️ Estimated Implementation Time

- Database migration: **5 min** (already created)
- Backend auth check: **10 min**
- Backend admin management: **15 min**
- Frontend login error handling: **10 min**
- Frontend admin interface: **15 min**
- Translations: **10 min**

**Total: ~65 minutes (1 hour)**

---

## 🚀 Ready to Implement?

The database migration file has been created and documented. 

**Next steps:**
1. Run migration: `npm run db:migrate`
2. Update auth.service.ts login method
3. Add admin ban/unban service methods
4. Add admin controller endpoints
5. Add routes
6. Update frontend login error handling
7. Update admin organizations page
8. Add translations

Would you like me to implement these changes now?
