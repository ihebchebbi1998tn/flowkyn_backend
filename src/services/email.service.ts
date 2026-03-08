/**
 * Email service — sends transactional emails using templates and i18n.
 */
import nodemailer from 'nodemailer';
import { env } from '../config/env';
import {
  verifyAccountTemplate,
  resetPasswordTemplate,
  organizationInvitationTemplate,
  eventInvitationTemplate,
} from '../emails';

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
  /** User's preferred language (e.g., 'en', 'fr', 'de'). Defaults to 'en'. */
  lang?: string;
}

/**
 * Build subject + HTML for an email using the appropriate template.
 */
function buildEmail(type: EmailType, data: Record<string, string>, lang?: string): { subject: string; html: string } {
  switch (type) {
    case 'verify_account':
      return verifyAccountTemplate({ link: data.link, name: data.name, lang });
    case 'reset_password':
      return resetPasswordTemplate({ link: data.link, name: data.name, lang });
    case 'organization_invitation':
      return organizationInvitationTemplate({ link: data.link, orgName: data.orgName, lang });
    case 'event_invitation':
      return eventInvitationTemplate({ link: data.link, eventTitle: data.eventTitle, lang });
  }
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  const { subject, html } = buildEmail(options.type, options.data, options.lang);

  // Skip sending if SMTP not configured (dev mode)
  if (!env.smtp.host || !env.smtp.user) {
    console.warn(`[Email] SMTP not configured. Would have sent "${subject}" to ${options.to}`);
    return;
  }

  await transporter.sendMail({
    from: `"Flowkyn" <${env.smtp.user}>`,
    to: options.to,
    subject,
    html,
  });
}
