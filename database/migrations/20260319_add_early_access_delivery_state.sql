-- Track provisioning + credential email delivery state for early access requests
-- Date: 2026-03-19

ALTER TABLE early_access_requests
  ADD COLUMN IF NOT EXISTS provisioned_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE early_access_requests
  ADD COLUMN IF NOT EXISTS account_provisioned_at TIMESTAMP;
ALTER TABLE early_access_requests
  ADD COLUMN IF NOT EXISTS credentials_email_sent_at TIMESTAMP;
ALTER TABLE early_access_requests
  ADD COLUMN IF NOT EXISTS last_email_error TEXT;
ALTER TABLE early_access_requests
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_early_access_requests_provisioned_user
  ON early_access_requests(provisioned_user_id);
CREATE INDEX IF NOT EXISTS idx_early_access_requests_account_provisioned
  ON early_access_requests(account_provisioned_at);
CREATE INDEX IF NOT EXISTS idx_early_access_requests_email_sent
  ON early_access_requests(credentials_email_sent_at);
