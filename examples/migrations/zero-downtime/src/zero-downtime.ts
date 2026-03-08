/**
 * ZERO-DOWNTIME MIGRATIONS (Expand-Contract Pattern)
 *
 * Traditional migrations (rename column, drop table) take locks that
 * block reads/writes. In production with live traffic, this means
 * downtime. The expand-contract pattern avoids this by splitting
 * dangerous changes into small, safe steps:
 *
 *   1. EXPAND  — add new structure alongside old (non-breaking)
 *   2. MIGRATE — backfill data from old to new
 *   3. DEPLOY  — update application to use new structure
 *   4. CONTRACT — remove old structure (cleanup)
 *
 * Each step is a separate migration that can be deployed independently.
 * If anything goes wrong, each step has a rollback.
 *
 * This example demonstrates two common scenarios:
 *   A) Renaming a column (email → contact_email)
 *   B) Splitting a table (users.address → addresses table)
 *
 * ─── Why Each Step is Safe ────────────────────────────────
 *
 * - ADD COLUMN: Postgres adds columns without rewriting the table.
 *   No lock on reads/writes. Instant for any table size.
 *
 * - BACKFILL: Uses batched UPDATE to avoid long transactions.
 *   Reads and writes continue normally during backfill.
 *
 * - DUAL-WRITE: Application writes to both old and new columns.
 *   Old code still works (reads old column). New code reads new column.
 *
 * - DROP COLUMN: Only after ALL application servers are updated.
 *   No code references the old column anymore.
 *
 * ─── Dangerous Operations to NEVER Do in One Step ─────────
 *
 *   -- NEVER: rename column directly (rewrites table, locks it)
 *   ALTER TABLE users RENAME COLUMN email TO contact_email;
 *
 *   -- NEVER: add NOT NULL without default (scans whole table)
 *   ALTER TABLE users ADD COLUMN age INT NOT NULL;
 *
 *   -- NEVER: change column type directly (rewrites table)
 *   ALTER TABLE users ALTER COLUMN id TYPE bigint;
 *
 *   -- INSTEAD: use expand-contract for all of these
 */

// ─── Migration Framework (simplified) ─────────────────────

interface Migration {
  version: number;
  name: string;
  up: () => void;
  down: () => void;
}

interface MigrationLog {
  version: number;
  name: string;
  appliedAt: Date;
  status: "applied" | "rolled_back";
}

const migrationLog: MigrationLog[] = [];

function runMigration(migration: Migration): void {
  console.log(`  ▸ Running migration ${migration.version}: ${migration.name}`);
  migration.up();
  migrationLog.push({
    version: migration.version,
    name: migration.name,
    appliedAt: new Date(),
    status: "applied",
  });
}

function rollbackMigration(migration: Migration): void {
  console.log(`  ◂ Rolling back migration ${migration.version}: ${migration.name}`);
  migration.down();
  const entry = migrationLog.find((m) => m.version === migration.version);
  if (entry) entry.status = "rolled_back";
}

// ─── In-Memory Database State ─────────────────────────────

interface TableSchema {
  columns: string[];
}

interface Row {
  [column: string]: unknown;
}

const tables: Record<string, { schema: TableSchema; rows: Row[] }> = {};

function createTable(name: string, columns: string[]): void {
  tables[name] = { schema: { columns }, rows: [] };
}

function addColumn(table: string, column: string, defaultValue?: unknown): void {
  // SQL: ALTER TABLE {table} ADD COLUMN {column} {type} [DEFAULT {value}];
  // This is safe — Postgres doesn't rewrite the table for nullable columns.
  tables[table].schema.columns.push(column);
  if (defaultValue !== undefined) {
    for (const row of tables[table].rows) {
      row[column] = defaultValue;
    }
  }
}

function dropColumn(table: string, column: string): void {
  // SQL: ALTER TABLE {table} DROP COLUMN {column};
  // Safe only AFTER all application code stops referencing the column.
  tables[table].schema.columns = tables[table].schema.columns.filter((c) => c !== column);
  for (const row of tables[table].rows) {
    delete row[column];
  }
}

function insertRow(table: string, row: Row): void {
  tables[table].rows.push({ ...row });
}

function getRows(table: string): Row[] {
  return tables[table]?.rows ?? [];
}

