/**
 * Strategic Escape Game - Role Definitions
 * 
 * These roles represent different perspectives in a crisis scenario.
 * Each role has distinct goals, constraints, and hidden agendas that create
 * realistic tension during discussion.
 */

export interface RoleDefinition {
  key: string;
  name: string;
  icon: string;
  perspective: string;
  goals: string[];
  constraints: string[];
  hiddenAgenda?: string;
  stakeholders: string[];
  keyQuestions: string[];
}

export const STRATEGIC_ROLES: Record<string, RoleDefinition> = {
  cfo: {
    key: 'cfo',
    name: 'Chief Financial Officer',
    icon: '💰',
    perspective: 'You see every problem through the lens of cash runway, margins, and profitability. The crisis is an opportunity to cut costs and improve unit economics. You think short-term (next quarter) while others think long-term.',
    goals: [
      'Extend cash runway to 18+ months minimum',
      'Achieve Q2 profitability targets (critical for board)',
      'Reduce operational costs by 15-20% through optimization',
      'Renegotiate vendor contracts for better terms',
      'Preserve employee benefits to avoid exodus',
    ],
    constraints: [
      'Cannot authorize spending >$50K without board approval',
      'Legally required to maintain minimum 6-month cash reserve',
      'Cannot lay off more than 10% workforce without severance costs',
      'Must report accurately to board (cannot hide problems)',
    ],
    hiddenAgenda: 'You want to cut R&D budget significantly - Product Lead will fight this tooth and nail',
    stakeholders: ['CEO', 'Board of Directors', 'Investors', 'Finance Team'],
    keyQuestions: [
      'What is the true customer acquisition cost?',
      'Can we achieve our goals with EXISTING budget?',
      'What are the break-even numbers for each option?',
      'How does this impact our monthly burn rate?',
      'What will severance costs actually be?',
    ],
  },

  cto: {
    key: 'cto',
    name: 'Chief Technology Officer',
    icon: '💻',
    perspective: 'You care about technical feasibility, system stability, and team morale. The crisis is a chance to modernize architecture and eliminate technical debt. You think about scaling and reliability while others focus on cost cutting.',
    goals: [
      'Maintain 99.9%+ system uptime (SLA critical)',
      'Reduce technical debt by 25% through refactoring',
      'Improve deployment frequency from weekly to daily',
      'Retain top engineering talent (prevent exodus)',
      'Modernize legacy systems before they fail catastrophically',
    ],
    constraints: [
      'Cannot take systems offline for more than 2 hours during crisis',
      'Must maintain backward compatibility with existing integrations',
      'Cannot fire or demote senior engineers (lose institutional knowledge)',
      'Must follow security compliance requirements (non-negotiable)',
    ],
    hiddenAgenda: 'You want to replace the legacy monolith with microservices - this will take 6+ months and everyone will hate you for it during the crisis',
    stakeholders: ['Engineering Team', 'Product Lead', 'DevOps', 'Security Team'],
    keyQuestions: [
      'What technical risks does this introduce?',
      'Can we implement this with our current engineering team?',
      'What happens if this breaks in production during the crisis?',
      'Do we have the infrastructure capacity for this?',
      'Will this create security vulnerabilities?',
    ],
  },

  hr_director: {
    key: 'hr_director',
    name: 'VP of Human Resources',
    icon: '👥',
    perspective: 'You are the voice of the employees. You see the human cost of every decision. The crisis threatens company culture and morale. You believe that losing people is worse than losing money. You think long-term (company legacy).',
    goals: [
      'Retain 90%+ of current workforce through uncertainty',
      'Preserve positive company culture and psychological safety',
      'Keep employee benefits intact (health insurance, retirement)',
      'Build transparent communication channels (reduce rumor mill)',
      'Maintain competitive salary levels (prevent top talent poaching)',
    ],
    constraints: [
      'Cannot cut benefits without 30-day federal notice',
      'Cannot change compensation terms unilaterally',
      'Must follow WARN Act for layoffs >50 people',
      'Union agreements (if applicable) limit flexibility',
      'Cannot force employees to accept role changes',
    ],
    hiddenAgenda: 'You will resist ANY proposal that includes layoffs - you know the real cost in disruption, training, and lost knowledge. You believe CFO is heartless.',
    stakeholders: ['All Employees', 'CEO', 'Legal Department', 'Recruiters'],
    keyQuestions: [
      'What will this do to employee morale and retention?',
      'Can we achieve our goals WITHOUT layoffs?',
      'How will we communicate this transparently to staff?',
      'What are our legal obligations?',
      'Which high-performers might leave if we do this?',
    ],
  },

  vp_sales: {
    key: 'vp_sales',
    name: 'VP of Sales',
    icon: '📈',
    perspective: 'You live and die by revenue. The crisis creates both risk (customers churn) and opportunity (reposition as hero vendor). You see the market window closing and want to act fast. You think about competitive positioning while others count beans.',
    goals: [
      'Prevent customer churn - keep 95%+ retention (revenue lifeline)',
      'Land 3+ new enterprise deals before Q3 (growth story)',
      'Increase average deal size by 20% (upsell panic as value)',
      'Rebuild sales team ASAP (hiring freeze must lift)',
      'Win market share while competitors are distracted',
    ],
    constraints: [
      'Cannot discount pricing by >10% without CEO approval (destroys margins)',
      'Cannot commit product features that don\'t exist yet',
      'Sales compensation is tied to revenue targets (personal skin in game)',
      'Cannot bad-mouth product/company to customers (fiduciary duty)',
    ],
    hiddenAgenda: 'You want to enter new markets that CFO thinks are too risky - these markets could 10x revenue but nobody else sees it. You\'re pushing for expansion even though cash is low.',
    stakeholders: ['Customers', 'Sales Team', 'Product Lead', 'Marketing'],
    keyQuestions: [
      'Will customers trust us through this? Or will they leave?',
      'Can we upsell our way out of this crisis?',
      'What are our competitive implications if we cut features?',
      'How do we communicate stability to the market?',
      'Which customer segments are most likely to churn?',
    ],
  },

  product_lead: {
    key: 'product_lead',
    name: 'VP of Product',
    icon: '🎯',
    perspective: 'You believe the product roadmap is sacred. Cutting features = losing competitive advantage forever. The crisis is temporary; your strategy is permanent. You think about 5-year positioning while others focus on quarterly survival.',
    goals: [
      'Complete Q2 product roadmap (all 5 features stay)',
      'Improve user retention from 65% to 75% (quality matters)',
      'Increase NPS score by 10 points (best defense is happy users)',
      'Launch AI-powered personalization feature (must ship)',
      'Win market share through superior product, not price cuts',
    ],
    constraints: [
      'Cannot ship product without meeting security requirements (liability)',
      'User data privacy is non-negotiable (regulatory requirement)',
      'Features must align with long-term company vision',
      'Cannot promise features engineering can\'t deliver',
    ],
    hiddenAgenda: 'You WILL resist feature cuts from CFO. You believe cutting R&D is shortsighted and will cause long-term decline. You\'re willing to find other cost savings but NOT at product\'s expense.',
    stakeholders: ['Engineering', 'Marketing', 'Customers', 'Design Team'],
    keyQuestions: [
      'How will cutting features impact our competitive position?',
      'What do customers REALLY need from us right now?',
      'Can we do more with less (agility vs. features)?',
      'What features would break us if we removed them?',
      'How do we communicate roadmap changes without losing confidence?',
    ],
  },

  general_counsel: {
    key: 'general_counsel',
    name: 'General Counsel',
    icon: '⚖️',
    perspective: 'You see legal and regulatory risk everywhere. Every decision is a potential lawsuit, compliance violation, or regulatory action waiting to happen. You slow things down to reduce risk. You think about liability while others think about opportunity.',
    goals: [
      'Minimize legal and regulatory exposure (risk management)',
      'Ensure compliance with ALL applicable laws (non-negotiable)',
      'Protect company IP and trade secrets (ongoing threat)',
      'Review all major business decisions (due process)',
      'Maintain clear audit trail for board and regulators',
    ],
    constraints: [
      'Cannot disclose trade secrets to customers/partners (IP protection)',
      'Must comply with data protection regulations (GDPR, CCPA, etc.)',
      'Cannot make decisions that violate existing contracts',
      'Must escalate material risks to board (fiduciary duty)',
      'Cannot indemnify company for illegal activities',
    ],
    hiddenAgenda: 'You will slow down decision-making to reduce risk - you\'ve seen companies destroyed by rushing into bad legal situations. You want more due diligence, more review, more caution. You\'re the voice of "wait, what about this risk?"',
    stakeholders: ['Board of Directors', 'Insurance Providers', 'Regulators', 'Auditors'],
    keyQuestions: [
      'What are the legal implications of this decision?',
      'Do we have a contract issue or liability exposure?',
      'What\'s our insurance coverage for this scenario?',
      'Have we consulted with external counsel?',
      'What\'s our disclosure obligation to the board?',
    ],
  },
};

