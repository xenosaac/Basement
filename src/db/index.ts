import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const connectionString =
  process.env.POSTGRES_URL ?? process.env.DATABASE_URL;

const isProduction = connectionString?.includes("vercel-storage.com") ||
  connectionString?.includes("neon.tech") ||
  connectionString?.includes("supabase.co");

const globalForDb = globalThis as unknown as { pool: pg.Pool };

if (!globalForDb.pool) {
  globalForDb.pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    ssl: isProduction ? { rejectUnauthorized: false } : undefined,
  });
}

export const pool = globalForDb.pool;
export const db = drizzle(pool, { schema });
