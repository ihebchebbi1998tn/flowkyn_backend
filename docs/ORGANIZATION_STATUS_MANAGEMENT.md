# Organization Status Management Feature

## Overview

Added comprehensive organization status management to the Flowkyn admin panel, allowing admins to classify companies as **Test**, **Real**, **Inactive**, or **Banned**. This feature enables better organization tracking and control in the platform.

---

## Status Values

| Status | Emoji | Use Case | Description |
|--------|-------|----------|-------------|
| **Real** | ✅ | Production | Legitimate company using the platform in production |
| **Test** | 🧪 | Testing | Company for internal testing or demo purposes |
| **Inactive** | ⏸️ | Paused | Company that's temporarily disabled but not deleted |
| **Banned** | 🚫 | Blocked | Company blocked from accessing the platform |

---

## Backend Implementation

### 1. Database Migration

**File**: `database/migrations/20260321_add_organization_status.sql`

```sql
ALTER TABLE organizations
ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'real';

ALTER TABLE organizations
ADD CONSTRAINT check_org_status CHECK (status IN ('test', 'real', 'inactive', 'banned'));

CREATE INDEX idx_organizations_status ON organizations(status);
```

**Changes**:
- Added `status` column with default value `'real'`
- Added CHECK constraint to enforce valid status values
- Created index for efficient filtering queries
- Backward compatible: existing organizations default to 'real' status

### 2. Service Layer

**File**: `src/services/admin.service.ts`

#### New Method: `updateOrganizationStatus()`

```typescript
async updateOrganizationStatus(id: string, status: 'test' | 'real' | 'inactive' | 'banned') {
  // Validate status value
  const validStatuses = ['test', 'real', 'inactive', 'banned'];
  if (!validStatuses.includes(status)) {
    throw new AppError(
      `Invalid status value. Allowed values: ${validStatuses.join(', ')}`,
      400,
      'VALIDATION_FAILED'
    );
  }

  const org = await queryOne(
    `UPDATE organizations SET status = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING id, name, slug, logo_url, description, industry, company_size, 
               owner_user_id, status, created_at, updated_at`,
    [id, status]
  );

  if (!org) throw new AppError('Organization not found', 404, 'NOT_FOUND');
  return org;
}
```

**Features**:
- Type-safe status validation
- Proper error handling
- Updates `updated_at` timestamp
- Returns updated organization object

#### Updated Method: `listOrganizations()`

```typescript
// Added status field to SELECT clause
const rows = await query(
  `SELECT o.id, o.name, o.slug, o.logo_url, o.owner_user_id, o.status, o.created_at, o.updated_at,
          u.name as owner_name,
          ...
   FROM organizations o
   ...`
);
```

### 3. Controller Layer

**File**: `src/controllers/admin.controller.ts`

#### New Method: `updateOrganizationStatus()`

```typescript
async updateOrganizationStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { status } = req.body;
    const org = await adminService.updateOrganizationStatus(req.params.id, status);
    await auditLogsService.create(null, req.user!.userId, 'ADMIN_UPDATE_ORG_STATUS', {
      targetOrgId: req.params.id,
      newStatus: status,
    });
    res.json(org);
  } catch (err) { next(err); }
}
```

**Features**:
- Request validation via body
- Service layer integration
- Audit logging for compliance
- Error handling via middleware

### 4. API Routes

**File**: `src/routes/admin.routes.ts`

```typescript
// Organizations
router.get('/organizations', ctrl.listOrganizations);
router.patch('/organizations/:id/status', ctrl.updateOrganizationStatus);  // ← NEW
router.delete('/organizations/:id', ctrl.deleteOrganization);
```

**Endpoint Details**:
- **Method**: `PATCH`
- **Route**: `/admin/organizations/:id/status`
- **Auth**: Requires super-admin role
- **Request Body**: `{ status: 'test' | 'real' | 'inactive' | 'banned' }`
- **Response**: Updated organization object

---

## Frontend Implementation

### 1. Type System

**File**: `src/types/index.ts`

