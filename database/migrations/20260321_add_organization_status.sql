-- Add organization status field
-- Status values: 'test' (for testing), 'real' (production), 'inactive' (disabled), 'banned' (blocked)

ALTER TABLE organizations
ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'real';

-- Add constraint to ensure valid status values
ALTER TABLE organizations
ADD CONSTRAINT check_org_status CHECK (status IN ('test', 'real', 'inactive', 'banned'));

-- Create index for faster status queries (useful for filtering)
CREATE INDEX idx_organizations_status ON organizations(status);

-- Add audit log for tracking when this was added
COMMENT ON COLUMN organizations.status IS 'Organization status: test (testing), real (production), inactive (disabled), banned (blocked)';
