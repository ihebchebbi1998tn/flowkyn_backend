/**
 * @fileoverview Coffee Roulette Role-Based Prompts Service
 *
 * Manages role-based conversation starters for Coffee Roulette.
 * Provides intelligent prompt selection based on participant roles/profiles.
 *
 * Architecture:
 * - Load prompts from i18n translation keys
 * - Determine player role from profile/participation data
 * - Select role-matched prompts
 * - Caching for performance optimization
 */

import { query, queryOne } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export interface RoleBasedPromptsData {
  role: string;
  prompts: string[];
}

export interface PromptSelectionContext {
  participantId: string;
  sessionId: string;
  count?: number; // Default 4, max 8
}

export class CoffeeRoulettePromptsService {
  private static readonly DEFAULT_PROMPT_COUNT = 4;
  private static readonly MAX_PROMPT_COUNT = 8;
  private static readonly FALLBACK_ROLE = 'individual_contributor';

  // Role mapping - these should correspond to translation keys
  private static readonly VALID_ROLES = [
    'manager',
    'individual_contributor',
    'designer',
    'engineer',
    'product',
    'sales',
  ];

  /**
   * Get personalized prompts for a participant based on their role
   * @param participantId UUID of the participant
   * @param sessionId UUID of the game session
   * @param count Number of prompts to return (default 4, max 8)
   * @returns Object with role and selected prompts
   */
  async getPersonalizedPrompts(
    participantId: string,
    sessionId: string,
    count?: number
  ): Promise<RoleBasedPromptsData> {
    try {
      const promptCount = Math.min(
        count ?? CoffeeRoulettePromptsService.DEFAULT_PROMPT_COUNT,
        CoffeeRoulettePromptsService.MAX_PROMPT_COUNT
      );

      // Get player's role from profile
      const role = await this.getPlayerRole(participantId);

      // Get prompts for this role
      const prompts = await this.getPromptsForRole(role, promptCount);

      return {
        role,
        prompts,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Failed to get personalized prompts: ${error}`, 500);
    }
  }

  /**
   * Get all available prompts for a specific role
   * @param role The participant's role
   * @param count Number of prompts to return (random selection)
   * @returns Array of prompt strings
   */
  async getPromptsForRole(role: string, count: number = 4): Promise<string[]> {
    try {
      // Validate and normalize role
      const normalizedRole = this.normalizeRole(role);

      // In a production system, these would be loaded from a database
      // For now, we return a base set and let the frontend i18n system handle translations
      const allPrompts = this.getPromptsForRoleType(normalizedRole);

      // Shuffle and return requested count
      return this.getRandomPrompts(allPrompts, count);
    } catch (error) {
      throw new AppError(`Failed to get prompts for role: ${error}`, 500);
    }
  }

  /**
   * Determine participant's role from their profile or participation data
   * @param participantId UUID of the participant
   * @returns Role string (one of the valid roles, or fallback)
   */
  async getPlayerRole(participantId: string): Promise<string> {
    try {
      // First, try to get role from user profile
      const participant = await queryOne(
        `SELECT p.id, u.role_in_organization
         FROM participants p
         JOIN users u ON p.member_id = u.id
         WHERE p.id = $1
         LIMIT 1`,
        [participantId]
      );

      if (!participant) {
        return CoffeeRoulettePromptsService.FALLBACK_ROLE;
      }

      const roleInOrg = participant.role_in_organization?.toLowerCase() || '';

      // Map organization roles to Coffee Roulette prompt roles
      const roleMapping: Record<string, string> = {
        manager: 'manager',
        'team lead': 'manager',
        admin: 'manager',
        director: 'manager',

        engineer: 'engineer',
        developer: 'engineer',
        'software engineer': 'engineer',
        'senior engineer': 'engineer',

        designer: 'designer',
        'product designer': 'designer',
        'ux designer': 'designer',

        'product manager': 'product',
        product: 'product',
        pm: 'product',

        'sales manager': 'sales',
        sales: 'sales',
        'account executive': 'sales',

        // Default to individual contributor
        member: 'individual_contributor',
        user: 'individual_contributor',
      };

      const mappedRole = roleMapping[roleInOrg];
      return mappedRole || CoffeeRoulettePromptsService.FALLBACK_ROLE;
    } catch (error) {
      // If there's an error, return fallback role
      console.warn(`Error determining player role: ${error}`);
      return CoffeeRoulettePromptsService.FALLBACK_ROLE;
    }
  }

  /**
   * Normalize role input to valid role
   * @param role The role to normalize
   * @returns Normalized role string
   */
  private normalizeRole(role: string): string {
    const normalized = role?.toLowerCase().trim() || CoffeeRoulettePromptsService.FALLBACK_ROLE;
    if (CoffeeRoulettePromptsService.VALID_ROLES.includes(normalized)) {
      return normalized;
    }
    return CoffeeRoulettePromptsService.FALLBACK_ROLE;
  }

  /**
   * Get all prompts for a specific role type
   * These serve as keys for i18n translation lookups
   * @param role The role type
   * @returns Array of prompt keys (will be translated by frontend)
   */
  private getPromptsForRoleType(role: string): string[] {
    const promptKeys: Record<string, string[]> = {
      manager: [
        'gamePlay.coffeeRoulette.roleBasedPrompts.manager.p1',
        'gamePlay.coffeeRoulette.roleBasedPrompts.manager.p2',
        'gamePlay.coffeeRoulette.roleBasedPrompts.manager.p3',
        'gamePlay.coffeeRoulette.roleBasedPrompts.manager.p4',
      ],
      individual_contributor: [
        'gamePlay.coffeeRoulette.roleBasedPrompts.individual_contributor.p1',
        'gamePlay.coffeeRoulette.roleBasedPrompts.individual_contributor.p2',
        'gamePlay.coffeeRoulette.roleBasedPrompts.individual_contributor.p3',
        'gamePlay.coffeeRoulette.roleBasedPrompts.individual_contributor.p4',
      ],
      designer: [
        'gamePlay.coffeeRoulette.roleBasedPrompts.designer.p1',
        'gamePlay.coffeeRoulette.roleBasedPrompts.designer.p2',
        'gamePlay.coffeeRoulette.roleBasedPrompts.designer.p3',
        'gamePlay.coffeeRoulette.roleBasedPrompts.designer.p4',
      ],
      engineer: [
        'gamePlay.coffeeRoulette.roleBasedPrompts.engineer.p1',
        'gamePlay.coffeeRoulette.roleBasedPrompts.engineer.p2',
        'gamePlay.coffeeRoulette.roleBasedPrompts.engineer.p3',
        'gamePlay.coffeeRoulette.roleBasedPrompts.engineer.p4',
      ],
      product: [
        'gamePlay.coffeeRoulette.roleBasedPrompts.product.p1',
        'gamePlay.coffeeRoulette.roleBasedPrompts.product.p2',
        'gamePlay.coffeeRoulette.roleBasedPrompts.product.p3',
        'gamePlay.coffeeRoulette.roleBasedPrompts.product.p4',
      ],
      sales: [
        'gamePlay.coffeeRoulette.roleBasedPrompts.sales.p1',
        'gamePlay.coffeeRoulette.roleBasedPrompts.sales.p2',
        'gamePlay.coffeeRoulette.roleBasedPrompts.sales.p3',
        'gamePlay.coffeeRoulette.roleBasedPrompts.sales.p4',
      ],
    };

    return promptKeys[role] || promptKeys[CoffeeRoulettePromptsService.FALLBACK_ROLE];
  }

  /**
   * Get random selection from array of prompts
   * @param prompts Array of all prompts
   * @param count Number of prompts to select
   * @returns Array of randomly selected prompts
   */
  private getRandomPrompts(prompts: string[], count: number): string[] {
    const shuffled = [...prompts].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, prompts.length));
  }

  /**
   * Get prompts for multiple participants (for group context)
   * @param participantIds Array of participant IDs
   * @param count Number of prompts per participant
   * @returns Map of participantId to their prompts
   */
  async getPromptsForMultipleParticipants(
    participantIds: string[],
    count: number = 4
  ): Promise<Map<string, RoleBasedPromptsData>> {
    try {
      const promptsMap = new Map<string, RoleBasedPromptsData>();

      for (const participantId of participantIds) {
        const prompts = await this.getPersonalizedPrompts(
          participantId,
          '',
          count
        );
        promptsMap.set(participantId, prompts);
      }

      return promptsMap;
    } catch (error) {
      throw new AppError(
        `Failed to get prompts for multiple participants: ${error}`,
        500
      );
    }
  }

  /**
   * Get a single random prompt from all available roles
   * Useful for icebreaker situations where role doesn't matter
   * @returns A single prompt key
   */
  async getRandomGenericPrompt(): Promise<string> {
    try {
      const allPromptKeys: string[] = [];
      for (const role of CoffeeRoulettePromptsService.VALID_ROLES) {
        allPromptKeys.push(...this.getPromptsForRoleType(role));
      }

      const randomIndex = Math.floor(Math.random() * allPromptKeys.length);
      return allPromptKeys[randomIndex];
    } catch (error) {
      throw new AppError(`Failed to get generic prompt: ${error}`, 500);
    }
  }
}

export default new CoffeeRoulettePromptsService();
