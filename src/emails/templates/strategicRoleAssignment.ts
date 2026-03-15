import { getTranslation, EmailType, SupportedLang } from '../i18n';
import { renderLayout } from '../layout';

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

  const bodyLines = [
    t.body.intro,
    '',
    `<strong>${params.orgName}</strong> · <strong>${params.eventTitle}</strong>`,
    `${params.industryLabel} · ${params.crisisLabel} · ${params.difficultyLabel}`,
    '',
    `${t.body.instruction}`,
    '',
    `<strong>${params.roleName}</strong>`,
    params.roleBrief,
    '',
    params.roleSecretInstructions,
    '',
    t.body.noAction,
  ];

  const html = renderLayout({
    title: t.subject,
    greeting: t.greeting(params.name),
    bodyLines,
    ctaLabel: t.cta,
    ctaUrl: params.eventLink,
    footer: t.footer,
  });

  return {
    subject: t.subject,
    html,
  };
}