function printTable(name: string): void {
  const table = tables[name];
  if (!table) {
    console.log(`  Table "${name}" does not exist`);
    return;
  }
  console.log(`  Table: ${name}`);
  console.log(`  Columns: [${table.schema.columns.join(", ")}]`);
  for (const row of table.rows) {
    const values = table.schema.columns.map((c) => `${c}=${JSON.stringify(row[c] ?? null)}`);
    console.log(`    { ${values.join(", ")} }`);
  }
}

// ═══════════════════════════════════════════════════════════
// SCENARIO A: Renaming a Column (email → contact_email)
// ═══════════════════════════════════════════════════════════
//
// A direct ALTER TABLE ... RENAME COLUMN takes an ACCESS EXCLUSIVE
// lock in Postgres, blocking ALL reads and writes. For a table with
// millions of rows, this can mean seconds or minutes of downtime.
//
// Expand-contract approach:
//   Step 1: Add contact_email column (instant, no lock)
//   Step 2: Backfill contact_email from email (batched, no lock)
//   Step 3: App dual-writes both columns, reads from contact_email
//   Step 4: Drop email column (after all servers deploy step 3)

const renameColumnMigrations: Migration[] = [
  {
    version: 1,
    name: "add_contact_email_column",
    up() {
      // SQL: ALTER TABLE users ADD COLUMN contact_email VARCHAR(255);
      // Safe: nullable column add is instant, no table rewrite.
      addColumn("users", "contact_email", null);
      console.log("    Added nullable contact_email column");
      console.log("    -- SQL: ALTER TABLE users ADD COLUMN contact_email VARCHAR(255);");
    },
    down() {
      dropColumn("users", "contact_email");
      console.log("    Dropped contact_email column");
    },
  },
  {
    version: 2,
    name: "backfill_contact_email",
    up() {
      // SQL (batched to avoid long transactions):
      //   UPDATE users SET contact_email = email
      //   WHERE contact_email IS NULL
      //   AND id BETWEEN $start AND $end;
      //
      // Why batched? A single UPDATE on 10M rows holds a lock for
      // the entire transaction. Batching in chunks of 1000-10000
      // keeps each transaction short.
      const rows = getRows("users");
      let backfilled = 0;
      for (const row of rows) {
        if (row.contact_email === null) {
          row.contact_email = row.email;
          backfilled++;
        }
      }
      console.log(`    Backfilled ${backfilled} rows: email → contact_email`);
      console.log("    -- SQL: UPDATE users SET contact_email = email");
      console.log("    --      WHERE contact_email IS NULL AND id BETWEEN $start AND $end;");
    },
    down() {
      // Backfill is idempotent — rollback just nulls the column
      const rows = getRows("users");
      for (const row of rows) {
        row.contact_email = null;
      }
      console.log("    Nulled out contact_email values");
    },
  },
  {
    version: 3,
    name: "switch_reads_to_contact_email",
    up() {
      // This is an APPLICATION change, not a schema change.
      // Deploy code that:
      //   - Reads from contact_email (with fallback to email)
      //   - Writes to BOTH email AND contact_email
      //
      // SQL (application queries change):
      //   SELECT COALESCE(contact_email, email) AS email FROM users;
      //   UPDATE users SET email = $1, contact_email = $1 WHERE id = $2;
      console.log("    [APP DEPLOY] Reads: contact_email (fallback: email)");
      console.log("    [APP DEPLOY] Writes: dual-write to both columns");
      console.log("    -- Wait for ALL application servers to deploy this version");
    },
    down() {
      console.log("    [APP ROLLBACK] Revert to reading from email column");
    },
  },
  {
    version: 4,
    name: "drop_old_email_column",
    up() {
      // SQL: ALTER TABLE users DROP COLUMN email;
      // Safe ONLY because:
      //   - All app servers now read from contact_email
      //   - No code references the old email column
      //   - Backfill confirmed all data is copied
      dropColumn("users", "email");
      console.log("    Dropped old email column");
      console.log("    -- SQL: ALTER TABLE users DROP COLUMN email;");
      console.log("    -- ONLY safe after all servers deploy step 3");
    },
    down() {
      // To rollback a column drop, re-add and backfill from the new column
      addColumn("users", "email", null);
      const rows = getRows("users");
      for (const row of rows) {
        row.email = row.contact_email;
      }
      console.log("    Re-added email column and backfilled from contact_email");
    },
  },
];

// ═══════════════════════════════════════════════════════════
// SCENARIO B: Splitting a Table (users.address → addresses)
// ═══════════════════════════════════════════════════════════
//
// Moving a column to a new table (normalization) can't be done
// atomically. The expand-contract approach:
//   Step 1: Create addresses table with FK to users
//   Step 2: Backfill addresses from users.address
//   Step 3: App reads/writes addresses table, still writes users.address
//   Step 4: Drop users.address column

