import type { SupportedLang } from './i18n';

export type StrategicRoleKey =
  | 'product_lead'
  | 'marketing_lead'
  | 'cfo'
  | 'ops_lead'
  | 'customer_success_lead';

type StrategicRoleContent = {
  name: string;
  brief: string;
  secret: string;
};

const en: Record<StrategicRoleKey, StrategicRoleContent> = {
  product_lead: {
    name: 'Product Lead',
    brief: 'You represent product strategy and user value. Push for quality, clarity, and the long-term roadmap.',
    secret: 'You know there is a high-risk product dependency that could derail the timeline. Try to surface the risk without causing panic, and propose a safer path.',
  },
  marketing_lead: {
    name: 'Marketing Lead',
    brief: 'You represent brand, messaging, and market impact. Push for trust, customer perception, and launch readiness.',
    secret: 'You have early signals that public sentiment is fragile. Aim to reduce reputational risk and avoid promises you can’t keep.',
  },
  cfo: {
    name: 'CFO',
    brief: 'You represent financial health and risk. Push for cost control, clear trade-offs, and sustainable decisions.',
    secret: 'You know the budget has limited buffer. Push for decisions that reduce downside, and ask for evidence before committing to expensive actions.',
  },
  ops_lead: {
    name: 'Operations Lead',
    brief: 'You represent execution, process, and coordination. Push for pragmatic plans, clear owners, and reliable delivery.',
    secret: 'You know the team is overloaded and operationally stretched. Push for scope reduction, sequencing, and guardrails to prevent failure.',
  },
  customer_success_lead: {
    name: 'Customer Success Lead',
    brief: 'You represent customer outcomes and retention. Push for communication, mitigation, and the customer experience.',
    secret: 'You have insight into the top accounts most likely to churn. Push for a plan that protects those customers first and communicates transparently.',
  },
};

const fr: Record<StrategicRoleKey, StrategicRoleContent> = {
  product_lead: {
    name: 'Responsable Produit',
    brief: 'Vous représentez la stratégie produit et la valeur utilisateur. Défendez la qualité, la clarté et la vision long terme.',
    secret: 'Vous savez qu’une dépendance produit à haut risque peut compromettre le planning. Essayez de remonter le risque sans paniquer l’équipe et proposez une option plus sûre.',
  },
  marketing_lead: {
    name: 'Responsable Marketing',
    brief: 'Vous représentez la marque, le message et l’impact marché. Défendez la confiance, la perception client et la préparation du lancement.',
    secret: 'Vous avez des signaux précoces que le sentiment public est fragile. Réduisez le risque réputationnel et évitez les promesses impossibles à tenir.',
  },
  cfo: {
    name: 'Directeur·rice Financier·ère',
    brief: 'Vous représentez la santé financière et le risque. Défendez le contrôle des coûts, des arbitrages clairs et des décisions durables.',
    secret: 'Vous savez que le budget a très peu de marge. Demandez des preuves avant de valider des actions coûteuses et privilégiez la réduction du risque.',
  },
  ops_lead: {
    name: 'Responsable Opérations',
    brief: 'Vous représentez l’exécution, les processus et la coordination. Défendez des plans pragmatiques, des responsables clairs et une livraison fiable.',
    secret: 'Vous savez que l’équipe est déjà surchargée. Poussez à réduire le périmètre, séquencer, et mettre des garde-fous pour éviter l’échec.',
  },
  customer_success_lead: {
    name: 'Responsable Customer Success',
    brief: 'Vous représentez la satisfaction et la rétention client. Défendez la communication, la mitigation et l’expérience client.',
    secret: 'Vous avez des informations sur les comptes clés les plus à risque. Protégez ces clients en priorité et communiquez de façon transparente.',
  },
};

const de: Record<StrategicRoleKey, StrategicRoleContent> = {
  product_lead: {
    name: 'Product Lead',
    brief: 'Sie vertreten Produktstrategie und Nutzerwert. Setzen Sie sich für Qualität, Klarheit und die langfristige Roadmap ein.',
    secret: 'Sie wissen von einer hochriskanten Produktabhängigkeit, die den Zeitplan gefährden kann. Bringen Sie das Risiko ein, ohne Panik auszulösen, und schlagen Sie einen sichereren Weg vor.',
  },
  marketing_lead: {
    name: 'Marketing Lead',
    brief: 'Sie vertreten Marke, Messaging und Marktwirkung. Setzen Sie sich für Vertrauen, Kundensicht und Launch-Readiness ein.',
    secret: 'Sie haben frühe Signale, dass die öffentliche Stimmung fragil ist. Reduzieren Sie Reputationsrisiken und vermeiden Sie Versprechen, die nicht haltbar sind.',
  },
  cfo: {
    name: 'CFO',
    brief: 'Sie vertreten finanzielle Gesundheit und Risiko. Fordern Sie Kostenkontrolle, klare Abwägungen und nachhaltige Entscheidungen.',
    secret: 'Sie wissen, dass es nur wenig Budgetpuffer gibt. Verlangen Sie Evidenz, bevor Sie teure Maßnahmen unterstützen, und reduzieren Sie Downside-Risiken.',
  },
  ops_lead: {
    name: 'Operations Lead',
    brief: 'Sie vertreten Umsetzung, Prozesse und Koordination. Fordern Sie pragmatische Pläne, klare Verantwortlichkeiten und verlässliche Lieferung.',
    secret: 'Sie wissen, dass das Team operativ stark ausgelastet ist. Drängen Sie auf Scope-Reduktion, Sequenzierung und Guardrails, um Scheitern zu verhindern.',
  },
  customer_success_lead: {
    name: 'Customer Success Lead',
    brief: 'Sie vertreten Kundenerfolg und Bindung. Fordern Sie Kommunikation, Mitigation und eine gute Customer Experience.',
    secret: 'Sie wissen, welche Top-Accounts am ehesten churnen. Priorisieren Sie den Schutz dieser Kunden und kommunizieren Sie transparent.',
  },
};

export function getStrategicRoleContent(roleKey: string, lang?: string): StrategicRoleContent | null {
  const normalized = (lang?.substring(0, 2).toLowerCase() || 'en') as SupportedLang;
  const key = roleKey as StrategicRoleKey;

  const catalog = normalized === 'fr' ? fr : normalized === 'de' ? de : en;
  return catalog[key] || null;
}

