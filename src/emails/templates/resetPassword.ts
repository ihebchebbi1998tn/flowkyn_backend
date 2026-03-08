/**
 * Email template: Password Reset
 */
import { emailLayout } from './layout';
import { getTranslation } from './i18n';
import { escapeHtml } from './utils';

interface ResetPasswordData {
  link: string;
  name?: string;
  lang?: string;
}

export function resetPasswordTemplate(data: ResetPasswordData): { subject: string; html: string } {
  const t = getTranslation('reset_password', data.lang);
  const safeLink = encodeURI(data.link);
  const safeName = data.name ? escapeHtml(data.name) : undefined;

  const content = `
    <h1>${t.greeting(safeName)}</h1>
    <p>${t.body.intro}</p>
    <p>${t.body.instruction}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td>
          <a href="${safeLink}" class="btn" target="_blank">${t.cta}</a>
        </td>
      </tr>
    </table>
    <hr class="divider" />
    <p class="text-muted">${t.body.noAction}</p>
    <p class="text-muted" style="word-break:break-all;font-size:12px;">
      ${safeLink}
    </p>
  `;

  return {
    subject: t.subject,
    html: emailLayout({ content, footerText: t.footer, previewText: t.body.intro }),
  };
}
