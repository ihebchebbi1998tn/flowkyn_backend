/**
 * SMTP Test Controller
 * Allows testing different SMTP configurations from the test runner UI.
 */
import { Request, Response, NextFunction } from 'express';
import nodemailer from 'nodemailer';

interface SmtpTestRequest {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  to: string;
  lang?: string;
  template?: string;
}

export class SmtpTestController {
  /**
   * POST /smtp-test
   * Test an SMTP connection and optionally send a test email.
   */
  async testConnection(req: Request, res: Response, next: NextFunction) {
    try {
      const { host, port, secure, user, pass, to, lang, template } = req.body as SmtpTestRequest;

      if (!host || !port || !user || !pass) {
        return res.status(400).json({
          error: 'Missing required fields: host, port, user, pass',
          code: 'VALIDATION_FAILED',
        });
      }

      const startTime = Date.now();

      // Build transport options matching the main email service pattern
      const transportOptions: nodemailer.TransportOptions & Record<string, any> = {
        host,
        port,
        secure, // true for 465 (SSL), false for 587 (STARTTLS)
        auth: { user, pass },
        ...(!secure && {
          requireTLS: true,
          tls: {
            ciphers: 'SSLv3',
            rejectUnauthorized: false,
          },
        }),
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      };

      const transporter = nodemailer.createTransport(transportOptions);

      // Step 1: Verify SMTP connection
      try {
        await transporter.verify();
      } catch (verifyErr: any) {
        const duration = Date.now() - startTime;
        return res.status(200).json({
          success: false,
          step: 'verify',
          duration,
          host,
          port,
          secure,
          error: verifyErr.message,
          errorCode: verifyErr.code,
          diagnosis: diagnoseError(verifyErr),
        });
      }

      // Step 2: Send test email if recipient provided
      if (to) {
        try {
          // Build a simple test email
          const { subject, html } = buildTestEmail(host, port, secure, lang || 'en', template);

          const info = await transporter.sendMail({
            from: `"Flowkyn SMTP Test" <${user}>`,
            to,
            subject,
            html,
          });

          const duration = Date.now() - startTime;
          return res.json({
            success: true,
            step: 'send',
            duration,
            host,
            port,
            secure,
            messageId: info.messageId,
            accepted: info.accepted,
            rejected: info.rejected,
            response: info.response,
          });
        } catch (sendErr: any) {
          const duration = Date.now() - startTime;
          return res.status(200).json({
            success: false,
            step: 'send',
            duration,
            host,
            port,
            secure,
            connectionOk: true,
            error: sendErr.message,
            errorCode: sendErr.code,
            diagnosis: diagnoseError(sendErr),
          });
        }
      }

      // Connection-only test (no recipient)
      const duration = Date.now() - startTime;
      return res.json({
        success: true,
        step: 'verify',
        duration,
        host,
        port,
        secure,
        message: 'SMTP connection verified successfully',
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /smtp-test/bulk
   * Test multiple SMTP configurations in sequence.
   */
  async bulkTest(req: Request, res: Response, next: NextFunction) {
    try {
      const { configs, to, user, pass, lang } = req.body as {
        configs: Array<{ host: string; port: number; secure: boolean }>;
        to: string;
        user: string;
        pass: string;
        lang?: string;
      };

      if (!configs || !Array.isArray(configs) || configs.length === 0) {
        return res.status(400).json({ error: 'configs array is required', code: 'VALIDATION_FAILED' });
      }
      if (!user || !pass) {
        return res.status(400).json({ error: 'user and pass are required', code: 'VALIDATION_FAILED' });
      }

      const results: any[] = [];

      for (const config of configs) {
        const startTime = Date.now();
        const transportOptions: nodemailer.TransportOptions & Record<string, any> = {
          host: config.host,
          port: config.port,
          secure: config.secure,
          auth: { user, pass },
          ...(!config.secure && {
            requireTLS: true,
            tls: { ciphers: 'SSLv3', rejectUnauthorized: false },
          }),
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 15000,
        };

        const transporter = nodemailer.createTransport(transportOptions);
        const result: any = { host: config.host, port: config.port, secure: config.secure };

        try {
          await transporter.verify();
          result.connectionOk = true;

          if (to) {
            try {
              const { subject, html } = buildTestEmail(config.host, config.port, config.secure, lang || 'en');
              const info = await transporter.sendMail({
                from: `"Flowkyn SMTP Test" <${user}>`,
                to,
                subject,
                html,
              });
              result.success = true;
              result.step = 'send';
              result.messageId = info.messageId;
              result.response = info.response;
            } catch (sendErr: any) {
              result.success = false;
              result.step = 'send';
              result.error = sendErr.message;
              result.diagnosis = diagnoseError(sendErr);
            }
          } else {
            result.success = true;
            result.step = 'verify';
          }
        } catch (err: any) {
          result.success = false;
          result.step = 'verify';
          result.connectionOk = false;
          result.error = err.message;
          result.errorCode = err.code;
          result.diagnosis = diagnoseError(err);
        }

        result.duration = Date.now() - startTime;
        results.push(result);
      }

      const working = results.filter(r => r.success);
      res.json({
        total: results.length,
        successful: working.length,
        failed: results.length - working.length,
        results,
        recommendation: working.length > 0
          ? `Use ${working[0].host}:${working[0].port} (${working[0].secure ? 'SSL' : 'STARTTLS'})`
          : 'No working SMTP configuration found — check credentials',
      });
    } catch (err) {
      next(err);
    }
  }
}

/** Diagnose common SMTP errors */
function diagnoseError(err: any): string {
  const msg = (err.message || '').toLowerCase();
  const code = (err.code || '').toLowerCase();

  if (msg.includes('535') || msg.includes('authentication')) return 'Authentication failed — wrong username or password';
  if (msg.includes('getaddrinfo') || msg.includes('enotfound')) return 'DNS resolution failed — hostname not found';
  if (msg.includes('econnrefused') || msg.includes('connection refused')) return 'Connection refused — wrong host/port or firewall blocking';
  if (msg.includes('etimedout') || msg.includes('timeout')) return 'Connection timed out — host unreachable or port blocked';
  if (msg.includes('certificate') || msg.includes('ssl') || msg.includes('tls')) return 'TLS/SSL error — try toggling secure mode';
  if (msg.includes('greeting') || msg.includes('ehlo')) return 'SMTP handshake failed — server rejected connection';
  if (code === 'esocket') return 'Socket error — likely wrong port or SSL/STARTTLS mismatch';
  return `Unknown error: ${err.message}`;
}

/** Build a simple HTML test email */
function buildTestEmail(host: string, port: number, secure: boolean, lang: string, template?: string): { subject: string; html: string } {
  const timestamp = new Date().toISOString();
  const protocol = secure ? 'SSL' : 'STARTTLS';

  return {
    subject: `✅ Flowkyn SMTP Test — ${host}:${port} (${protocol})`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
        <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); border-radius: 12px; padding: 24px; color: white; text-align: center; margin-bottom: 20px;">
          <h1 style="margin: 0; font-size: 20px;">✅ SMTP Test Successful</h1>
          <p style="margin: 8px 0 0; opacity: 0.9; font-size: 13px;">Email delivered via ${host}</p>
        </div>
        <div style="background: #f8fafc; border-radius: 8px; padding: 16px; font-size: 13px; color: #334155;">
          <p style="margin: 0 0 8px;"><strong>Host:</strong> ${host}</p>
          <p style="margin: 0 0 8px;"><strong>Port:</strong> ${port}</p>
          <p style="margin: 0 0 8px;"><strong>Encryption:</strong> ${protocol}</p>
          <p style="margin: 0 0 8px;"><strong>Template:</strong> ${template || 'test'}</p>
          <p style="margin: 0 0 8px;"><strong>Language:</strong> ${lang}</p>
          <p style="margin: 0;"><strong>Timestamp:</strong> ${timestamp}</p>
        </div>
        <p style="text-align: center; color: #94a3b8; font-size: 11px; margin-top: 16px;">
          Sent by Flowkyn API Test Runner
        </p>
      </div>
    `,
  };
}
