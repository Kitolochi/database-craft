/**
 * AUDIT TRAIL PATTERN
 *
 * Automatically tracks who created/updated every record and when, plus
 * stores a full history of previous versions so you can see exactly
 * what changed and when.
 *
 * Two approaches:
 *
 *   1. Trigger-based (SQL) — the database itself captures history on
 *      every UPDATE. Zero application code, impossible to bypass.
 *      See the SQL comments below.
 *
 *   2. Application-level (implemented here) — the service layer
 *      populates timestamps and writes history rows. More portable
 *      across databases and easier to enrich with context (e.g., IP
 *      address, request ID).
 *
 * What gets tracked:
 *   - created_at / created_by — set once on INSERT, never changed
 *   - updated_at / updated_by — set on every UPDATE
 *   - entity_history table  — stores the previous state before each update
 *
 * ─── Trigger-Based Approach (Postgres SQL) ────────────────
 *
 *   -- 1. Main table with audit columns
 *   CREATE TABLE products (
 *     id          SERIAL PRIMARY KEY,
 *     name        VARCHAR(255) NOT NULL,
 *     price       DECIMAL(10,2) NOT NULL,
 *     status      VARCHAR(50) DEFAULT 'draft',
 *     created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
 *     created_by  VARCHAR(255) NOT NULL,
 *     updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
 *     updated_by  VARCHAR(255) NOT NULL
 *   );
 *
 *   -- 2. History table — stores previous versions as JSONB
 *   CREATE TABLE product_history (
 *     id           SERIAL PRIMARY KEY,
 *     entity_id    INT NOT NULL REFERENCES products(id),
 *     version      INT NOT NULL,
 *     data         JSONB NOT NULL,
 *     changed_by   VARCHAR(255) NOT NULL,
 *     changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
 *     UNIQUE(entity_id, version)
 *   );
 *
 *   -- 3. Trigger function — snapshots the OLD row before update
 *   CREATE OR REPLACE FUNCTION audit_product_changes()
 *   RETURNS TRIGGER AS $$
 *   BEGIN
 *     INSERT INTO product_history (entity_id, version, data, changed_by, changed_at)
 *     VALUES (
 *       OLD.id,
 *       COALESCE(
 *         (SELECT MAX(version) + 1 FROM product_history WHERE entity_id = OLD.id),
 *         1
 *       ),
 *       to_jsonb(OLD),
 *       NEW.updated_by,
 *       now()
 *     );
 *     NEW.updated_at = now();
 *     RETURN NEW;
 *   END;
 *   $$ LANGUAGE plpgsql;
 *
 *   -- 4. Attach the trigger
 *   CREATE TRIGGER trg_audit_product
 *     BEFORE UPDATE ON products
 *     FOR EACH ROW
 *     EXECUTE FUNCTION audit_product_changes();
 *
 *   -- Now every UPDATE automatically captures history:
 *   UPDATE products SET price = 29.99, updated_by = 'alice' WHERE id = 1;
 *   SELECT * FROM product_history WHERE entity_id = 1 ORDER BY version;
 */

// ─── Types ────────────────────────────────────────────────

