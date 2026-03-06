import { Pool, PoolConfig, PoolClient } from "pg";

// ─── Pool Sizing Formula ─────────────────────────────────
//
// Optimal pool size = (cores * 2) + effective_spindle_count
//
// For SSDs (spindle_count ≈ 1):
//   4 cores → (4 * 2) + 1 = 9 connections
//   8 cores → (8 * 2) + 1 = 17 connections
//
// For cloud databases:
//   Small  (2 vCPU):  5 connections
//   Medium (4 vCPU):  9 connections
//   Large  (8 vCPU):  17 connections
//
// Key insight: More connections != better performance.
// Postgres performs worse with too many concurrent connections
// due to context switching and lock contention.

function calculatePoolSize(cores: number, ssdBacked: boolean = true): number {
  const spindles = ssdBacked ? 1 : 4; // SSDs act like ~1 spindle
  return cores * 2 + spindles;
}

// ─── Production Pool Configuration ───────────────────────

function createPool(options?: {
  cores?: number;
  connectionString?: string;
}): Pool {
  const cores = options?.cores ?? 4;
  const poolSize = calculatePoolSize(cores);

  const config: PoolConfig = {
    // Connection
    connectionString:
      options?.connectionString ??
      process.env.DATABASE_URL ??
      "postgresql://user:pass@localhost:5432/mydb",

    // Pool sizing
    max: poolSize, // Maximum connections in pool
    min: Math.max(2, Math.floor(poolSize / 4)), // Keep minimum alive

    // Timeouts
    idleTimeoutMillis: 30_000, // Close idle connections after 30s
    connectionTimeoutMillis: 5_000, // Fail if can't connect in 5s
    maxLifetimeMillis: 1800_000, // Recycle connections every 30 min
    // Prevents issues with DNS changes, connection staleness

    // Statement timeout (query-level safeguard)
    statement_timeout: 30_000, // Kill queries running > 30s

    // Application name for pg_stat_activity monitoring
    application_name: "my-app-pool",
  };

  const pool = new Pool(config);

  // ─── Pool Event Handlers ────────────────────────────

  pool.on("connect", (client: PoolClient) => {
    // Set session-level defaults on each new connection
    client.query("SET timezone = 'UTC'");
    console.log("[Pool] New connection established");
  });

  pool.on("acquire", () => {
    // A client was checked out from the pool
    // Good place for metrics: pool.totalCount, pool.idleCount, pool.waitingCount
  });

  pool.on("remove", () => {
    console.log("[Pool] Connection removed from pool");
  });

  pool.on("error", (err: Error) => {
    // Unexpected error on idle client — log but don't crash
    console.error("[Pool] Unexpected error on idle client:", err.message);
  });

  return pool;
}

// ─── Health Check ────────────────────────────────────────

async function healthCheck(pool: Pool): Promise<{
  healthy: boolean;
  totalConnections: number;
  idleConnections: number;
  waitingRequests: number;
  latencyMs: number;
}> {
  const start = Date.now();
  try {
    const result = await pool.query("SELECT 1 as health");
    return {
      healthy: result.rows[0].health === 1,
      totalConnections: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingRequests: pool.waitingCount,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      healthy: false,
      totalConnections: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingRequests: pool.waitingCount,
      latencyMs: Date.now() - start,
    };
  }
}

// ─── Connection Wrapper with Monitoring ──────────────────

async function withConnection<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  const start = Date.now();

  try {
    const result = await fn(client);
    return result;
  } finally {
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn(`[Pool] Slow connection usage: ${duration}ms`);
    }
    client.release();
  }
}

// ─── Transaction Helper ──────────────────────────────────

async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── Graceful Shutdown ───────────────────────────────────

async function gracefulShutdown(pool: Pool): Promise<void> {
  console.log("[Pool] Draining connections...");
  await pool.end();
  console.log("[Pool] All connections closed");
}

// ─── Pool Monitoring ─────────────────────────────────────

function startPoolMonitoring(pool: Pool, intervalMs: number = 30_000) {
  const timer = setInterval(() => {
    console.log("[Pool Stats]", {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    });

    // Alert if too many waiting requests
    if (pool.waitingCount > 5) {
      console.warn(
        `[Pool Alert] ${pool.waitingCount} requests waiting. ` +
        `Consider increasing pool size (current max: ${pool.totalCount}).`
      );
    }
  }, intervalMs);

  return () => clearInterval(timer);
}

// ─── DEMO ────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║   Connection Pooling Configuration   ║");
  console.log("╚══════════════════════════════════════╝\n");

  // Pool sizing recommendations
  console.log("--- Pool Sizing Formula: (cores * 2) + spindles ---");
  [2, 4, 8, 16].forEach((cores) => {
    const size = calculatePoolSize(cores);
    console.log(`  ${cores} cores (SSD) → pool size: ${size}`);
  });

  console.log("\n--- Pool Configuration ---");
  const pool = createPool({ cores: 4 });
  console.log(`  Max connections: ${pool.totalCount} (will grow to ${calculatePoolSize(4)})`);
  console.log("  Idle timeout: 30s");
  console.log("  Connection lifetime: 30 min");
  console.log("  Statement timeout: 30s");

  // Health check
  console.log("\n--- Health Check ---");
  const health = await healthCheck(pool);
  console.log(health);

  // Example query with connection wrapper
  console.log("\n--- Query with Connection Wrapper ---");
  await withConnection(pool, async (client) => {
    const result = await client.query(
      "SELECT current_database() as db, current_user as user, version()"
    );
    console.log("Connected to:", result.rows[0]);
  });

  // Transaction example
  console.log("\n--- Transaction Example ---");
  try {
    await withTransaction(pool, async (client) => {
      await client.query("SELECT 1"); // placeholder operation
      console.log("Transaction committed successfully");
    });
  } catch (err) {
    console.error("Transaction failed:", err);
  }

  // Cleanup
  await gracefulShutdown(pool);
}

main().catch(console.error);
