import { v4 as uuid } from 'uuid';
import { query, queryOne } from '../config/database';
import { buildPaginatedResponse } from '../utils/pagination';
import { AppError } from '../middleware/errorHandler';
import { sanitizeText } from '../utils/sanitize';

const ALLOWED_TYPES = new Set(['bug_report', 'feature_request', 'issue', 'general_feedback']);
const ALLOWED_PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const ALLOWED_STATUSES = new Set(['open', 'in_progress', 'resolved', 'closed']);

export interface BugReport {
  id: string;
  user_id: string;
  title: string;
  description: string;
  type: string;
  priority: string;
  status: string;
  assigned_to_user_id?: string | null;
  resolution_notes?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  ip_address?: string | null;
  created_at: string;
  updated_at: string;
  user_name?: string;
  user_email?: string;
  assigned_to_name?: string;
  assigned_to_email?: string;
  attachment_count?: number;
}

export interface BugReportHistoryEntry {
  id: string;
  bug_report_id: string;
  changed_by_user_id?: string | null;
  field_name: string;
  old_value?: string | null;
  new_value?: string | null;
  change_type: string;
  created_at: string;
  user_name?: string;
  user_email?: string;
}

export class BugReportService {
  /**
   * Create a new bug report
   */
  async create(data: {
    userId: string;
    title: string;
    description: string;
    type: string;
    priority?: string;
    ipAddress?: string;
  }): Promise<BugReport> {
    const sanitizedTitle = sanitizeText(data.title, 300);
    const sanitizedDescription = sanitizeText(data.description, 10000);

    if (sanitizedTitle.length === 0) {
      throw new AppError('Title is required', 400, 'VALIDATION_FAILED', [
        { field: 'title', message: 'Title cannot be empty' },
      ]);
    }
    if (sanitizedDescription.length === 0) {
      throw new AppError('Description is required', 400, 'VALIDATION_FAILED', [
        { field: 'description', message: 'Description cannot be empty' },
      ]);
    }
    if (!ALLOWED_TYPES.has(data.type)) {
      throw new AppError(
        `Invalid type "${data.type}" — allowed values: ${[...ALLOWED_TYPES].join(', ')}`,
        400,
        'VALIDATION_FAILED',
        [{ field: 'type', message: 'Invalid type' }],
      );
    }

    const priority = data.priority || 'medium';
    if (!ALLOWED_PRIORITIES.has(priority)) {
      throw new AppError(
        `Invalid priority "${priority}" — allowed values: ${[...ALLOWED_PRIORITIES].join(', ')}`,
        400,
        'VALIDATION_FAILED',
        [{ field: 'priority', message: 'Invalid priority' }],
      );
    }

    const reportId = uuid();

    const [report] = await query(
      `INSERT INTO bug_reports (id, user_id, title, description, type, priority, status, ip_address, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, NOW(), NOW()) 
       RETURNING *`,
      [reportId, data.userId, sanitizedTitle, sanitizedDescription, data.type, priority, data.ipAddress || null],
    );

    // Log creation in history
    await this.logHistory(reportId, null, 'create', null, null);

    return report;
  }

  /**
   * Get a single bug report with attachments
   */
  async getById(id: string, userId?: string, isAdmin?: boolean): Promise<BugReport> {
    const report = await queryOne<BugReport>(
      `SELECT br.*, u.name as user_name, u.email as user_email,
              au.name as assigned_to_name, au.email as assigned_to_email,
              COUNT(ba.id) as attachment_count
       FROM bug_reports br
       LEFT JOIN users u ON br.user_id = u.id
       LEFT JOIN users au ON br.assigned_to_user_id = au.id
       LEFT JOIN bug_report_attachments ba ON br.id = ba.bug_report_id
       WHERE br.id = $1
       GROUP BY br.id, u.id, au.id`,
      [id],
    );

    if (!report) {
      throw new AppError('Bug report not found', 404, 'NOT_FOUND');
    }

    // Check permissions: user can only see own reports
    if (userId && !isAdmin && report.user_id !== userId) {
      throw new AppError('You do not have permission to view this bug report', 403, 'FORBIDDEN');
    }

    return report;
  }

