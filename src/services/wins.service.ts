/**
 * @fileoverview Wins Tag and Category Service
 *
 * Manages tags and categories for activity posts.
 * Provides simplified tag management and filtering.
 *
 * Features:
 * - Tag management (add, remove, list)
 * - Simple category management on posts
 * - Post filtering by tags and categories
 */

import { v4 as uuid } from 'uuid';
import { query, queryOne } from '../config/database';
import { AppError } from '../middleware/errorHandler';

/**
 * Simple category object used in posts
 */
export interface SimpleCategory {
  name: string;
  color: string;
}

/**
 * Tag entry for a post
 */
export interface PostTag {
  post_id: string;
  tag: string;
  created_at: string;
  created_by_member_id?: string;
}

/**
 * Activity post with tags and category support
 */
export interface ActivityPost {
  id: string;
  event_id: string;
  author_participant_id: string;
  content: string;
  category?: SimpleCategory;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

export class WinsService {
  /**
   * Add tags to a post
   * @param postId UUID of the post
   * @param tags Array of tag strings
   * @param memberId UUID of the member adding tags (optional)
   */
  async addTags(postId: string, tags: string[], memberId?: string): Promise<void> {
    try {
      const cleanTags = [...new Set(tags.filter(t => t && t.trim()))]; // Unique, non-empty

      for (const tag of cleanTags) {
        await queryOne(
          `INSERT INTO posts_tags (id, post_id, tag, created_by_member_id) 
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (post_id, tag) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
           RETURNING *`,
          [uuid(), postId, tag.toLowerCase(), memberId || null]
        );
      }
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
      if (tags.length === 0) return;

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
   * Get all unique tags for posts in an event
   * @param eventId UUID of the event
   * @returns Array of unique tags
   */
  async getAllTags(eventId: string): Promise<string[]> {
    try {
      const result = await query(
        `SELECT DISTINCT pt.tag
         FROM posts_tags pt
         JOIN activity_posts p ON pt.post_id = p.id
         WHERE p.event_id = $1
         ORDER BY pt.tag`,
        [eventId]
      );
      return result.map((r: { tag: string }) => r.tag);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Failed to fetch all tags: ${error}`, 500);
    }
  }

  /**
   * Get posts filtered by tags
   * @param eventId UUID of the event
   * @param tags Array of tags to filter by
   * @param limit Number of posts to return
   * @param offset Pagination offset
   * @returns Array of posts with at least one of the specified tags
   */
  async getPostsByTags(
    eventId: string,
    tags: string[],
    limit: number = 10,
    offset: number = 0
  ): Promise<ActivityPost[]> {
    try {
      if (tags.length === 0) {
        return [];
      }

      const placeholders = tags.map((_, i) => `$${i + 2}`).join(',');
      const posts = await query(
        `SELECT DISTINCT p.id, p.event_id, p.author_participant_id, p.content, 
                p.category, p.tags, p.created_at, p.updated_at
         FROM activity_posts p
         JOIN posts_tags pt ON p.id = pt.post_id
         WHERE p.event_id = $1 AND pt.tag IN (${placeholders})
         ORDER BY p.created_at DESC
         LIMIT $${tags.length + 2} OFFSET $${tags.length + 3}`,
        [eventId, ...tags.map(t => t.toLowerCase()), limit, offset]
      );
      return posts as ActivityPost[];
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Failed to fetch posts by tags: ${error}`, 500);
    }
  }

  /**
   * Update post's category
   * @param postId UUID of the post
   * @param category Category name and color, or null to remove
   */
  async setPostCategory(
    postId: string,
    category: SimpleCategory | null
  ): Promise<ActivityPost> {
    try {
      const result = await queryOne(
        `UPDATE activity_posts 
         SET category = $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2 
         RETURNING *`,
        [category ? JSON.stringify(category) : null, postId]
      );

      if (!result) {
        throw new AppError('Post not found', 404);
      }

      return result as ActivityPost;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Failed to set post category: ${error}`, 500);
    }
  }

  /**
   * Get all unique categories used in an event
   * @param eventId UUID of the event
   * @returns Array of unique categories used
   */
  async getUsedCategories(eventId: string): Promise<SimpleCategory[]> {
    try {
      const result = await query(
        `SELECT DISTINCT category
         FROM activity_posts
         WHERE event_id = $1 AND category IS NOT NULL
         ORDER BY category->>'name'`,
        [eventId]
      );
      return result
        .map((r: { category: string | SimpleCategory }) => {
          if (typeof r.category === 'string') {
            return JSON.parse(r.category);
          }
          return r.category;
        })
        .filter((cat: SimpleCategory) => cat && cat.name);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Failed to fetch used categories: ${error}`, 500);
    }
  }

  /**
   * Get posts filtered by category
   * @param eventId UUID of the event
   * @param categoryName Name of the category to filter by
   * @param limit Number of posts to return
   * @param offset Pagination offset
   * @returns Array of posts in the specified category
   */
  async getPostsByCategory(
    eventId: string,
    categoryName: string,
    limit: number = 10,
    offset: number = 0
  ): Promise<ActivityPost[]> {
    try {
      const posts = await query(
        `SELECT *
         FROM activity_posts
         WHERE event_id = $1 AND category->>'name' = $2
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`,
        [eventId, categoryName, limit, offset]
      );
      return posts as ActivityPost[];
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Failed to fetch posts by category: ${error}`, 500);
    }
  }
}

export default new WinsService();
