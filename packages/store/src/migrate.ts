import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";

export function defaultMigrationsDir(): string {
  return process.env.MIGRATIONS_DIR ?? path.resolve(__dirname, "..", "migrations");
}

/** Apply pending SQL migrations. Idempotent; safe to run on every deploy. */
export async function runMigrations(
  databaseUrl: string,
  folder = defaultMigrationsDir(),
): Promise<void> {
  const { sql, db } = createDb(databaseUrl);
  try {
    await migrate(db, { migrationsFolder: folder });
    console.log(JSON.stringify({ level: "info", msg: "migrations applied", folder }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL ?? "postgres://moltol:moltol@localhost:5432/moltol";
  runMigrations(url).catch((err) => {
    console.error("migration failed:", err);
    process.exit(1);
  });
}
