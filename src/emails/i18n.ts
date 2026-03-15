/**
 * Email translations — subjects and body content for all supported languages.
 */

export type SupportedLang = 'en' | 'fr' | 'de';
export type EmailType = 'verify_account' | 'reset_password' | 'organization_invitation' | 'event_invitation' | 'strategic_role_assignment';

interface EmailTranslation {
  subject: string;
  greeting: (name?: string) => string;
  body: Record<string, string>;
  cta: string;
  footer: string;
}

type TranslationMap = Record<SupportedLang, Record<EmailType, EmailTranslation>>;

export const translations: TranslationMap = {
  // ─── English ───
  en: {
    verify_account: {
      subject: 'Verify your Flowkyn account',
      greeting: (name) => name ? `Hi ${name},` : 'Hi there,',
      body: {
        intro: 'Welcome to Flowkyn! We\'re excited to have you on board.',
        instruction: 'Please verify your email address by clicking the button below. This link is valid for 24 hours.',
        noAction: 'If you didn\'t create a Flowkyn account, you can safely ignore this email.',
      },
      cta: 'Verify my email',
      footer: '© 2026 Flowkyn. All rights reserved.',
    },
    reset_password: {
      subject: 'Reset your Flowkyn password',
      greeting: (name) => name ? `Hi ${name},` : 'Hi there,',
      body: {
        intro: 'We received a request to reset your password.',
        instruction: 'Click the button below to set a new password. This link expires in 1 hour.',
        noAction: 'If you didn\'t request a password reset, you can safely ignore this email. Your password will remain unchanged.',
      },
      cta: 'Reset password',
      footer: '© 2026 Flowkyn. All rights reserved.',
    },
    organization_invitation: {
      subject: 'You\'ve been invited to join an organization on Flowkyn',
      greeting: () => 'Hello,',
      body: {
        intro: 'You\'ve been invited to join <strong>{{orgName}}</strong> on Flowkyn.',
        instruction: 'Click the button below to accept the invitation and join the team. This invitation expires in 7 days.',
        noAction: 'If you don\'t recognize this organization, you can safely ignore this email.',
      },
      cta: 'Accept invitation',
      footer: '© 2026 Flowkyn. All rights reserved.',
    },
    event_invitation: {
      subject: 'You\'re invited to an event on Flowkyn',
      greeting: () => 'Hello,',
      body: {
        intro: 'You\'ve been invited to participate in <strong>{{eventTitle}}</strong> on Flowkyn.',
        instruction: 'Click the button below to join the event. This invitation expires in 7 days.',
        noAction: 'If you weren\'t expecting this invitation, you can safely ignore this email.',
      },
      cta: 'Join event',
      footer: '© 2026 Flowkyn. All rights reserved.',
    },
    strategic_role_assignment: {
      subject: 'Your secret role for the Strategic Escape Challenge',
      greeting: (name) => name ? `Hi ${name},` : 'Hi there,',
      body: {
        intro: 'You have been assigned a secret role for an upcoming Strategic Escape Challenge.',
        instruction: 'Read your role and unique perspective carefully before joining the session. Your role is:',
        noAction: 'If you were not expecting this, you can safely ignore this email.',
      },
      cta: 'View event and join discussion',
      footer: '© 2026 Flowkyn. All rights reserved.',
    },
  },

  // ─── French ───
  fr: {
    verify_account: {
      subject: 'Vérifiez votre compte Flowkyn',
      greeting: (name) => name ? `Bonjour ${name},` : 'Bonjour,',
      body: {
        intro: 'Bienvenue sur Flowkyn ! Nous sommes ravis de vous accueillir.',
        instruction: 'Veuillez vérifier votre adresse e-mail en cliquant sur le bouton ci-dessous. Ce lien est valide pendant 24 heures.',
        noAction: 'Si vous n\'avez pas créé de compte Flowkyn, vous pouvez ignorer cet e-mail en toute sécurité.',
      },
      cta: 'Vérifier mon e-mail',
      footer: '© 2026 Flowkyn. Tous droits réservés.',
    },
    reset_password: {
      subject: 'Réinitialisez votre mot de passe Flowkyn',
      greeting: (name) => name ? `Bonjour ${name},` : 'Bonjour,',
      body: {
        intro: 'Nous avons reçu une demande de réinitialisation de votre mot de passe.',
        instruction: 'Cliquez sur le bouton ci-dessous pour définir un nouveau mot de passe. Ce lien expire dans 1 heure.',
        noAction: 'Si vous n\'avez pas demandé de réinitialisation, ignorez simplement cet e-mail. Votre mot de passe restera inchangé.',
      },
      cta: 'Réinitialiser le mot de passe',
      footer: '© 2026 Flowkyn. Tous droits réservés.',
    },
    organization_invitation: {
      subject: 'Vous êtes invité(e) à rejoindre une organisation sur Flowkyn',
      greeting: () => 'Bonjour,',
      body: {
        intro: 'Vous avez été invité(e) à rejoindre <strong>{{orgName}}</strong> sur Flowkyn.',
        instruction: 'Cliquez sur le bouton ci-dessous pour accepter l\'invitation et rejoindre l\'équipe. Cette invitation expire dans 7 jours.',
        noAction: 'Si vous ne reconnaissez pas cette organisation, vous pouvez ignorer cet e-mail.',
      },
      cta: 'Accepter l\'invitation',
      footer: '© 2026 Flowkyn. Tous droits réservés.',
    },
    event_invitation: {
      subject: 'Vous êtes invité(e) à un événement sur Flowkyn',
      greeting: () => 'Bonjour,',
      body: {
        intro: 'Vous avez été invité(e) à participer à <strong>{{eventTitle}}</strong> sur Flowkyn.',
        instruction: 'Cliquez sur le bouton ci-dessous pour rejoindre l\'événement. Cette invitation expire dans 7 jours.',
        noAction: 'Si vous n\'attendiez pas cette invitation, vous pouvez ignorer cet e-mail.',
      },
      cta: 'Rejoindre l\'événement',
      footer: '© 2026 Flowkyn. Tous droits réservés.',
    },
    strategic_role_assignment: {
      subject: 'Votre rôle secret pour le Strategic Escape Challenge',
      greeting: (name) => name ? `Bonjour ${name},` : 'Bonjour,',
      body: {
        intro: 'Vous avez reçu un rôle secret pour un prochain Strategic Escape Challenge.',
        instruction: 'Lisez attentivement votre rôle et votre point de vue unique avant de rejoindre la session. Votre rôle est :',
        noAction: 'Si vous ne vous attendiez pas à ce message, vous pouvez ignorer cet e-mail.',
      },
      cta: 'Voir l’événement et rejoindre la discussion',
      footer: '© 2026 Flowkyn. Tous droits réservés.',
    },
  },

  // ─── German ───
  de: {
    verify_account: {
      subject: 'Bestätigen Sie Ihr Flowkyn-Konto',
      greeting: (name) => name ? `Hallo ${name},` : 'Hallo,',
      body: {
        intro: 'Willkommen bei Flowkyn! Wir freuen uns, Sie an Bord zu haben.',
        instruction: 'Bitte bestätigen Sie Ihre E-Mail-Adresse, indem Sie auf die Schaltfläche unten klicken. Dieser Link ist 24 Stunden gültig.',
        noAction: 'Wenn Sie kein Flowkyn-Konto erstellt haben, können Sie diese E-Mail ignorieren.',
      },
      cta: 'E-Mail bestätigen',
      footer: '© 2026 Flowkyn. Alle Rechte vorbehalten.',
    },
    reset_password: {
      subject: 'Setzen Sie Ihr Flowkyn-Passwort zurück',
      greeting: (name) => name ? `Hallo ${name},` : 'Hallo,',
      body: {
        intro: 'Wir haben eine Anfrage zum Zurücksetzen Ihres Passworts erhalten.',
        instruction: 'Klicken Sie auf die Schaltfläche unten, um ein neues Passwort festzulegen. Dieser Link läuft in 1 Stunde ab.',
        noAction: 'Wenn Sie kein Zurücksetzen angefordert haben, ignorieren Sie diese E-Mail. Ihr Passwort bleibt unverändert.',
      },
      cta: 'Passwort zurücksetzen',
      footer: '© 2026 Flowkyn. Alle Rechte vorbehalten.',
    },
    organization_invitation: {
      subject: 'Sie wurden eingeladen, einer Organisation auf Flowkyn beizutreten',
      greeting: () => 'Hallo,',
      body: {
        intro: 'Sie wurden eingeladen, <strong>{{orgName}}</strong> auf Flowkyn beizutreten.',
        instruction: 'Klicken Sie auf die Schaltfläche unten, um die Einladung anzunehmen und dem Team beizutreten. Diese Einladung läuft in 7 Tagen ab.',
        noAction: 'Wenn Sie diese Organisation nicht kennen, können Sie diese E-Mail ignorieren.',
      },
      cta: 'Einladung annehmen',
      footer: '© 2026 Flowkyn. Alle Rechte vorbehalten.',
    },
    event_invitation: {
      subject: 'Sie sind zu einem Event auf Flowkyn eingeladen',
      greeting: () => 'Hallo,',
      body: {
        intro: 'Sie wurden eingeladen, an <strong>{{eventTitle}}</strong> auf Flowkyn teilzunehmen.',
        instruction: 'Klicken Sie auf die Schaltfläche unten, um dem Event beizutreten. Diese Einladung läuft in 7 Tagen ab.',
        noAction: 'Wenn Sie diese Einladung nicht erwartet haben, können Sie diese E-Mail ignorieren.',
      },
      cta: 'Am Event teilnehmen',
      footer: '© 2026 Flowkyn. Alle Rechte vorbehalten.',
    },
    strategic_role_assignment: {
      subject: 'Ihre geheime Rolle für die Strategic Escape Challenge',
      greeting: (name) => name ? `Hallo ${name},` : 'Hallo,',
      body: {
        intro: 'Sie haben eine geheime Rolle für eine bevorstehende Strategic Escape Challenge erhalten.',
        instruction: 'Lesen Sie Ihre Rolle und Ihre einzigartige Perspektive sorgfältig, bevor Sie an der Sitzung teilnehmen. Ihre Rolle ist:',
        noAction: 'Wenn Sie diese Nachricht nicht erwartet haben, können Sie diese E-Mail ignorieren.',
      },
      cta: 'Event ansehen und Diskussion beitreten',
      footer: '© 2026 Flowkyn. Alle Rechte vorbehalten.',
    },
  },
};

/**
 * Get the translation for a given email type and language.
 * Falls back to English if the language is not supported.
 */
export function getTranslation(type: EmailType, lang?: string): EmailTranslation {
  const normalizedLang = (lang?.substring(0, 2).toLowerCase() || 'en') as SupportedLang;
  const langTranslations = translations[normalizedLang] || translations.en;
  return langTranslations[type] || translations.en[type];
}