interface AuditFields {
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

interface Product extends AuditFields {
  id: number;
  name: string;
  price: number;
  status: "draft" | "active" | "archived";
}

interface HistoryEntry {
  id: number;
  entityId: number;
  version: number;
  data: Record<string, unknown>;
  changedBy: string;
  changedAt: Date;
}

interface FieldDiff {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

// ─── In-Memory Store (simulates a database) ───────────────

const products: Product[] = [];
const productHistory: HistoryEntry[] = [];
let nextProductId = 1;
let nextHistoryId = 1;

// ─── Audit-Aware Service Layer ────────────────────────────
//
// Every create/update goes through these functions, which
// auto-populate the audit fields and write history rows.
// In a real app this would be middleware or a base repository.

function createProduct(
  input: { name: string; price: number; status?: Product["status"] },
  actor: string
): Product {
  const now = new Date();

  // SQL: INSERT INTO products (name, price, status, created_at, created_by, updated_at, updated_by)
  //      VALUES ($1, $2, $3, now(), $4, now(), $4)
  const product: Product = {
    id: nextProductId++,
    name: input.name,
    price: input.price,
    status: input.status ?? "draft",
    createdAt: now,
    createdBy: actor,
    updatedAt: now,
    updatedBy: actor,
  };

  products.push(product);
  return product;
}

function updateProduct(
  productId: number,
  changes: Partial<Pick<Product, "name" | "price" | "status">>,
  actor: string
): Product {
  const product = products.find((p) => p.id === productId);
  if (!product) {
    throw new Error(`Product ${productId} not found`);
  }

  // 1. Snapshot the current state into history BEFORE applying changes.
  //    This is the application-level equivalent of the BEFORE UPDATE trigger.
  //    SQL (trigger does this): INSERT INTO product_history (entity_id, version, data, ...)
  const currentVersion = productHistory.filter((h) => h.entityId === productId).length + 1;

  const snapshot: HistoryEntry = {
    id: nextHistoryId++,
    entityId: productId,
    version: currentVersion,
    data: {
      name: product.name,
      price: product.price,
      status: product.status,
      updatedAt: product.updatedAt.toISOString(),
      updatedBy: product.updatedBy,
    },
    changedBy: actor,
    changedAt: new Date(),
  };
  productHistory.push(snapshot);

  // 2. Apply changes and update audit fields
  //    SQL: UPDATE products SET ..., updated_at = now(), updated_by = $actor WHERE id = $id
  if (changes.name !== undefined) product.name = changes.name;
  if (changes.price !== undefined) product.price = changes.price;
  if (changes.status !== undefined) product.status = changes.status;
  product.updatedAt = new Date();
  product.updatedBy = actor;

  return product;
}

// ─── History Queries ──────────────────────────────────────

function getHistory(productId: number): HistoryEntry[] {
  // SQL: SELECT * FROM product_history WHERE entity_id = $1 ORDER BY version ASC
  return productHistory
    .filter((h) => h.entityId === productId)
    .sort((a, b) => a.version - b.version);
}

function getVersionAt(productId: number, version: number): HistoryEntry | undefined {
  // SQL: SELECT * FROM product_history WHERE entity_id = $1 AND version = $2
  return productHistory.find((h) => h.entityId === productId && h.version === version);
}

// ─── Diff Function ────────────────────────────────────────
//
// Compares two versions and returns the fields that changed.
// Useful for audit logs, change notifications, and compliance.
//
// SQL equivalent using JSONB:
//   SELECT key, old.value, new.value
//   FROM jsonb_each(old_version.data) AS old(key, value)
//   FULL JOIN jsonb_each(new_version.data) AS new(key, value) USING (key)
//   WHERE old.value IS DISTINCT FROM new.value;

function diffVersions(
  older: Record<string, unknown>,
  newer: Record<string, unknown>
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const allKeys = new Set([...Object.keys(older), ...Object.keys(newer)]);

  for (const field of allKeys) {
    const oldVal = older[field];
    const newVal = newer[field];

    // Compare serialized values to handle dates and nested objects
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diffs.push({ field, oldValue: oldVal, newValue: newVal });
    }
  }

  return diffs;
}

function diffBetweenVersions(
  productId: number,
  versionA: number,
  versionB: number
): FieldDiff[] {
  const a = getVersionAt(productId, versionA);
  const b = getVersionAt(productId, versionB);

  if (!a || !b) {
    throw new Error(`Version ${a ? versionB : versionA} not found for product ${productId}`);
  }

  return diffVersions(a.data, b.data);
}

function diffFromCurrent(productId: number, version: number): FieldDiff[] {
  const product = products.find((p) => p.id === productId);
  const historyEntry = getVersionAt(productId, version);

  if (!product || !historyEntry) {
    throw new Error(`Product ${productId} or version ${version} not found`);
  }

  const currentData: Record<string, unknown> = {
    name: product.name,
    price: product.price,
    status: product.status,
    updatedAt: product.updatedAt.toISOString(),
    updatedBy: product.updatedBy,
  };

  return diffVersions(historyEntry.data, currentData);
}

// ─── Formatting Helpers ───────────────────────────────────

function formatProduct(p: Product): string {
  return (
    `  id=${p.id} name="${p.name}" price=$${p.price.toFixed(2)} status=${p.status}\n` +
    `  created: ${p.createdAt.toISOString()} by ${p.createdBy}\n` +
    `  updated: ${p.updatedAt.toISOString()} by ${p.updatedBy}`
  );
}

function formatDiffs(diffs: FieldDiff[]): string {
  if (diffs.length === 0) return "  (no changes)";
  return diffs
    .map((d) => `  ${d.field}: ${JSON.stringify(d.oldValue)} → ${JSON.stringify(d.newValue)}`)
    .join("\n");
}

// ─── DEMO ─────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║        Audit Trail Pattern           ║");
  console.log("╚══════════════════════════════════════╝\n");

