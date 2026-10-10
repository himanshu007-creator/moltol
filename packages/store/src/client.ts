import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Sql = ReturnType<typeof postgres>;
export type Db = PostgresJsDatabase<typeof schema>;

export function createDb(databaseUrl: string): { sql: Sql; db: Db } {
  const sql = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema });
  return { sql, db };
}
