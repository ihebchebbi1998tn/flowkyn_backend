/**
 * Email template: Organization Invitation
 */
import { emailLayout } from './layout';
import { getTranslation } from './i18n';
import { escapeHtml } from './utils';

interface OrgInvitationData {
  link: string;
  orgName: string;
  lang?: string;
}

export function organizationInvitationTemplate(data: OrgInvitationData): { subject: string; html: string } {
  const t = getTranslation('organization_invitation', data.lang);
  const safeLink = encodeURI(data.link);
  const safeOrgName = escapeHtml(data.orgName);

  // Replace {{orgName}} placeholder in translated body
  const intro = t.body.intro.replace('{{orgName}}', safeOrgName);

  const content = `
    <h1>${t.greeting()}</h1>
    <p>${intro}</p>
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
  `;

  return {
    subject: `${t.subject} — ${safeOrgName}`,
    html: emailLayout({ content, footerText: t.footer, previewText: intro }),
  };
}