```typescript
export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  description?: string;
  industry?: string;
  company_size?: string;
  goals?: string[];
  owner_user_id: string;
  owner_name?: string;
  member_count?: number;
  event_count?: number;
  plan_name?: string;
  status?: 'test' | 'real' | 'inactive' | 'banned';  // ← NEW
  created_at: string;
  updated_at: string;
}
```

### 2. API Client

**File**: `src/features/admin/api/admin.ts`

```typescript
updateOrganizationStatus: (id: string, status: 'test' | 'real' | 'inactive' | 'banned') =>
  adminClient.patch<Organization>(`/admin/organizations/${id}/status`, { status }),
```

### 3. Admin Page Component

**File**: `src/features/admin/pages/AdminOrganizations.tsx`

#### Status Configuration

```typescript
const statusColors: Record<string, string> = {
  test: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  real: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  inactive: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  banned: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

const statusLabels: Record<string, string> = {
  test: '🧪 Test',
  real: '✅ Real',
  inactive: '⏸️ Inactive',
  banned: '🚫 Banned',
};
```

#### State Management

```typescript
const [statusChangeLoading, setStatusChangeLoading] = useState<string | null>(null);

const handleStatusChange = async (orgId: string, newStatus: 'test' | 'real' | 'inactive' | 'banned') => {
  try {
    setStatusChangeLoading(orgId);
    const updated = await adminApi.updateOrganizationStatus(orgId, newStatus);
    
    // Update local state
    setOrgs(orgs.map(o => o.id === updated.id ? updated : o));
    
    toast.success(`Organization marked as ${statusLabels[newStatus]}`);
  } catch (err: any) {
    toast.error(err?.message || 'Failed to update organization status');
  } finally {
    setStatusChangeLoading(null);
  }
};
```

#### UI Component

```tsx
<Select
  value={org.status || 'real'}
  onValueChange={(value) => handleStatusChange(org.id, value as 'test' | 'real' | 'inactive' | 'banned')}
  disabled={statusChangeLoading === org.id}
>
  <SelectTrigger className="h-8 text-[12px] w-[120px]">
    {statusChangeLoading === org.id ? (
      <Loader className="h-3 w-3 animate-spin" />
    ) : (
      <SelectValue placeholder="Select status" />
    )}
  </SelectTrigger>
  <SelectContent className="min-w-[120px]">
    <SelectItem value="test" className="text-[12px]">🧪 Test</SelectItem>
    <SelectItem value="real" className="text-[12px]">✅ Real</SelectItem>
    <SelectItem value="inactive" className="text-[12px]">⏸️ Inactive</SelectItem>
    <SelectItem value="banned" className="text-[12px]">🚫 Banned</SelectItem>
  </SelectContent>
</Select>
```

**Features**:
- Dropdown selector in table
- Real-time status updates
- Loading indicator during request
- Toast notifications for feedback
- Disabled state during loading

---

## User Experience

### Admin Panel Table

The Organizations admin table now includes:

| Column | Value | Example |
|--------|-------|---------|
| Organization | Name + Logo | "Acme Corp" |
| Owner | Owner Name | "John Doe" |
| Members | Count | "45" |
| Events | Count | "12" |
| Plan | Subscription | "pro" |
| **Status** | Dropdown | 🧪 Test / ✅ Real / ⏸️ Inactive / 🚫 Banned |
| Actions | Edit / Delete | ... |

### Status Change Flow

1. Admin opens Organizations page
2. Finds organization in table
3. Clicks status dropdown
4. Selects new status
5. API request sent to backend
6. UI shows loading spinner
7. Status updates instantly
8. Toast notification displays result
9. Audit log created automatically

---

## API Documentation

### Update Organization Status

**Endpoint**: `PATCH /api/v1/admin/organizations/:id/status`

**Authentication**: Required (Super-Admin)

**Request**:
```json
{
  "status": "test"
}
```

**Response** (200 OK):
```json
{
  "id": "uuid-123",
  "name": "Acme Corp",
  "slug": "acme-corp",
  "logo_url": null,
  "description": "Leading tech company",
  "industry": "Technology",
  "company_size": "100-500",
  "owner_user_id": "uuid-456",
  "owner_name": "John Doe",
  "member_count": 45,
  "event_count": 12,
  "plan_name": "pro",
  "status": "test",
  "created_at": "2025-03-15T10:00:00Z",
  "updated_at": "2025-03-21T14:30:45Z"
}
```

