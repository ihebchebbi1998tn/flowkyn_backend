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

const transportOptions: nodemailer.TransportOptions & Record<string, any> = {
  host: "ssl0.ovh.net",
  port: 465,
  secure: true,
  auth: {
    user: "	test_email_sending@spadadibattaglia.com",
    pass: "Dadouhibou2025",
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
};

const transporter = nodemailer.createTransport(transportOptions);

// Verify SMTP connection on startup
transporter.verify()
  .then(() => console.log('✅ SMTP connection verified successfully'))
  .catch((err) => console.warn(`⚠️ SMTP verification failed: ${err.message}`));

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

  // Password is now hardcoded

  await transporter.sendMail({
    from: '"Flowkyn" <noreply@flowkyn.com>',
    to: options.to,
    subject,
    html,
  });
}
