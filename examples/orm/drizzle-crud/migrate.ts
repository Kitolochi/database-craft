import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  // Use a separate connection for migrations (max 1 connection)
  const migrationClient = postgres(connectionString, { max: 1 });
  const db = drizzle(migrationClient);

  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");

  await migrationClient.end();
}

runMigrations().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
