/**
 * Migration: Add Wins Categories and Tags Support
 * Date: 2026-03-22
 * 
 * Purpose:
 * - Add category support to posts table (wins/achievements)
 * - Add tags support via junction table
 * - Enable filtering by category and tags
 * - Maintain backward compatibility
 */

-- Step 1: Add category column to activity_posts table
ALTER TABLE activity_posts ADD COLUMN category VARCHAR(50) DEFAULT 'general';

-- Add comment explaining the category
COMMENT ON COLUMN activity_posts.category IS 'Post category: innovation, revenue, collaboration, customer_success, personal_growth, general';

-- Step 2: Create posts_tags junction table
CREATE TABLE posts_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES activity_posts(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Prevent duplicate tags on same post
  UNIQUE(post_id, tag)
);

-- Create indexes for performance
CREATE INDEX idx_posts_tags_post_id ON posts_tags(post_id);
CREATE INDEX idx_posts_tags_tag ON posts_tags(tag);

-- Step 3: Create categories reference table (for future use)
CREATE TABLE win_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key VARCHAR(50) NOT NULL,
  label VARCHAR(255) NOT NULL,
  description TEXT,
  color VARCHAR(20),
  icon VARCHAR(50),
  order_index INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Unique category per org
  UNIQUE(organization_id, key)
);

-- Create indexes
CREATE INDEX idx_win_categories_org_id ON win_categories(organization_id);
CREATE INDEX idx_win_categories_key ON win_categories(key);

-- Step 4: Add indexes to activity_posts table for category queries
CREATE INDEX idx_activity_posts_category ON activity_posts(category);
CREATE INDEX idx_activity_posts_category_event_id ON activity_posts(event_id, category);

-- Step 5: Add column to track tags for activity_posts
ALTER TABLE activity_posts ADD COLUMN tags TEXT[];

-- Add comment
COMMENT ON COLUMN activity_posts.tags IS 'Array of tags associated with this post (denormalized for performance)';

-- Create index for tag searches
CREATE INDEX idx_activity_posts_tags_gin ON activity_posts USING GIN(tags);

-- Step 6: Create default categories for existing organizations (optional migration)
-- This is handled by the application layer on first use

-- Step 7: Add created_by column to posts_tags if not exists (for audit trail)
ALTER TABLE posts_tags ADD COLUMN created_by_member_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Step 8: Create function to update activity_posts.tags when posts_tags changes
CREATE OR REPLACE FUNCTION update_posts_tags_array()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE activity_posts SET tags = (
      SELECT ARRAY_AGG(tag) FROM posts_tags WHERE post_id = NEW.post_id
    ) WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE activity_posts SET tags = (
      SELECT ARRAY_AGG(tag) FROM posts_tags WHERE post_id = OLD.post_id
    ) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to keep posts.tags in sync
CREATE TRIGGER trigger_update_posts_tags
AFTER INSERT OR DELETE ON posts_tags
FOR EACH ROW
EXECUTE FUNCTION update_posts_tags_array();

-- Step 9: Add view for easy queries
CREATE OR REPLACE VIEW v_posts_with_tags AS
SELECT 
  p.*,
  COALESCE(ARRAY_AGG(pt.tag) FILTER (WHERE pt.tag IS NOT NULL), ARRAY[]::TEXT[]) as post_tags
FROM activity_posts p
LEFT JOIN posts_tags pt ON p.id = pt.post_id
GROUP BY p.id;

-- Sample data for categories (will be populated by app)
-- INSERT INTO win_categories (organization_id, key, label, description, color, icon) VALUES
-- (org_id, 'innovation', 'Innovation', 'New ideas and creative solutions', '#3B82F6', 'lightbulb'),
-- (org_id, 'revenue', 'Revenue', 'Revenue growth and business impact', '#10B981', 'trending-up'),
-- (org_id, 'collaboration', 'Collaboration', 'Team collaboration and partnerships', '#F59E0B', 'users'),
-- (org_id, 'customer_success', 'Customer Success', 'Happy customers and positive feedback', '#EC4899', 'smile'),
-- (org_id, 'personal_growth', 'Personal Growth', 'Learning and professional development', '#8B5CF6', 'star');
