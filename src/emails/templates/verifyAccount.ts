/**
 * Email template: Account Verification
 * Includes both OTP code for manual entry and a verification link.
 */
import { emailLayout } from '../layout';
import { getTranslation } from '../i18n';
import { escapeHtml } from '../utils';

interface VerifyAccountData {
  link: string;
  name?: string;
  otpCode?: string;
  lang?: string;
}

export function verifyAccountTemplate(data: VerifyAccountData): { subject: string; html: string } {
  const t = getTranslation('verify_account', data.lang);
  const safeLink = encodeURI(data.link);
  const safeName = data.name ? escapeHtml(data.name) : undefined;
  const lang = (data.lang?.substring(0, 2).toLowerCase()) || 'en';

  // i18n labels for OTP section
  const otpLabels: Record<string, { code: string; orClick: string }> = {
    en: { code: 'Your verification code', orClick: 'Or click the button below to verify directly' },
    fr: { code: 'Votre code de vérification', orClick: 'Ou cliquez sur le bouton ci-dessous pour vérifier directement' },
    de: { code: 'Ihr Bestätigungscode', orClick: 'Oder klicken Sie auf die Schaltfläche unten, um direkt zu bestätigen' },
  };
  const labels = otpLabels[lang] || otpLabels.en;

  const content = `
    <h1>${t.greeting(safeName)}</h1>
    <p>${t.body.intro}</p>
    <p>${t.body.instruction}</p>
    ${data.otpCode ? `
    <div style="margin:24px 0;text-align:center;">
      <p style="font-size:14px;color:#666;margin-bottom:12px;">${labels.code}:</p>
      <div style="display:inline-block;padding:16px 32px;background:#f4f4f5;border-radius:12px;letter-spacing:8px;font-size:32px;font-weight:700;font-family:monospace;color:#18181b;">
        ${escapeHtml(data.otpCode)}
      </div>
    </div>
    <p style="text-align:center;font-size:13px;color:#888;margin:0 0 8px 0;">${labels.orClick}:</p>
    ` : ''}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;">
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
