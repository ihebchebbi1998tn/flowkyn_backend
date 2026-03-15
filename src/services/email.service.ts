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
  strategicRoleAssignmentTemplate,
} from '../emails';

const transportOptions: nodemailer.TransportOptions & Record<string, any> = {
  host: "ssl0.ovh.net",
  port: 465,
  secure: true,
  auth: {
    user: "test_email_sending@spadadibattaglia.com",
    pass: "Dadouhibou2025",
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
};
const transporter = nodemailer.createTransport(transportOptions);

// Verify SMTP connection on startup with retry logic
let smtpVerified = false;
async function verifySMTPWithRetry(attempts = 3): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await transporter.verify();
      console.log('✅ SMTP connection verified successfully');
      smtpVerified = true;
      return;
    } catch (err: any) {
      console.warn(`⚠️ SMTP verification failed (attempt ${i + 1}/${attempts}): ${err.message}`);
      if (i < attempts - 1) {
        // Wait 2 seconds before retrying
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
  console.error('❌ SMTP connection could not be verified after retries');
}

// Try to verify SMTP on startup (non-blocking)
verifySMTPWithRetry().catch(err => {
  console.error('Fatal SMTP error:', err);
});

// Export flag for testing
export const isSMTPVerified = () => smtpVerified;

type EmailType = 'verify_account' | 'reset_password' | 'organization_invitation' | 'event_invitation' | 'strategic_role_assignment';

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
      return verifyAccountTemplate({ link: data.link, name: data.name, otpCode: data.otpCode, lang });
    case 'reset_password':
      return resetPasswordTemplate({ link: data.link, name: data.name, lang });
    case 'organization_invitation':
      return organizationInvitationTemplate({ link: data.link, orgName: data.orgName, lang });
    case 'event_invitation':
      return eventInvitationTemplate({ link: data.link, eventTitle: data.eventTitle, lang });
    case 'strategic_role_assignment':
      return strategicRoleAssignmentTemplate({
        lang,
        name: data.name,
        orgName: data.orgName,
        eventTitle: data.eventTitle,
        industryLabel: data.industryLabel,
        crisisLabel: data.crisisLabel,
        difficultyLabel: data.difficultyLabel,
        roleName: data.roleName,
        roleBrief: data.roleBrief,
        roleSecretInstructions: data.roleSecretInstructions,
        eventLink: data.eventLink,
      });
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
