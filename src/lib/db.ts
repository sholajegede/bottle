import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * A small database layer over Postgres.
 *
 * In production DATABASE_URL points at any Postgres (Neon works on its free tier).
 * With no DATABASE_URL, Bottle runs an in-process Postgres (PGlite) and keeps its data in ~/.bottle/pg (outside the project, so the dev server does not see the files change),
 * so `npm run dev` and the tests need no setup.
 */
export type Row = Record<string, unknown>;

export interface Queryable {
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  /** Run fn in one transaction. It commits when fn returns and rolls back when fn throws. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const schema = () => readFileSync(join(process.cwd(), "db", "schema.sql"), "utf8");

async function connectPg(url: string): Promise<Db> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url, max: 5 });
  return {
    async query<T extends Row>(text: string, params: unknown[] = []) {
      return (await pool.query(text, params)).rows as T[];
    },
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          async query<R extends Row>(text: string, params: unknown[] = []) {
            return (await client.query(text, params)).rows as R[];
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function connectLocal(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite(dataDir);
  await pg.exec(schema());
  return {
    async query<T extends Row>(text: string, params: unknown[] = []) {
      return (await pg.query(text, params)).rows as T[];
    },
    tx<T>(fn: (q: Queryable) => Promise<T>) {
      return pg.transaction((tx) =>
        fn({
          async query<R extends Row>(text: string, params: unknown[] = []) {
            return (await tx.query(text, params)).rows as R[];
          },
        }),
      ) as Promise<T>;
    },
    close: () => pg.close(),
  };
}

const holder = globalThis as unknown as { __bottleDb?: Promise<Db> };

export function db(): Promise<Db> {
  if (!holder.__bottleDb) {
    const url = process.env.DATABASE_URL;
    if (!url && process.env.NODE_ENV === "production") {
      throw new Error("DATABASE_URL is not set.");
    }
    holder.__bottleDb = url ? connectPg(url) : connectLocal(process.env.BOTTLE_DATA_DIR ?? join(homedir(), ".bottle", "pg"));
    holder.__bottleDb.catch(() => (holder.__bottleDb = undefined));
  }
  return holder.__bottleDb;
}

/** Apply db/schema.sql to the database in DATABASE_URL. */
export async function migrate(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL first.");
  const { Client } = await import("pg");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(schema());
  } finally {
    await client.end();
  }
}
