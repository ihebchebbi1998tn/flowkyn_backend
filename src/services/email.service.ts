import nodemailer from 'nodemailer';
import { env } from '../config/env';

const transporter = nodemailer.createTransport({
  host: env.smtp.host,
  port: env.smtp.port,
  secure: env.smtp.secure,
  auth: {
    user: env.smtp.user,
    pass: env.smtp.pass,
  },
});

type EmailType = 'verify_account' | 'reset_password' | 'organization_invitation' | 'event_invitation';

interface EmailOptions {
  to: string;
  type: EmailType;
  data: Record<string, string>;
}

const SUBJECTS: Record<EmailType, string> = {
  verify_account: 'Verify your Flowkyn account',
  reset_password: 'Reset your password',
  organization_invitation: 'You have been invited to join an organization',
  event_invitation: 'You have been invited to an event',
};

/**
 * Escape HTML special characters to prevent XSS in email templates.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildHtml(type: EmailType, data: Record<string, string>): string {
  // Escape user-provided data, but allow URLs in href (validated by being our own domain)
  const safeData: Record<string, string> = {};
  for (const [key, val] of Object.entries(data)) {
    safeData[key] = key === 'link' ? encodeURI(val) : escapeHtml(val);
  }

  switch (type) {
    case 'verify_account':
      return `<h2>Welcome to Flowkyn!</h2><p>Click <a href="${safeData.link}">here</a> to verify your account.</p>`;
    case 'reset_password':
      return `<h2>Password Reset</h2><p>Click <a href="${safeData.link}">here</a> to reset your password. This link expires in 1 hour.</p>`;
    case 'organization_invitation':
      return `<h2>Organization Invitation</h2><p>You have been invited to join <strong>${safeData.orgName}</strong>. Click <a href="${safeData.link}">here</a> to accept.</p>`;
    case 'event_invitation':
      return `<h2>Event Invitation</h2><p>You have been invited to <strong>${safeData.eventTitle}</strong>. Click <a href="${safeData.link}">here</a> to join.</p>`;
  }
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  // Skip sending if SMTP not configured (dev mode)
  if (!env.smtp.host || !env.smtp.user) {
    console.warn(`[Email] SMTP not configured. Would have sent "${SUBJECTS[options.type]}" to ${options.to}`);
    return;
  }

  await transporter.sendMail({
    from: `"Flowkyn" <${env.smtp.user}>`,
    to: options.to,
    subject: SUBJECTS[options.type],
    html: buildHtml(options.type, options.data),
  });
}