/**
 * Get role definition by key
 */
export function getRoleDefinition(roleKey: string): RoleDefinition | null {
  return STRATEGIC_ROLES[roleKey] || null;
}

/**
 * Get all available roles (useful for UI)
 */
export function getAllRoles(): RoleDefinition[] {
  return Object.values(STRATEGIC_ROLES);
}

/**
 * Get all role keys
 */
export function getRoleKeys(): string[] {
  return Object.keys(STRATEGIC_ROLES);
}

/**
 * Assign roles to participants using Fisher-Yates shuffle
 * Each participant gets exactly one unique role
 * @param participantIds - Array of participant IDs
 * @returns Map of participantId -> roleKey
 */
export function assignRolesToParticipants(participantIds: string[]): Map<string, string> {
  const roles = getRoleKeys();
  const assignments = new Map<string, string>();

  if (participantIds.length === 0) {
    return assignments;
  }

  // Only assign as many roles as we have participants (cap at 6)
  const toAssign = participantIds.slice(0, Math.min(participantIds.length, roles.length));

  // Fisher-Yates shuffle for unbiased randomization
  const shuffled = [...roles];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Assign roles to participants
  toAssign.forEach((participantId, index) => {
    assignments.set(participantId, shuffled[index]);
  });

  return assignments;
}

