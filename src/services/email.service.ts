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
  earlyAccessCredentialsTemplate,
} from '../emails';

const transportOptions: nodemailer.TransportOptions & Record<string, any> = {
  host: "ssl0.ovh.net",
  port: 465,
  secure: true,
  auth: {
    user: "test_email_sending_flowkyn_app@spadadibattaglia.com",
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

type EmailType =
  | 'verify_account'
  | 'reset_password'
  | 'organization_invitation'
  | 'event_invitation'
  | 'strategic_role_assignment'
  | 'early_access_credentials';

interface EmailOptions {
  to: string;
  type: EmailType;
  data: Record<string, string | boolean | undefined>;
  /** User's preferred language (e.g., 'en', 'fr', 'de'). Defaults to 'en'. */
  lang?: string;
}

/**
 * Build subject + HTML for an email using the appropriate template.
 */
function buildEmail(type: EmailType, data: Record<string, string | boolean | undefined>, lang?: string): { subject: string; html: string } {
  const getString = (key: string): string => (typeof data[key] === 'string' ? (data[key] as string) : '');
  switch (type) {
    case 'verify_account':
      return verifyAccountTemplate({ link: getString('link'), name: getString('name'), otpCode: getString('otpCode'), lang });
    case 'reset_password':
      return resetPasswordTemplate({ link: getString('link'), name: getString('name'), lang });
    case 'organization_invitation':
      return organizationInvitationTemplate({ link: getString('link'), orgName: getString('orgName'), lang });
    case 'event_invitation':
      return eventInvitationTemplate({
        link: getString('link'),
        eventTitle: getString('eventTitle'),
        startTime: getString('startTime') || undefined,
        endTime: getString('endTime') || undefined,
        lang
      });
    case 'strategic_role_assignment':
      return strategicRoleAssignmentTemplate({
        lang,
        name: getString('name'),
        orgName: getString('orgName'),
        eventTitle: getString('eventTitle'),
        industryLabel: getString('industryLabel'),
        crisisLabel: getString('crisisLabel'),
        difficultyLabel: getString('difficultyLabel'),
        roleName: getString('roleName'),
        roleBrief: getString('roleBrief'),
        roleSecretInstructions: getString('roleSecretInstructions'),
        eventLink: getString('eventLink'),
      });
    case 'early_access_credentials':
      return earlyAccessCredentialsTemplate({
        name: typeof data.name === 'string' ? data.name : '',
        email: typeof data.email === 'string' ? data.email : '',
        password: typeof data.password === 'string' ? data.password : '',
        passwordResetApplied: typeof data.passwordResetApplied === 'boolean' ? data.passwordResetApplied : true,
        loginUrl: typeof data.loginUrl === 'string' ? data.loginUrl : '',
        personalizedMessage: typeof data.personalizedMessage === 'string' ? data.personalizedMessage : '',
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
