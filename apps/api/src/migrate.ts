import { runMigrations } from "@moltol/store";

const url = process.env.DATABASE_URL ?? "postgres://moltol:moltol@localhost:5432/moltol";

runMigrations(url).catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});
