import { emailLayout } from '../layout';
import { escapeHtml } from '../utils';

interface EarlyAccessCredentialsData {
  name: string;
  email: string;
  password?: string;
  passwordResetApplied?: boolean;
  loginUrl: string;
  personalizedMessage?: string;
}

export function earlyAccessCredentialsTemplate(
  data: EarlyAccessCredentialsData
): { subject: string; html: string } {
  const safeName = escapeHtml(data.name || 'there');
  const safeEmail = escapeHtml(data.email);
  const safePassword = data.password ? escapeHtml(data.password) : '';
  const safeLoginUrl = encodeURI(data.loginUrl);
  const safeMessage = data.personalizedMessage ? escapeHtml(data.personalizedMessage) : '';

  const content = `
    <h1>Your Flowkyn early access is ready</h1>
    <p>Hi ${safeName},</p>
    <p>Your account has been prepared and you can sign in right away.</p>
    ${safeMessage ? `<p><strong>Personal note:</strong><br/>${safeMessage.replace(/\n/g, '<br/>')}</p>` : ''}
    <div style="margin:16px 0; padding:16px; border:1px solid #e5e7eb; border-radius:10px; background:#f9fafb;">
      <p style="margin:0 0 8px;"><strong>Email:</strong> ${safeEmail}</p>
      ${
        data.passwordResetApplied !== false
          ? `<p style="margin:0;"><strong>Temporary password:</strong> ${safePassword}</p>`
          : `<p style="margin:0;">Your existing password was kept unchanged.</p>`
      }
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td>
          <a href="${safeLoginUrl}" class="btn" target="_blank">Open Flowkyn Login</a>
        </td>
      </tr>
    </table>
    <hr class="divider" />
    ${
      data.passwordResetApplied !== false
        ? '<p class="text-muted">For security, please change your password after your first login.</p>'
        : '<p class="text-muted">If you forgot your password, use the password reset flow on the login page.</p>'
    }
  `;

  return {
    subject: 'Your Flowkyn early access credentials',
    html: emailLayout({
      content,
      footerText: 'Flowkyn Team',
      previewText: 'Your Flowkyn account is ready. Sign in with your temporary credentials.',
    }),
  };
}