  /**
   * List bug reports with filtering
   */
  async list(options: {
    page: number;
    limit: number;
    userId?: string; // If provided, filter to only user's reports
    status?: string;
    priority?: string;
    type?: string;
    assignedTo?: string;
    search?: string;
  }): Promise<{
    data: BugReport[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const { page, limit, userId, status, priority, type, assignedTo, search } = options;
    const offset = (page - 1) * limit;

    let whereConditions: string[] = [];
    const params: unknown[] = [];

    if (userId) {
      whereConditions.push(`br.user_id = $${params.length + 1}`);
      params.push(userId);
    }

    if (status) {
      if (!ALLOWED_STATUSES.has(status)) {
        throw new AppError(
          `Invalid status "${status}" — allowed values: ${[...ALLOWED_STATUSES].join(', ')}`,
          400,
          'VALIDATION_FAILED',
        );
      }
      whereConditions.push(`br.status = $${params.length + 1}`);
      params.push(status);
    }

    if (priority) {
      if (!ALLOWED_PRIORITIES.has(priority)) {
        throw new AppError(
          `Invalid priority "${priority}" — allowed values: ${[...ALLOWED_PRIORITIES].join(', ')}`,
          400,
          'VALIDATION_FAILED',
        );
      }
      whereConditions.push(`br.priority = $${params.length + 1}`);
      params.push(priority);
    }

    if (type) {
      if (!ALLOWED_TYPES.has(type)) {
        throw new AppError(
          `Invalid type "${type}" — allowed values: ${[...ALLOWED_TYPES].join(', ')}`,
          400,
          'VALIDATION_FAILED',
        );
      }
      whereConditions.push(`br.type = $${params.length + 1}`);
      params.push(type);
    }

    if (assignedTo) {
      whereConditions.push(`br.assigned_to_user_id = $${params.length + 1}`);
      params.push(assignedTo);
    }

    if (search) {
      const searchTerm = `%${search}%`;
      whereConditions.push(
        `(br.title ILIKE $${params.length + 1} OR br.description ILIKE $${params.length + 2} OR u.email ILIKE $${params.length + 3})`,
      );
      params.push(searchTerm, searchTerm, searchTerm);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Count total
    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(DISTINCT br.id) as count FROM bug_reports br
       LEFT JOIN users u ON br.user_id = u.id
       ${whereClause}`,
      params as any[],
    );
    const total = Number(countResult?.count || 0);

    // Fetch paginated data
    const offsetParam = params.length + 1;
    const limitParam = params.length + 2;
    const rows = await query<BugReport>(
      `SELECT br.*, u.name as user_name, u.email as user_email,
              au.name as assigned_to_name, au.email as assigned_to_email,
              COUNT(ba.id) as attachment_count
       FROM bug_reports br
       LEFT JOIN users u ON br.user_id = u.id
       LEFT JOIN users au ON br.assigned_to_user_id = au.id
       LEFT JOIN bug_report_attachments ba ON br.id = ba.bug_report_id
       ${whereClause}
       GROUP BY br.id, u.id, au.id
       ORDER BY 
         CASE 
           WHEN br.priority = 'critical' THEN 1
           WHEN br.priority = 'high' THEN 2
           WHEN br.priority = 'medium' THEN 3
           ELSE 4
         END,
         br.created_at DESC
       OFFSET $${offsetParam} LIMIT $${limitParam}`,
      [...params, offset, limit] as any[],
    );

    return buildPaginatedResponse(rows, total, page, limit);
  }

  /**
   * Update bug report (admin only typically)
   */
  async update(
    id: string,
    updates: {
      status?: string;
      priority?: string;
      assignedToUserId?: string | null;
      resolutionNotes?: string;
      resolvedAt?: boolean;
      closedAt?: boolean;
    },
    changedByUserId?: string,
  ): Promise<BugReport> {
    // Validate inputs
    if (updates.status && !ALLOWED_STATUSES.has(updates.status)) {
      throw new AppError(
        `Invalid status "${updates.status}" — allowed values: ${[...ALLOWED_STATUSES].join(', ')}`,
        400,
        'VALIDATION_FAILED',
      );
    }
    if (updates.priority && !ALLOWED_PRIORITIES.has(updates.priority)) {
      throw new AppError(
        `Invalid priority "${updates.priority}" — allowed values: ${[...ALLOWED_PRIORITIES].join(', ')}`,
        400,
        'VALIDATION_FAILED',
      );
    }

    // Fetch current state for history tracking
    const current = await queryOne<BugReport>('SELECT * FROM bug_reports WHERE id = $1', [id]);
    if (!current) {
      throw new AppError('Bug report not found', 404, 'NOT_FOUND');
    }

    // Build UPDATE statement dynamically
    const setClauses: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];

    if (updates.status !== undefined) {
      setClauses.push(`status = $${params.length + 1}`);
      params.push(updates.status);

      // Log status change
      await this.logHistory(id, changedByUserId, 'update', 'status', current.status, updates.status);

      // Set resolved_at if status changes to resolved
      if (updates.status === 'resolved' && !current.resolved_at) {
        setClauses.push(`resolved_at = NOW()`);
      }
      // Set closed_at if status changes to closed
      if (updates.status === 'closed' && !current.closed_at) {
        setClauses.push(`closed_at = NOW()`);
      }
    }

    if (updates.priority !== undefined) {
      setClauses.push(`priority = $${params.length + 1}`);
      params.push(updates.priority);
      await this.logHistory(id, changedByUserId, 'update', 'priority', current.priority, updates.priority);
    }

    if (updates.assignedToUserId !== undefined) {
      setClauses.push(`assigned_to_user_id = $${params.length + 1}`);
      params.push(updates.assignedToUserId);
      await this.logHistory(
        id,
        changedByUserId,
        'update',
        'assigned_to_user_id',
        current.assigned_to_user_id,
        updates.assignedToUserId,
      );
    }

    if (updates.resolutionNotes !== undefined) {
      const sanitizedNotes = sanitizeText(updates.resolutionNotes, 5000);
      setClauses.push(`resolution_notes = $${params.length + 1}`);
      params.push(sanitizedNotes);
      await this.logHistory(
        id,
        changedByUserId,
        'update',
        'resolution_notes',
        current.resolution_notes !== sanitizedNotes ? 'updated' : null,
        'updated',
      );
    }

    params.push(id);
    const [updated] = await query(
      `UPDATE bug_reports SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params as any[],
    );

    return updated;
  }

  /**
   * Delete a bug report (users can only delete own unresolved reports)
   */
  async delete(id: string, userId?: string, isAdmin?: boolean): Promise<string> {
    const report = await queryOne<{ user_id: string; status: string }>(
      'SELECT user_id, status FROM bug_reports WHERE id = $1',
      [id],
    );

    if (!report) {
      throw new AppError('Bug report not found', 404, 'NOT_FOUND');
    }

    // Check permissions
    if (!isAdmin && report.user_id !== userId) {
      throw new AppError('You can only delete your own bug reports', 403, 'FORBIDDEN');
    }

    // Non-admins can't delete resolved/closed reports
    if (!isAdmin && (report.status === 'resolved' || report.status === 'closed')) {
      throw new AppError('Cannot delete resolved or closed bug reports', 400, 'VALIDATION_FAILED');
    }

    await query('DELETE FROM bug_reports WHERE id = $1', [id]);
    return id;
  }

  /**
   * Get report history/audit trail
   */
  async getHistory(reportId: string): Promise<BugReportHistoryEntry[]> {
    const rows = await query<BugReportHistoryEntry>(
      `SELECT brh.*, u.name as user_name, u.email as user_email
       FROM bug_report_history brh
       LEFT JOIN users u ON brh.changed_by_user_id = u.id
       WHERE brh.bug_report_id = $1
       ORDER BY brh.created_at DESC`,
      [reportId],
    );
    return rows;
  }

  /**
   * Add an attachment
   */
  async addAttachment(data: {
    bugReportId: string;
    uploadedByUserId: string;
    fileName: string;
    fileSize: number;
    fileType: string;
    fileUrl: string;
  }): Promise<{ id: string }> {
    const attachmentId = uuid();

    await query(
      `INSERT INTO bug_report_attachments (id, bug_report_id, uploaded_by_user_id, file_name, file_size, file_type, file_url, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        attachmentId,
        data.bugReportId,
        data.uploadedByUserId,
        data.fileName,
        data.fileSize,
        data.fileType,
        data.fileUrl,
      ],
    );

    return { id: attachmentId };
  }

  /**
   * Get all attachments for a report
   */
  async getAttachments(bugReportId: string): Promise<any[]> {
    const attachments = await query(
      `SELECT ba.*, u.name as uploaded_by_name, u.email as uploaded_by_email
       FROM bug_report_attachments ba
       LEFT JOIN users u ON ba.uploaded_by_user_id = u.id
       WHERE ba.bug_report_id = $1
       ORDER BY ba.created_at DESC`,
      [bugReportId],
    );
    return attachments;
  }

  /**
   * Delete an attachment
   */
  async deleteAttachment(attachmentId: string): Promise<string> {
    const result = await queryOne(
      'DELETE FROM bug_report_attachments WHERE id = $1 RETURNING id',
      [attachmentId],
    );
    if (!result) {
      throw new AppError('Attachment not found', 404, 'NOT_FOUND');
    }
    return attachmentId;
  }

  /**
   * Log history entry
   */
  private async logHistory(
    bugReportId: string,
    changedByUserId: string | null | undefined,
    changeType: string,
    fieldName?: string | null,
    oldValue?: any,
    newValue?: any,
  ): Promise<void> {
    await query(
      `INSERT INTO bug_report_history (id, bug_report_id, changed_by_user_id, field_name, old_value, new_value, change_type, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        uuid(),
        bugReportId,
        changedByUserId || null,
        fieldName || null,
        oldValue ? String(oldValue) : null,
        newValue ? String(newValue) : null,
        changeType,
      ],
    );
  }

  /**
   * Get stats on bug reports
   */
  async getStats(): Promise<{
    totalReports: number;
    openCount: number;
    inProgressCount: number;
    resolvedCount: number;
    closedCount: number;
    criticalCount: number;
    averageResolutionTime: string;
  }> {
    const stats = await queryOne<any>(
      `SELECT
        COUNT(*) as total_reports,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open_count,
        COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_count,
        COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_count,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed_count,
        COUNT(CASE WHEN priority = 'critical' THEN 1 END) as critical_count,
        ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600)::numeric, 2) as avg_resolution_hours
       FROM bug_reports`,
      [],
    );

    return {
      totalReports: Number(stats?.total_reports || 0),
      openCount: Number(stats?.open_count || 0),
      inProgressCount: Number(stats?.in_progress_count || 0),
      resolvedCount: Number(stats?.resolved_count || 0),
      closedCount: Number(stats?.closed_count || 0),
      criticalCount: Number(stats?.critical_count || 0),
      averageResolutionTime: stats?.avg_resolution_hours ? `${stats.avg_resolution_hours} hours` : 'N/A',
    };
  }
}
