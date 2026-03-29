/**
 * @fileoverview Cached column-existence checks for graceful handling of
 * not-yet-applied migrations. Avoids crashes when code references columns
 * that haven't been added to the production schema.
 */
import { queryOne } from '../config/database';

const _cache = new Map<string, boolean>();

/**
 * Check whether a column exists on a table (result is cached for the process lifetime).
 */
export async function hasColumn(table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  if (_cache.has(key)) return _cache.get(key)!;

  try {
    const row = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
       ) AS exists`,
      [table, column],
    );
    const exists = row?.exists ?? false;
    _cache.set(key, exists);
    return exists;
  } catch {
    _cache.set(key, false);
    return false;
  }
}

/** Shorthand: does the `participants` table have `guest_identity_key`? */
export async function hasGuestIdentityKey(): Promise<boolean> {
  return hasColumn('participants', 'guest_identity_key');
}