/**
 * Format role definition for email template
 * Returns HTML-safe formatted content
 */
export function formatRoleForEmail(role: RoleDefinition): {
  html: string;
  text: string;
} {
  const html = `
    <div style="margin: 20px 0; padding: 20px; background: #f8f9fa; border-left: 4px solid #007bff; border-radius: 4px;">
      <h2 style="margin-top: 0; color: #333;">${role.icon} ${role.name}</h2>
      
      <h3 style="color: #555; border-bottom: 2px solid #007bff; padding-bottom: 10px;">Your Perspective</h3>
      <p style="color: #666; line-height: 1.6;">${role.perspective}</p>
      
      <h3 style="color: #555; border-bottom: 2px solid #007bff; padding-bottom: 10px;">Your Goals</h3>
      <ul style="color: #666; line-height: 1.8;">
        ${role.goals.map(goal => `<li>${goal}</li>`).join('')}
      </ul>
      
      <h3 style="color: #555; border-bottom: 2px solid #007bff; padding-bottom: 10px;">Your Constraints</h3>
      <ul style="color: #666; line-height: 1.8;">
        ${role.constraints.map(c => `<li>${c}</li>`).join('')}
      </ul>
      
      <h3 style="color: #555; border-bottom: 2px solid #007bff; padding-bottom: 10px;">Key Questions to Ask</h3>
      <ul style="color: #666; line-height: 1.8;">
        ${role.keyQuestions.map(q => `<li>${q}</li>`).join('')}
      </ul>
      
      <div style="margin-top: 20px; padding: 15px; background: #fff3cd; border-radius: 4px; border-left: 4px solid #ffc107;">
        <p style="margin: 0; color: #856404;">
          <strong>💡 Pro Tip:</strong> Your role has specific goals and constraints. The other participants have DIFFERENT goals with conflicting priorities. Listen for hidden agendas and challenge assumptions respectfully.
        </p>
      </div>
    </div>
  `;

  const text = `
${role.icon} ${role.name}

Your Perspective:
${role.perspective}

Your Goals:
${role.goals.map(g => `• ${g}`).join('\n')}

Your Constraints:
${role.constraints.map(c => `• ${c}`).join('\n')}

Key Questions to Ask:
${role.keyQuestions.map(q => `• ${q}`).join('\n')}

💡 Pro Tip: Your role has specific goals. The other participants have different goals with conflicting priorities. Listen and challenge respectfully.
  `;

  return { html, text };
}

/**
 * Verify role assignment prerequisites
 * @returns { isValid: boolean, error?: string }
 */
export function validateRoleAssignmentInput(data: any): { isValid: boolean; error?: string } {
  if (!data || typeof data !== 'object') {
    return { isValid: false, error: 'Invalid request body' };
  }

  // Allow empty payload - backend will use defaults
  return { isValid: true };
}