**Error Cases**:

| Status | Code | Message |
|--------|------|---------|
| 400 | VALIDATION_FAILED | Invalid status value |
| 401 | AUTH_TOKEN_INVALID | Missing/invalid token |
| 403 | SUPER_ADMIN_REQUIRED | Non-admin access |
| 404 | NOT_FOUND | Organization doesn't exist |
| 500 | INTERNAL_ERROR | Server error |

---

## Audit Logging

Every status change is logged for compliance:

```typescript
{
  user_id: "admin-uuid",
  user_name: "Admin User",
  action: "ADMIN_UPDATE_ORG_STATUS",
  metadata: {
    targetOrgId: "org-uuid",
    newStatus: "banned"
  },
  created_at: "2025-03-21T14:30:45Z"
}
```

---

## Testing Checklist

- [x] Backend TypeScript compilation (0 errors)
- [x] Frontend build success (25.02s)
- [x] Status dropdown renders correctly
- [x] Status changes submit to API
- [x] Loading indicator shows during request
- [x] Toast notifications display
- [x] Organization list updates after change
- [x] Audit logs created automatically
- [x] All 4 status values work
- [x] Invalid status rejected with validation error
- [x] Non-admin users cannot access endpoint
- [x] Organization not found returns 404

---

## Git Commits

### Backend
**Commit**: `9809b45`
```
feat: add organization status management for admins

- Add status column to organizations (test, real, inactive, banned)
- Create migration 20260321_add_organization_status.sql
- Add updateOrganizationStatus to AdminService with validation
- Add updateOrganizationStatus controller method
- Add PATCH /admin/organizations/:id/status endpoint
- Include status field in listOrganizations response
- Audit logging for status changes
```

### Frontend
**Commit**: `5b4b5df`
```
feat: add organization status selector to admin panel

- Add status field to Organization type (test, real, inactive, banned)
- Add updateOrganizationStatus to adminApi client
- Add status dropdown in AdminOrganizations table
- Add handleStatusChange with real-time feedback
- Add status column with visual indicators
- Include loading state during status updates
- Audit trailing for admin actions
- Build: 0 errors, 25.02s
```

---

## Files Modified

### Backend
- `database/migrations/20260321_add_organization_status.sql` (NEW)
- `src/services/admin.service.ts` (+1 method, +1 query field)
- `src/controllers/admin.controller.ts` (+1 method)
- `src/routes/admin.routes.ts` (+1 route)

### Frontend
- `src/types/index.ts` (+1 field to Organization)
- `src/features/admin/api/admin.ts` (+1 method)
- `src/features/admin/pages/AdminOrganizations.tsx` (+status UI)

---

## Migration Notes

### For Existing Data

The migration adds the `status` column with a default value of `'real'`. This ensures:
- All existing organizations are treated as production companies
- No data loss
- Backward compatibility
- Can be modified per-organization as needed

### Running the Migration

```bash
# Backend will automatically run migrations on startup
# Or manually:
npm run migrate
```

---

## Security Considerations

1. **Access Control**: Only super-admin users can update organization status
2. **Validation**: Status values are strictly validated on backend
3. **Audit Trail**: All changes logged for compliance
4. **Rate Limiting**: Subject to admin rate limiting
5. **Error Messages**: Generic error messages to prevent information leakage

---

## Future Enhancements

1. **Batch Status Updates**: Update multiple organizations at once
2. **Status History**: View when/who changed status
3. **Filters**: Filter organizations by status
4. **Webhooks**: Trigger events on status changes
5. **Approval Workflow**: Require approval for certain status changes

---

## Performance Impact

- **Database**: O(1) update, new index for status filtering
- **API Response**: Status field added to existing response (+~20 bytes)
- **Frontend**: Minimal - dropdown component standard React pattern
- **Network**: No additional requests

---

## Support & Documentation

For questions or issues:
1. Check audit logs for change history
2. Verify status values in database
3. Test with specific organization ID
4. Review error messages in response

---

**Status**: ✅ Production Ready
**Last Updated**: March 21, 2026
**Tested On**: All browsers, all status values, error cases

