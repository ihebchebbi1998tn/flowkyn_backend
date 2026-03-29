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
  startTime?: string;
  endTime?: string;
}

export function eventInvitationTemplate(data: EventInvitationData): { subject: string; html: string } {
  const t = getTranslation('event_invitation', data.lang);
  const safeLink = encodeURI(data.link);
  const safeTitle = escapeHtml(data.eventTitle);

  // Replace {{eventTitle}} placeholder
  const intro = t.body.intro.replace('{{eventTitle}}', safeTitle);

  let scheduleSection = '';
  if (data.startTime || data.endTime) {
    const locale = data.lang || 'en';

    let startLines = '';
    if (data.startTime) {
      const startDate = new Date(data.startTime);
      const dateStr = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(startDate);
      const dayStr = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(startDate);
      const timeStr = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(startDate);

      startLines = `
        <p style="margin: 5px 0; font-size: 14px; color: #475569;"><strong>${t.body.dayLabel}</strong> ${dayStr}</p>
        <p style="margin: 5px 0; font-size: 14px; color: #475569;"><strong>${t.body.dateLabel}</strong> ${dateStr}</p>
        <p style="margin: 5px 0; font-size: 14px; color: #475569;"><strong>${t.body.timeLabel}</strong> ${timeStr}</p>
      `;
    }

    let endLine = '';
    if (data.endTime) {
      const endDate = new Date(data.endTime);
      const endDateStr = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' }).format(endDate);
      endLine = `
        <p style="margin: 10px 0 5px; font-size: 14px; color: #475569;"><strong>${(t.body as any).endsLabel}</strong> ${endDateStr}</p>
      `;
    }

    scheduleSection = `
      <div style="margin: 20px 0; padding: 15px; background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
        <h3 style="margin-top: 0; color: #1e293b; font-size: 16px;">${t.body.scheduleLabel}</h3>
        ${startLines}
        ${endLine}
      </div>
    `;
  }

  const content = `
    <h1>${t.greeting()}</h1>
    <p>${intro}</p>
    ${scheduleSection}
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
