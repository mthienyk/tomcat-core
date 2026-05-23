import type { Db } from "./pgClient.js";

// Fixed lock ids — must stay stable across deploys.
export const MIGRATIONS_LOCK_KEY = 7_480_001;
export const SYNC_SCHEDULER_LOCK_KEY = 7_480_002;

export const tryAdvisoryLock = async (db: Db, key: number): Promise<boolean> => {
  const rows = await db<{ acquired: boolean }[]>`
    select pg_try_advisory_lock(${key}) as acquired
  `;
  return rows[0]?.acquired ?? false;
};

export const releaseAdvisoryLock = async (db: Db, key: number): Promise<void> => {
  await db`select pg_advisory_unlock(${key})`;
};

export const withMigrationLock = async <T>(
  db: Db,
  fn: () => Promise<T>,
): Promise<T> => {
  await db`select pg_advisory_lock(${MIGRATIONS_LOCK_KEY})`;
  try {
    return await fn();
  } finally {
    await releaseAdvisoryLock(db, MIGRATIONS_LOCK_KEY);
  }
};