const splitTableMigrations: Migration[] = [
  {
    version: 5,
    name: "create_addresses_table",
    up() {
      // SQL: CREATE TABLE addresses (
      //        id SERIAL PRIMARY KEY,
      //        user_id INT NOT NULL REFERENCES users(id),
      //        street TEXT,
      //        city TEXT,
      //        state TEXT,
      //        zip TEXT
      //      );
      //      CREATE INDEX idx_addresses_user_id ON addresses(user_id);
      createTable("addresses", ["id", "user_id", "street", "city", "state", "zip"]);
      console.log("    Created addresses table with FK to users");
      console.log("    -- SQL: CREATE TABLE addresses (...)");
      console.log("    -- SQL: CREATE INDEX idx_addresses_user_id ON addresses(user_id);");
    },
    down() {
      delete tables["addresses"];
      console.log("    Dropped addresses table");
    },
  },
  {
    version: 6,
    name: "backfill_addresses_from_users",
    up() {
      // SQL (batched):
      //   INSERT INTO addresses (user_id, street, city, state, zip)
      //   SELECT id, address, city, state, zip FROM users
      //   WHERE id BETWEEN $start AND $end
      //   AND NOT EXISTS (SELECT 1 FROM addresses WHERE user_id = users.id);
      const users = getRows("users");
      let backfilled = 0;
      let nextAddressId = 1;

      for (const user of users) {
        if (user.address) {
          insertRow("addresses", {
            id: nextAddressId++,
            user_id: user.id,
            street: user.address,
            city: user.city ?? null,
            state: user.state ?? null,
            zip: user.zip ?? null,
          });
          backfilled++;
        }
      }

      console.log(`    Backfilled ${backfilled} address rows from users table`);
      console.log("    -- SQL: INSERT INTO addresses SELECT ... FROM users WHERE ...;");
    },
    down() {
      tables["addresses"].rows = [];
      console.log("    Truncated addresses table");
    },
  },
  {
    version: 7,
    name: "switch_reads_to_addresses_table",
    up() {
      // APPLICATION change — deploy code that:
      //   - Reads address from addresses table (JOIN or separate query)
      //   - Writes to BOTH users.address AND addresses table
      //   - Handles the case where addresses row doesn't exist yet
      //
      // SQL (new read query):
      //   SELECT u.*, a.street, a.city, a.state, a.zip
      //   FROM users u
      //   LEFT JOIN addresses a ON a.user_id = u.id;
      //
      // SQL (new write — dual-write):
      //   UPDATE users SET address = $1 WHERE id = $2;
      //   INSERT INTO addresses (user_id, street) VALUES ($2, $1)
      //   ON CONFLICT (user_id) DO UPDATE SET street = $1;
      console.log("    [APP DEPLOY] Reads: JOIN addresses table");
      console.log("    [APP DEPLOY] Writes: dual-write to users.address AND addresses");
      console.log("    -- Wait for ALL servers to deploy before next step");
    },
    down() {
      console.log("    [APP ROLLBACK] Revert to reading users.address directly");
    },
  },
  {
    version: 8,
    name: "drop_address_columns_from_users",
    up() {
      // SQL: ALTER TABLE users DROP COLUMN address;
      //      ALTER TABLE users DROP COLUMN city;
      //      ALTER TABLE users DROP COLUMN state;
      //      ALTER TABLE users DROP COLUMN zip;
      // Safe: all app servers read from addresses table now.
      dropColumn("users", "address");
      dropColumn("users", "city");
      dropColumn("users", "state");
      dropColumn("users", "zip");
      console.log("    Dropped address, city, state, zip from users");
      console.log("    -- SQL: ALTER TABLE users DROP COLUMN address;");
      console.log("    -- SQL: ALTER TABLE users DROP COLUMN city;");
      console.log("    -- ONLY safe after all servers deploy step 7");
    },
    down() {
      // Re-add columns and backfill from addresses table
      addColumn("users", "address", null);
      addColumn("users", "city", null);
      addColumn("users", "state", null);
      addColumn("users", "zip", null);

      const users = getRows("users");
      const addresses = getRows("addresses");
      for (const user of users) {
        const addr = addresses.find((a) => a.user_id === user.id);
        if (addr) {
          user.address = addr.street;
          user.city = addr.city;
          user.state = addr.state;
          user.zip = addr.zip;
        }
      }
      console.log("    Re-added address columns and backfilled from addresses table");
    },
  },
];

