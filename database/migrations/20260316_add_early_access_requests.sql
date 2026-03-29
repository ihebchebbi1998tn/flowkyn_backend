-- Add early_access_requests table to store landing page early-access signups
-- Date: 2026-03-16

CREATE TABLE IF NOT EXISTS early_access_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  company_name VARCHAR(255),
  ip_address VARCHAR(45),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_early_access_requests_email ON early_access_requests(email);
CREATE INDEX IF NOT EXISTS idx_early_access_requests_created ON early_access_requests(created_at);

