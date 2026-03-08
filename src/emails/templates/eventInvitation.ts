/**
 * Email template: Event Invitation
 */
import { emailLayout } from '../layout';
import { getTranslation } from '../i18n';
import { escapeHtml } from '../utils';

interface EventInvitationData {
  link: string;
  eventTitle: string;
  lang?: string;
}

export function eventInvitationTemplate(data: EventInvitationData): { subject: string; html: string } {
  const t = getTranslation('event_invitation', data.lang);
  const safeLink = encodeURI(data.link);
  const safeTitle = escapeHtml(data.eventTitle);

  // Replace {{eventTitle}} placeholder
  const intro = t.body.intro.replace('{{eventTitle}}', safeTitle);

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
    subject: `${t.subject} — ${safeTitle}`,
    html: emailLayout({ content, footerText: t.footer, previewText: intro }),
  };
}
