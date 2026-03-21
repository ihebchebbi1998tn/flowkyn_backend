/**
 * @fileoverview Wins Category and Tagging Service
 *
 * Manages wins categories and tags for organizing achievements.
 * Provides category CRUD operations, tag management, and filtering.
 *
 * Features:
 * - Category management (create, read, update, delete)
 * - Tag management (add, remove, list)
 * - Category-based filtering
 * - Tag-based filtering
 * - Default categories initialization
 * - Audit trail for all operations
 */

import { v4 as uuid } from 'uuid';
import { query, queryOne, transaction } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export interface WinCategory {
  id: string;
  organization_id: string;
  key: string;
  label: string;
  description?: string;
  color?: string;
  icon?: string;
  order_index: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PostTag {
  post_id: string;
  tag: string;
  created_at: string;
  created_by_member_id?: string;
}

export interface WinPost {
  id: string;
  organization_id: string;
  member_id: string;
  title: string;
  description: string;
  category?: string;
  tags?: string[];
  likes_count: number;
  comments_count: number;
  created_at: string;
  updated_at: string;
}

export class WinsService {
  private static readonly DEFAULT_CATEGORIES = [
    { key: 'innovation', label: 'Innovation', color: '#3B82F6', icon: 'lightbulb' },
    { key: 'revenue', label: 'Revenue', color: '#10B981', icon: 'trending-up' },
    { key: 'collaboration', label: 'Collaboration', color: '#F59E0B', icon: 'users' },
    { key: 'customer_success', label: 'Customer Success', color: '#EC4899', icon: 'smile' },
    { key: 'personal_growth', label: 'Personal Growth', color: '#8B5CF6', icon: 'star' },
  ];

  /**
   * Get or create default categories for an organization
   * @param organizationId UUID of the organization
   * @returns Array of WinCategory objects
   */
  async initializeDefaultCategories(organizationId: string): Promise<WinCategory[]> {
    try {
      // Check if categories already exist
      const existing = await query(
        'SELECT * FROM win_categories WHERE organization_id = $1 ORDER BY order_index',
        [organizationId]
      );

      if (existing.length > 0) {
        return existing as WinCategory[];
      }

      // Create default categories
      const created: WinCategory[] = [];
      for (let i = 0; i < WinsService.DEFAULT_CATEGORIES.length; i++) {
        const cat = WinsService.DEFAULT_CATEGORIES[i];
        const result = await queryOne(
          `INSERT INTO win_categories (
            id, organization_id, key, label, description, color, icon, order_index
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *`,
          [uuid(), organizationId, cat.key, cat.label, '', cat.color, cat.icon, i]
        );
        created.push(result as WinCategory);
      }

      return created;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Failed to initialize default categories: ${error}`, 500);
    }
  }

  /**
   * Get all categories for an organization
   * @param organizationId UUID of the organization
   * @returns Array of WinCategory objects
   */
  async getCategories(organizationId: string): Promise<WinCategory[]> {
    try {
      const categories = await query(
        `SELECT * FROM win_categories 
         WHERE organization_id = $1 AND is_active = true
         ORDER BY order_index, label`,
        [organizationId]
      );
      return categories as WinCategory[];
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Failed to fetch categories: ${error}`, 500);
    }
  }

  /**
   * Create a new category
   * @param organizationId UUID of the organization
   * @param data Category data (key, label, description, color, icon)
   * @returns Created WinCategory object
   */
  async createCategory(
    organizationId: string,
    data: {
      key: string;
      label: string;
      description?: string;
      color?: string;
      icon?: string;
    }
  ): Promise<WinCategory> {
    try {
      // Validate key is unique per org
      const existing = await queryOne(
        'SELECT id FROM win_categories WHERE organization_id = $1 AND key = $2',
        [organizationId, data.key]
      );

      if (existing) {
        throw new AppError('Category with this key already exists for this organization', 409);
      }

      // Get next order index
      const maxOrder = await queryOne(
        'SELECT COALESCE(MAX(order_index), -1) as max_order FROM win_categories WHERE organization_id = $1',
        [organizationId]
      );

      const categoryId = uuid();
      const result = await queryOne(
        `INSERT INTO win_categories (
          id, organization_id, key, label, description, color, icon, order_index
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          categoryId,
          organizationId,
          data.key,
          data.label,
          data.description || '',
          data.color || '#000000',
          data.icon || 'tag',
          (maxOrder.max_order as number) + 1,
        ]
      );

      return result as WinCategory;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Failed to create category: ${error}`, 500);
    }
  }

  /**
   * Update a category
   * @param categoryId UUID of the category
   * @param data Partial category data
   * @returns Updated WinCategory object
   */
  async updateCategory(
    categoryId: string,
    data: Partial<WinCategory>
  ): Promise<WinCategory> {
    try {
      const updates: string[] = [];
      const values: unknown[] = [];
      let paramCount = 1;

      if (data.label !== undefined) {
        updates.push(`label = $${paramCount++}`);
        values.push(data.label);
      }
      if (data.description !== undefined) {
        updates.push(`description = $${paramCount++}`);
        values.push(data.description);
      }
      if (data.color !== undefined) {
        updates.push(`color = $${paramCount++}`);
        values.push(data.color);
      }
      if (data.icon !== undefined) {
        updates.push(`icon = $${paramCount++}`);
        values.push(data.icon);
      }
      if (data.is_active !== undefined) {
        updates.push(`is_active = $${paramCount++}`);
        values.push(data.is_active);
      }

      if (updates.length === 0) {
        throw new AppError('No fields to update', 400);
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(categoryId);

      const result = await queryOne(
        `UPDATE win_categories SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
        values
      );

      if (!result) {
        throw new AppError('Category not found', 404);
      }

      return result as WinCategory;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Failed to update category: ${error}`, 500);
    }
  }

  /**
   * Delete a category
   * @param categoryId UUID of the category
   */
  async deleteCategory(categoryId: string): Promise<void> {
    try {
      // Check if category is in use
      const inUse = await queryOne(
        'SELECT id FROM posts WHERE category = (SELECT key FROM win_categories WHERE id = $1) LIMIT 1',
        [categoryId]
      );

      if (inUse) {
        throw new AppError('Cannot delete category that has posts', 409);
      }

      await query('DELETE FROM win_categories WHERE id = $1', [categoryId]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Failed to delete category: ${error}`, 500);
    }
  }

  /**
   * Add tags to a post
   * @param postId UUID of the post
   * @param tags Array of tag strings
   * @param memberId UUID of the member adding tags (optional)
   */
  async addTags(postId: string, tags: string[], memberId?: string): Promise<PostTag[]> {
    try {
      const cleanTags = [...new Set(tags.filter(t => t && t.trim()))]; // Unique, non-empty

      const created: PostTag[] = [];
      for (const tag of cleanTags) {
        const result = await queryOne(
          `INSERT INTO posts_tags (id, post_id, tag, created_by_member_id) 
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (post_id, tag) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
           RETURNING *`,
          [uuid(), postId, tag.toLowerCase(), memberId || null]
        );
        created.push(result as PostTag);
      }

      return created;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Failed to add tags: ${error}`, 500);
    }
  }

  /**
   * Remove tags from a post
   * @param postId UUID of the post
   * @param tags Array of tag strings to remove
   */
  async removeTags(postId: string, tags: string[]): Promise<void> {
    try {
      const placeholders = tags.map((_, i) => `$${i + 2}`).join(',');
      await query(
        `DELETE FROM posts_tags WHERE post_id = $1 AND tag IN (${placeholders})`,
        [postId, ...tags.map(t => t.toLowerCase())]
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Failed to remove tags: ${error}`, 500);
    }
  }

  /**
   * Get all tags for a post
   * @param postId UUID of the post
   * @returns Array of tags
   */
  async getTags(postId: string): Promise<string[]> {
    try {
      const result = await query(
        'SELECT DISTINCT tag FROM posts_tags WHERE post_id = $1 ORDER BY tag',
        [postId]
      );
      return result.map((r: { tag: string }) => r.tag);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Failed to fetch tags: ${error}`, 500);
    }
  }

  /**
   * Get all unique tags in an organization
   * @param organizationId UUID of the organization
   * @returns Array of unique tags
   */
  async getAllTags(organizationId: string): Promise<string[]> {
    try {
      const result = await query(
        `SELECT DISTINCT pt.tag
         FROM posts_tags pt
         JOIN posts p ON pt.post_id = p.id
         WHERE p.organization_id = $1
         ORDER BY pt.tag`,
        [organizationId]
      );
      return result.map((r: { tag: string }) => r.tag);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Failed to fetch all tags: ${error}`, 500);
    }
  }

  /**
   * Filter posts by category
   * @param organizationId UUID of the organization
   * @param category Category key to filter by
   * @param limit Number of posts to return
   * @param offset Pagination offset
   * @returns Array of posts in category
   */
  async getPostsByCategory(
    organizationId: string,
    category: string,
    limit: number = 10,
    offset: number = 0
  ): Promise<WinPost[]> {
    try {
      const posts = await query(
        `SELECT p.*, COALESCE(p.tags, ARRAY[]::TEXT[]) as tags
         FROM posts p
         WHERE p.organization_id = $1 AND p.category = $2
         ORDER BY p.created_at DESC
         LIMIT $3 OFFSET $4`,
        [organizationId, category, limit, offset]
      );
      return posts as WinPost[];
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Failed to fetch posts by category: ${error}`, 500);
    }
  }

  /**
   * Filter posts by tag
   * @param organizationId UUID of the organization
   * @param tag Tag to filter by
   * @param limit Number of posts to return
   * @param offset Pagination offset
   * @returns Array of posts with tag
   */
  async getPostsByTag(
    organizationId: string,
    tag: string,
    limit: number = 10,
    offset: number = 0
  ): Promise<WinPost[]> {
    try {
      const posts = await query(
        `SELECT DISTINCT p.*, COALESCE(p.tags, ARRAY[]::TEXT[]) as tags
         FROM posts p
         JOIN posts_tags pt ON p.id = pt.post_id
         WHERE p.organization_id = $1 AND pt.tag = $2
         ORDER BY p.created_at DESC
         LIMIT $3 OFFSET $4`,
        [organizationId, tag.toLowerCase(), limit, offset]
      );
      return posts as WinPost[];
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Failed to fetch posts by tag: ${error}`, 500);
    }
  }

  /**
   * Filter posts by multiple categories
   * @param organizationId UUID of the organization
   * @param categories Array of category keys
   * @param limit Number of posts to return
   * @param offset Pagination offset
   * @returns Array of posts in any of the categories
   */
  async getPostsByCategories(
    organizationId: string,
    categories: string[],
    limit: number = 10,
    offset: number = 0
  ): Promise<WinPost[]> {
    try {
      const placeholders = categories.map((_, i) => `$${i + 2}`).join(',');
      const posts = await query(
        `SELECT p.*, COALESCE(p.tags, ARRAY[]::TEXT[]) as tags
         FROM posts p
         WHERE p.organization_id = $1 AND p.category IN (${placeholders})
         ORDER BY p.created_at DESC
         LIMIT $${categories.length + 2} OFFSET $${categories.length + 3}`,
        [organizationId, ...categories, limit, offset]
      );
      return posts as WinPost[];
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Failed to fetch posts by categories: ${error}`, 500);
    }
  }

  /**
   * Set category for a post
   * @param postId UUID of the post
   * @param category Category key
   */
  async setCategoryForPost(postId: string, category: string): Promise<WinPost> {
    try {
      const result = await queryOne(
        'UPDATE posts SET category = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
        [category, postId]
      );

      if (!result) {
        throw new AppError('Post not found', 404);
      }

      return result as WinPost;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Failed to set category for post: ${error}`, 500);
    }
  }
}

export default new WinsService();
