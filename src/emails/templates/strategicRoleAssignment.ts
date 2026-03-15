import { getTranslation, EmailType, SupportedLang } from '../i18n';
import { emailLayout } from '../layout';
import { escapeHtml } from '../utils';

interface StrategicRoleTemplateParams {
  lang?: SupportedLang | string;
  name?: string;
  orgName: string;
  eventTitle: string;
  industryLabel: string;
  crisisLabel: string;
  difficultyLabel: string;
  roleName: string;
  roleBrief: string;
  roleSecretInstructions: string;
  eventLink: string;
}

export function strategicRoleAssignmentTemplate(params: StrategicRoleTemplateParams): { subject: string; html: string } {
  const t = getTranslation('strategic_role_assignment', params.lang);
  const safeName = params.name ? escapeHtml(params.name) : undefined;
  const safeLink = encodeURI(params.eventLink);

  const content = `
    <h1>${t.greeting(safeName)}</h1>
    <p>${t.body.intro}</p>
    <div style="margin:24px 0;padding:16px;background:#f9fafb;border-radius:8px;border-left:4px solid #7c3aed;">
      <p style="margin:0;font-size:14px;"><strong>${escapeHtml(params.orgName)}</strong> · <strong>${escapeHtml(params.eventTitle)}</strong></p>
      <p style="margin:8px 0 0;font-size:13px;color:#666;">${escapeHtml(params.industryLabel)} · ${escapeHtml(params.crisisLabel)} · ${escapeHtml(params.difficultyLabel)}</p>
    </div>
    <p>${t.body.instruction}</p>
    <div style="margin:24px 0;padding:16px;background:#f0f9ff;border-radius:8px;border-left:4px solid #7c3aed;">
      <p style="margin:0 0 8px;font-size:12px;color:#666;text-transform:uppercase;">${t.body.roleLabel || 'Your Role'}</p>
      <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#1a1a2e;">${escapeHtml(params.roleName)}</p>
      <p style="margin:0 0 8px;font-size:14px;color:#51545e;">${params.roleBrief}</p>
      <hr style="border:none;border-top:1px solid #cbd5e1;margin:12px 0;" />
      <p style="margin:0;font-size:13px;color:#666;"><strong>Secret Instructions:</strong></p>
      <p style="margin:8px 0 0;font-size:14px;color:#51545e;">${params.roleSecretInstructions}</p>
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;">
      <tr>
        <td>
          <a href="${safeLink}" class="btn" target="_blank">${t.cta}</a>
        </td>
      </tr>
    </table>
    <hr style="border:none;border-top:1px solid #eaeaec;margin:24px 0;" />
    <p class="text-muted">${t.body.noAction}</p>
  `;

  const html = emailLayout({
    content,
    footerText: t.footer,
    previewText: t.body.intro,
  });

  return {
    subject: t.subject,
    html,
  };
}

