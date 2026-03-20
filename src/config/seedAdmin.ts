/**
 * Super-admin auto-seeding — creates the default Flowkyn admin account on startup.
 * 
 * Runs after migrations. If the account already exists, it's a no-op.
 * The admin user is created with status='active' (no email verification needed)
 * and is auto-added to the SUPER_ADMIN_EMAILS allowlist.
 * 
 * Default credentials (change password after first login!):
 *   Email:    support@flowkyn.com (or SEED_ADMIN_EMAIL env var)
 *   Password: Flowkyn2026 (or SEED_ADMIN_PASSWORD env var)
 */

import { v4 as uuid } from 'uuid';
import { queryOne } from './database';
import { hashPassword } from '../utils/hash';

interface SeedAdminConfig {
  email: string;
  password: string;
  name: string;
}

const DEFAULT_ADMIN: SeedAdminConfig = {
  email: process.env.SEED_ADMIN_EMAIL || 'support@flowkyn.com',
  password: process.env.SEED_ADMIN_PASSWORD || 'Flowkyn2026',
  name: process.env.SEED_ADMIN_NAME || 'Flowkyn Admin',
};

/**
 * Seeds the super admin user if it doesn't already exist.
 * Call this after runMigrations() in bootstrap.
 */
export async function seedSuperAdmin(): Promise<void> {
  const { email, password, name } = DEFAULT_ADMIN;

  // Check if admin already exists
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM users WHERE email = $1',
    [email]
  );

  if (existing) return;

  // Create the admin user with active status (skip email verification)
  const userId = uuid();
  const passwordHash = await hashPassword(password);

  await queryOne(
    `INSERT INTO users (id, email, password_hash, name, language, status, onboarding_completed, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'en', 'active', true, NOW(), NOW())
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [userId, email, passwordHash, name]
  );

}