// ─── DEMO ─────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║    Zero-Downtime Migrations          ║");
  console.log("║    (Expand-Contract Pattern)         ║");
  console.log("╚══════════════════════════════════════╝\n");

  // ── Setup: initial schema and data ────────────────────
  createTable("users", ["id", "name", "email", "address", "city", "state", "zip"]);
  insertRow("users", { id: 1, name: "Alice", email: "alice@co.com", address: "123 Main St", city: "Portland", state: "OR", zip: "97201" });
  insertRow("users", { id: 2, name: "Bob", email: "bob@co.com", address: "456 Oak Ave", city: "Seattle", state: "WA", zip: "98101" });
  insertRow("users", { id: 3, name: "Carol", email: "carol@co.com", address: null, city: null, state: null, zip: null });

  console.log("Initial state:");
  printTable("users");

  // ═══════════════════════════════════════════════════════
  // Scenario A: Rename email → contact_email
  // ═══════════════════════════════════════════════════════

  console.log("\n══════════════════════════════════════");
  console.log("SCENARIO A: Rename column (email → contact_email)");
  console.log("══════════════════════════════════════\n");

  console.log("Step 1: EXPAND — add new column\n");
  runMigration(renameColumnMigrations[0]);
  console.log("\n  State after step 1:");
  printTable("users");

  console.log("\n\nStep 2: MIGRATE — backfill data\n");
  runMigration(renameColumnMigrations[1]);
  console.log("\n  State after step 2:");
  printTable("users");

  console.log("\n\nStep 3: DEPLOY — switch application reads\n");
  runMigration(renameColumnMigrations[2]);

  console.log("\n\nStep 4: CONTRACT — drop old column\n");
  runMigration(renameColumnMigrations[3]);
  console.log("\n  State after step 4 (rename complete):");
  printTable("users");

  // ═══════════════════════════════════════════════════════
  // Scenario B: Split users.address → addresses table
  // ═══════════════════════════════════════════════════════

  console.log("\n\n══════════════════════════════════════");
  console.log("SCENARIO B: Split table (users.address → addresses)");
  console.log("══════════════════════════════════════\n");

  console.log("Step 5: EXPAND — create addresses table\n");
  runMigration(splitTableMigrations[0]);

  console.log("\n\nStep 6: MIGRATE — backfill addresses\n");
  runMigration(splitTableMigrations[1]);
  console.log("\n  State after step 6:");
  printTable("addresses");

  console.log("\n\nStep 7: DEPLOY — switch application to addresses table\n");
  runMigration(splitTableMigrations[2]);

  console.log("\n\nStep 8: CONTRACT — drop address columns from users\n");
  runMigration(splitTableMigrations[3]);
  console.log("\n  Final state:");
  printTable("users");
  console.log();
  printTable("addresses");

  // ── Demonstrate Rollback ──────────────────────────────

  console.log("\n\n══════════════════════════════════════");
  console.log("ROLLBACK DEMO: Undo step 8");
  console.log("══════════════════════════════════════\n");

  rollbackMigration(splitTableMigrations[3]);
  console.log("\n  State after rollback:");
  printTable("users");

  // ── Migration Log ─────────────────────────────────────

  console.log("\n\n══════════════════════════════════════");
  console.log("MIGRATION LOG");
  console.log("══════════════════════════════════════\n");

  for (const entry of migrationLog) {
    const icon = entry.status === "applied" ? "✓" : "✗";
    console.log(`  ${icon} v${entry.version}: ${entry.name} [${entry.status}]`);
  }

  // ── Summary ───────────────────────────────────────────
  console.log("\n─────────────────────────────────────");
  console.log("Pattern Summary:");
  console.log("  1. EXPAND   — add new structure (non-breaking, no lock)");
  console.log("  2. MIGRATE  — backfill data (batched, short transactions)");
  console.log("  3. DEPLOY   — switch app code (dual-write, then single-write)");
  console.log("  4. CONTRACT — remove old structure (only after full deploy)");
  console.log("\nKey Rules:");
  console.log("  - Every step is independently deployable and rollback-safe");
  console.log("  - Never rename/drop/change-type in a single migration");
  console.log("  - Backfill in batches to avoid long-held locks");
  console.log("  - Dual-write during transition so old and new code both work");
  console.log("  - Wait for FULL deployment before the contract step");
}

main().catch(console.error);