  // ── Create ────────────────────────────────────────────
  console.log("=== Create Product ===\n");

  const product = createProduct(
    { name: "Widget Pro", price: 49.99, status: "draft" },
    "alice"
  );
  console.log("Created:\n" + formatProduct(product));
  console.log("  (createdBy/createdAt set automatically)");

  // ── First Update ──────────────────────────────────────
  console.log("\n=== Update #1: Change price (by bob) ===\n");

  const v1 = updateProduct(product.id, { price: 59.99 }, "bob");
  console.log("After update:\n" + formatProduct(v1));
  console.log("  (updatedBy/updatedAt changed, createdBy/createdAt unchanged)");

  // ── Second Update ─────────────────────────────────────
  console.log("\n=== Update #2: Activate + rename (by carol) ===\n");

  const v2 = updateProduct(product.id, { status: "active", name: "Widget Pro Max" }, "carol");
  console.log("After update:\n" + formatProduct(v2));

  // ── Third Update ──────────────────────────────────────
  console.log("\n=== Update #3: Price drop (by alice) ===\n");

  const v3 = updateProduct(product.id, { price: 39.99 }, "alice");
  console.log("After update:\n" + formatProduct(v3));

  // ── View Full History ─────────────────────────────────
  console.log("\n=== Full History ===\n");

  const history = getHistory(product.id);
  console.log(`${history.length} history entries for product #${product.id}:\n`);

  for (const entry of history) {
    console.log(`  Version ${entry.version} (changed by ${entry.changedBy} at ${entry.changedAt.toISOString()}):`);
    console.log(`    ${JSON.stringify(entry.data)}`);
  }

  // ── Diff Between Versions ─────────────────────────────
  console.log("\n=== Diff: Version 1 → Version 2 ===\n");

  const diff12 = diffBetweenVersions(product.id, 1, 2);
  console.log(formatDiffs(diff12));

  console.log("\n=== Diff: Version 2 → Version 3 ===\n");

  const diff23 = diffBetweenVersions(product.id, 2, 3);
  console.log(formatDiffs(diff23));

  // ── Diff From History to Current ──────────────────────
  console.log("\n=== Diff: Version 1 → Current ===\n");

  const diffCurrent = diffFromCurrent(product.id, 1);
  console.log(formatDiffs(diffCurrent));

  // ── Multiple Entities ─────────────────────────────────
  console.log("\n=== Multiple Entities ===\n");

  const gadget = createProduct({ name: "Gadget", price: 19.99 }, "dave");
  updateProduct(gadget.id, { price: 24.99, status: "active" }, "eve");
  updateProduct(gadget.id, { name: "Gadget Plus" }, "dave");

  console.log(`Product #${gadget.id} history: ${getHistory(gadget.id).length} versions`);
  console.log(`Product #${product.id} history: ${getHistory(product.id).length} versions`);
  console.log("  (Each entity maintains independent version history)");

  // ── Summary ───────────────────────────────────────────
  console.log("\n─────────────────────────────────────");
  console.log("Pattern Summary:");
  console.log("  CREATE: set createdAt/createdBy + updatedAt/updatedBy");
  console.log("  UPDATE: snapshot old state → apply changes → set updatedAt/updatedBy");
  console.log("  HISTORY: query entity_history table by entity_id, ordered by version");
  console.log("  DIFF: compare two versions field-by-field to see what changed");
  console.log("\nTrigger-based (SQL) vs Application-level:");
  console.log("  Trigger:     impossible to bypass, no app code needed");
  console.log("  Application: portable, easier to add context (IP, request ID)");
  console.log("  Recommendation: use both — triggers as safety net, app for rich context");
}

main().catch(console.error);
