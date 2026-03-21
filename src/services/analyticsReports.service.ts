import { query } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export interface AnalyticsReport {
  id: string;
  name: string;
  report_type: 'engagement' | 'usage' | 'performance' | 'retention' | 'custom';
  data: Record<string, any>;
  format: 'json' | 'csv' | 'pdf';
  schedule_frequency?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'once';
  last_generated_at?: string;
  next_scheduled_at?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export class AnalyticsReportsService {
  /**
   * Get report by ID
   */
  async getReport(reportId: string): Promise<AnalyticsReport | null> {
    try {
      const result = await query<AnalyticsReport>(
        'SELECT * FROM analytics_reports WHERE id = $1',
        [reportId]
      );
      return result[0] || null;
    } catch (err) {
      throw new AppError(`Failed to get analytics report: ${reportId}`, 500);
    }
  }

  /**
   * List all reports with pagination and filtering
   */
  async listReports(options: {
    reportType?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: AnalyticsReport[]; total: number }> {
    try {
      const page = options.page || 1;
      const limit = options.limit || 20;
      const offset = (page - 1) * limit;

      let whereClause = '1=1';
      const params: unknown[] = [];
      let paramCount = 1;

      if (options.reportType) {
        whereClause += ` AND report_type = $${paramCount}`;
        params.push(options.reportType);
        paramCount++;
      }

      const [reports, counts] = await Promise.all([
        query<AnalyticsReport>(
          `SELECT * FROM analytics_reports WHERE ${whereClause} ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
          [...params, limit, offset]
        ),
        query<{ count: string }>(
          `SELECT COUNT(*) FROM analytics_reports WHERE ${whereClause}`,
          params
        ),
      ]);

      return { data: reports, total: Number(counts[0]?.count || 0) };
    } catch (err) {
      throw new AppError('Failed to list analytics reports', 500);
    }
  }

  /**
   * Create a new analytics report
   */
  async createReport(
    data: {
      name: string;
      reportType: 'engagement' | 'usage' | 'performance' | 'retention' | 'custom';
      reportData: Record<string, any>;
      format: 'json' | 'csv' | 'pdf';
      scheduleFrequency?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'once';
    },
    createdBy: string
  ): Promise<AnalyticsReport> {
    try {
      const nextScheduled = data.scheduleFrequency ? this.calculateNextScheduled(data.scheduleFrequency) : null;

      const result = await query<AnalyticsReport>(
        `INSERT INTO analytics_reports (name, report_type, data, format, schedule_frequency, last_generated_at, next_scheduled_at, created_by)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)
         RETURNING *`,
        [
          data.name,
          data.reportType,
          JSON.stringify(data.reportData),
          data.format,
          data.scheduleFrequency || null,
          nextScheduled,
          createdBy,
        ]
      );
      return result[0];
    } catch (err) {
      throw new AppError('Failed to create analytics report', 500);
    }
  }

  /**
   * Update an existing report
   */
  async updateReport(
    reportId: string,
    data: Partial<{
      name: string;
      reportData: Record<string, any>;
      format: 'json' | 'csv' | 'pdf';
      scheduleFrequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'once' | null;
    }>
  ): Promise<AnalyticsReport> {
    try {
      const report = await this.getReport(reportId);
      if (!report) throw new AppError(`Report not found: ${reportId}`, 404);

      const updates: string[] = [];
      const values: unknown[] = [];
      let paramCount = 1;

      if (data.name) {
        updates.push(`name = $${paramCount}`);
        values.push(data.name);
        paramCount++;
      }

      if (data.reportData) {
        updates.push(`data = $${paramCount}`);
        values.push(JSON.stringify(data.reportData));
        paramCount++;
      }

      if (data.format) {
        updates.push(`format = $${paramCount}`);
        values.push(data.format);
        paramCount++;
      }

      if (data.scheduleFrequency !== undefined) {
        updates.push(`schedule_frequency = $${paramCount}`);
        values.push(data.scheduleFrequency);
        paramCount++;

        if (data.scheduleFrequency) {
          updates.push(`next_scheduled_at = $${paramCount}`);
          values.push(this.calculateNextScheduled(data.scheduleFrequency));
          paramCount++;
        }
      }

      updates.push(`updated_at = NOW()`);

      const result = await query<AnalyticsReport>(
        `UPDATE analytics_reports SET ${updates.join(', ')} WHERE id = $${paramCount + 1} RETURNING *`,
        [...values, reportId]
      );
      return result[0];
    } catch (err) {
      throw new AppError(`Failed to update report: ${reportId}`, 500);
    }
  }

  /**
   * Delete a report
   */
  async deleteReport(reportId: string): Promise<void> {
    try {
      const report = await this.getReport(reportId);
      if (!report) throw new AppError(`Report not found: ${reportId}`, 404);

      await query('DELETE FROM analytics_reports WHERE id = $1', [reportId]);
    } catch (err) {
      throw new AppError(`Failed to delete report: ${reportId}`, 500);
    }
  }

  /**
   * Generate engagement report
   */
  async generateEngagementReport(): Promise<AnalyticsReport> {
    try {
      const reportData = {
        generatedAt: new Date().toISOString(),
        metrics: {
          totalActiveUsers: 0,
          averageEngagementScore: 0,
          totalSessions: 0,
          totalGames: 0,
        },
        trends: {
          daily: [],
          weekly: [],
          monthly: [],
        },
      };

      const result = await query<AnalyticsReport>(
        `INSERT INTO analytics_reports (name, report_type, data, format, created_by)
         VALUES ('Engagement Report - ' || NOW()::date, 'engagement', $1, 'json', 'system')
         RETURNING *`,
        [JSON.stringify(reportData)]
      );

      return result[0];
    } catch (err) {
      throw new AppError('Failed to generate engagement report', 500);
    }
  }

  /**
   * Generate usage report for a specific game or organization
   */
  async generateUsageReport(options: {
    gameKey?: string;
    orgId?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<AnalyticsReport> {
    try {
      const reportData = {
        generatedAt: new Date().toISOString(),
        filters: {
          gameKey: options.gameKey,
          orgId: options.orgId,
          startDate: options.startDate?.toISOString(),
          endDate: options.endDate?.toISOString(),
        },
        metrics: {
          totalSessions: 0,
          totalGames: 0,
          uniqueUsers: 0,
          averageSessionDuration: 0,
        },
        topContent: [],
      };

      const result = await query<AnalyticsReport>(
        `INSERT INTO analytics_reports (name, report_type, data, format, created_by)
         VALUES ('Usage Report - ' || NOW()::date, 'usage', $1, 'json', 'system')
         RETURNING *`,
        [JSON.stringify(reportData)]
      );

      return result[0];
    } catch (err) {
      throw new AppError('Failed to generate usage report', 500);
    }
  }

  /**
   * Generate retention report
   */
  async generateRetentionReport(): Promise<AnalyticsReport> {
    try {
      const reportData = {
        generatedAt: new Date().toISOString(),
        cohorts: {
          dayOne: 0,
          day7: 0,
          day14: 0,
          day30: 0,
        },
        retentionRates: {
          day1: 0,
          day7: 0,
          day14: 0,
          day30: 0,
        },
      };

      const result = await query<AnalyticsReport>(
        `INSERT INTO analytics_reports (name, report_type, data, format, created_by)
         VALUES ('Retention Report - ' || NOW()::date, 'retention', $1, 'json', 'system')
         RETURNING *`,
        [JSON.stringify(reportData)]
      );

      return result[0];
    } catch (err) {
      throw new AppError('Failed to generate retention report', 500);
    }
  }

  /**
   * Export report to CSV format
   */
  async exportToCSV(reportId: string): Promise<string> {
    try {
      const report = await this.getReport(reportId);
      if (!report) throw new AppError(`Report not found: ${reportId}`, 404);

      // Convert report data to CSV string
      const headers = Object.keys(report.data);
      const rows = Array.isArray(report.data) ? report.data : [report.data];

      let csv = headers.join(',') + '\n';
      rows.forEach((row: any) => {
        csv += headers.map((h) => String(row[h] || '')).join(',') + '\n';
      });

      return csv;
    } catch (err) {
      throw new AppError(`Failed to export report to CSV: ${reportId}`, 500);
    }
  }

  /**
   * Export report to JSON format
   */
  async exportToJSON(reportId: string): Promise<string> {
    try {
      const report = await this.getReport(reportId);
      if (!report) throw new AppError(`Report not found: ${reportId}`, 404);

      return JSON.stringify(report.data, null, 2);
    } catch (err) {
      throw new AppError(`Failed to export report to JSON: ${reportId}`, 500);
    }
  }

  /**
   * Schedule recurring report
   */
  async scheduleReport(
    reportId: string,
    frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly'
  ): Promise<AnalyticsReport> {
    try {
      const report = await this.getReport(reportId);
      if (!report) throw new AppError(`Report not found: ${reportId}`, 404);

      const nextScheduled = this.calculateNextScheduled(frequency);

      const result = await query<AnalyticsReport>(
        `UPDATE analytics_reports 
         SET schedule_frequency = $1, next_scheduled_at = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [frequency, nextScheduled, reportId]
      );

      return result[0];
    } catch (err) {
      throw new AppError(`Failed to schedule report: ${reportId}`, 500);
    }
  }

  /**
   * Get scheduled reports that need to be generated
   */
  async getScheduledReports(): Promise<AnalyticsReport[]> {
    try {
      const result = await query<AnalyticsReport>(
        `SELECT * FROM analytics_reports 
         WHERE schedule_frequency IS NOT NULL 
         AND next_scheduled_at <= NOW()
         ORDER BY next_scheduled_at ASC`,
        []
      );
      return result;
    } catch (err) {
      throw new AppError('Failed to get scheduled reports', 500);
    }
  }

  /**
   * Private: Calculate next scheduled time based on frequency
   */
  private calculateNextScheduled(frequency: string): Date {
    const now = new Date();
    switch (frequency) {
      case 'daily':
        now.setDate(now.getDate() + 1);
        break;
      case 'weekly':
        now.setDate(now.getDate() + 7);
        break;
      case 'monthly':
        now.setMonth(now.getMonth() + 1);
        break;
      case 'quarterly':
        now.setMonth(now.getMonth() + 3);
        break;
    }
    return now;
  }
}

export const analyticsReportsService = new AnalyticsReportsService();
