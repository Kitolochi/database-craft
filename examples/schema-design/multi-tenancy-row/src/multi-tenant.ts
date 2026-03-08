/**
 * ROW-LEVEL MULTI-TENANCY
 *
 * All tenants share the same database and tables. Each row has a
 * tenant_id column that scopes data to a specific tenant. Middleware
 * extracts the tenant from the request and automatically filters
 * all queries.
 *
 * Pros:
 *   - Simple infrastructure (one DB, one schema, one deploy)
 *   - Easy cross-tenant analytics and migrations
 *   - Low cost per tenant
 *
 * Cons:
 *   - Risk of data leaks if tenant scoping is missed
 *   - Noisy neighbor (one tenant's heavy queries affect others)
 *   - Harder to give tenants separate backups
 *
 * This example implements:
 *   1. Tenant context via AsyncLocalStorage (request-scoped)
 *   2. Middleware that extracts tenant from request headers/JWT
 *   3. Query scoping that auto-filters by tenant_id
 *   4. RLS policy SQL examples for database-level enforcement
 *
 * ─── RLS (Row-Level Security) SQL ────────────────────────
 *
 * RLS provides a database-level safety net. Even if application code
 * forgets to filter by tenant_id, Postgres will enforce it.
 *
 *   -- Enable RLS on the table
 *   ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
 *
 *   -- Force RLS even for table owners (important!)
 *   ALTER TABLE projects FORCE ROW LEVEL SECURITY;
 *
 *   -- Policy: users can only see rows where tenant_id matches
 *   -- the current session variable
 *   CREATE POLICY tenant_isolation ON projects
 *     USING (tenant_id = current_setting('app.current_tenant_id')::int);
 *
 *   -- Set the tenant for each request (in a transaction or session):
 *   SET LOCAL app.current_tenant_id = '42';
 *
 *   -- Now all queries are automatically filtered:
 *   SELECT * FROM projects;  -- only returns tenant 42's projects
 *   INSERT INTO projects (name, tenant_id) VALUES ('X', 99);  -- FAILS (policy violation)
 *
 *   -- For admin access (bypass RLS):
 *   CREATE ROLE app_admin BYPASSRLS;
 *
 *   -- Per-operation policies for finer control:
 *   CREATE POLICY tenant_select ON projects FOR SELECT
 *     USING (tenant_id = current_setting('app.current_tenant_id')::int);
 *   CREATE POLICY tenant_insert ON projects FOR INSERT
 *     WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::int);
 *   CREATE POLICY tenant_update ON projects FOR UPDATE
 *     USING (tenant_id = current_setting('app.current_tenant_id')::int);
 *   CREATE POLICY tenant_delete ON projects FOR DELETE
 *     USING (tenant_id = current_setting('app.current_tenant_id')::int);
 */

import { AsyncLocalStorage } from "node:async_hooks";

// ─── Tenant Context ──────────────────────────────────────
//
// AsyncLocalStorage provides request-scoped storage without
// passing tenant ID through every function call. Similar to
// thread-local storage in Java or Context in Go.

interface TenantContext {
  tenantId: string;
  tenantName: string;
  role: "member" | "admin" | "superadmin";
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();

function getCurrentTenant(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    throw new Error("No tenant context — are you inside a request handler?");
  }
  return ctx;
}

function getCurrentTenantId(): string {
  return getCurrentTenant().tenantId;
}

// ─── Middleware: Extract Tenant from Request ─────────────
//
// In a real app, the tenant ID comes from:
//   - JWT claims: req.user.tenantId (after auth middleware)
//   - Subdomain:  acme.app.com → tenantId = "acme"
//   - Header:     X-Tenant-ID (for internal services)
//   - Path:       /api/tenants/:tenantId/... (explicit)

interface Request {
  headers: Record<string, string | undefined>;
  path: string;
}

interface Response {
  status: number;
  body: unknown;
}

type NextFunction = () => Promise<Response>;

async function tenantMiddleware(
  req: Request,
  next: NextFunction
): Promise<Response> {
  // Strategy 1: Extract from header (API key / JWT decode)
  const tenantId = req.headers["x-tenant-id"];

  if (!tenantId) {
    return { status: 401, body: { error: "Missing tenant identifier" } };
  }

  // In production: validate tenant exists and is active
  const tenantName = `Tenant ${tenantId}`;

  // Run the handler inside the tenant context
  return tenantStorage.run(
    { tenantId, tenantName, role: "member" },
    () => next()
  );
}

// ─── In-Memory Store (simulates a multi-tenant DB) ───────

interface Project {
  id: number;
  tenantId: string;
  name: string;
  createdAt: Date;
}

interface Task {
  id: number;
  tenantId: string;
  projectId: number;
  title: string;
  completed: boolean;
}

// Shared tables — all tenants' data lives together
const projects: Project[] = [
  { id: 1, tenantId: "acme", name: "Website Redesign", createdAt: new Date("2024-01-15") },
  { id: 2, tenantId: "acme", name: "Mobile App", createdAt: new Date("2024-02-01") },
  { id: 3, tenantId: "globex", name: "Data Pipeline", createdAt: new Date("2024-01-20") },
  { id: 4, tenantId: "globex", name: "Internal Tools", createdAt: new Date("2024-03-01") },
  { id: 5, tenantId: "initech", name: "TPS Reports", createdAt: new Date("2024-02-15") },
];

const tasks: Task[] = [
  { id: 1, tenantId: "acme", projectId: 1, title: "Design mockups", completed: true },
  { id: 2, tenantId: "acme", projectId: 1, title: "Frontend build", completed: false },
  { id: 3, tenantId: "acme", projectId: 2, title: "React Native setup", completed: false },
  { id: 4, tenantId: "globex", projectId: 3, title: "ETL scripts", completed: true },
  { id: 5, tenantId: "globex", projectId: 3, title: "Dashboard", completed: false },
  { id: 6, tenantId: "initech", projectId: 5, title: "Cover sheet memo", completed: false },
];

// ─── Tenant-Scoped Query Layer ───────────────────────────
//
// Every query function reads the tenant from AsyncLocalStorage
// and filters automatically. This is the application-level
// equivalent of Postgres RLS.
//
// SQL equivalent (with RLS):
//   SET LOCAL app.current_tenant_id = '42';
//   SELECT * FROM projects;  -- auto-filtered by policy

function findProjects(): Project[] {
  const tenantId = getCurrentTenantId();
  // SQL: SELECT * FROM projects WHERE tenant_id = $1
  return projects.filter((p) => p.tenantId === tenantId);
}

function findProjectById(id: number): Project | undefined {
  const tenantId = getCurrentTenantId();
  // SQL: SELECT * FROM projects WHERE id = $1 AND tenant_id = $2
  return projects.find((p) => p.id === id && p.tenantId === tenantId);
}

function findTasks(projectId?: number): Task[] {
  const tenantId = getCurrentTenantId();
  // SQL: SELECT * FROM tasks WHERE tenant_id = $1 [AND project_id = $2]
  return tasks.filter(
    (t) => t.tenantId === tenantId && (projectId === undefined || t.projectId === projectId)
  );
}

function createProject(name: string): Project {
  const tenantId = getCurrentTenantId();
  const project: Project = {
    id: projects.length + 1,
    tenantId, // Always stamped with current tenant
    name,
    createdAt: new Date(),
  };
  projects.push(project);
  // SQL: INSERT INTO projects (tenant_id, name) VALUES ($1, $2)
  return project;
}

function createTask(projectId: number, title: string): Task {
  const tenantId = getCurrentTenantId();

  // Verify the project belongs to this tenant (prevent cross-tenant reference)
  const project = findProjectById(projectId);
  if (!project) {
    throw new Error(`Project ${projectId} not found for tenant ${tenantId}`);
  }

  const task: Task = {
    id: tasks.length + 1,
    tenantId,
    projectId,
    title,
    completed: false,
  };
  tasks.push(task);
  return task;
}

// ─── Simulated Request Handler ───────────────────────────

async function handleListProjects(): Promise<Response> {
  const tenant = getCurrentTenant();
  const tenantProjects = findProjects();
  return {
    status: 200,
    body: {
      tenant: tenant.tenantName,
      projects: tenantProjects.map((p) => ({ id: p.id, name: p.name })),
    },
  };
}

async function handleListTasks(projectId: number): Promise<Response> {
  const project = findProjectById(projectId);
  if (!project) {
    return { status: 404, body: { error: "Project not found" } };
  }

  const projectTasks = findTasks(projectId);
  return {
    status: 200,
    body: {
      project: project.name,
      tasks: projectTasks.map((t) => ({ id: t.id, title: t.title, completed: t.completed })),
    },
  };
}

// ─── DEMO ────────────────────────────────────────────────

async function simulateRequest(tenantId: string, handler: NextFunction): Promise<Response> {
  const req: Request = {
    headers: { "x-tenant-id": tenantId },
    path: "/api/projects",
  };
  return tenantMiddleware(req, handler);
}

async function main() {
  console.log("╔══════════════════════════════════════╗");
  console.log("║    Row-Level Multi-Tenancy            ║");
  console.log("╚══════════════════════════════════════╝\n");

  // ── Tenant Isolation Demo ───────────────────────────
  console.log("=== Tenant Isolation ===\n");
  console.log("Same table, different views per tenant:\n");

  // Acme sees only their projects
  const acmeResponse = await simulateRequest("acme", handleListProjects);
  console.log("Tenant: acme");
  console.log("  Projects:", JSON.stringify((acmeResponse.body as any).projects));

  // Globex sees only their projects
  const globexResponse = await simulateRequest("globex", handleListProjects);
  console.log("\nTenant: globex");
  console.log("  Projects:", JSON.stringify((globexResponse.body as any).projects));

  // Initech sees only their projects
  const initechResponse = await simulateRequest("initech", handleListProjects);
  console.log("\nTenant: initech");
  console.log("  Projects:", JSON.stringify((initechResponse.body as any).projects));

  // ── Cross-Tenant Protection ─────────────────────────
  console.log("\n=== Cross-Tenant Protection ===\n");

  // Acme tries to access Globex's project (id=3)
  const crossTenantResponse = await simulateRequest("acme", () =>
    handleListTasks(3)
  );
  console.log("Acme tries to access Globex's project #3:");
  console.log(`  Status: ${crossTenantResponse.status}`);
  console.log(`  Body: ${JSON.stringify(crossTenantResponse.body)}`);
  console.log("  (Blocked — project not found in Acme's scope)");

  // ── Task Scoping ────────────────────────────────────
  console.log("\n=== Scoped Task Queries ===\n");

  const acmeTasks = await simulateRequest("acme", () =>
    handleListTasks(1)
  );
  console.log("Acme's tasks for project #1:");
  console.log(`  ${JSON.stringify((acmeTasks.body as any).tasks)}`);

  const globexTasks = await simulateRequest("globex", () =>
    handleListTasks(3)
  );
  console.log("\nGlobex's tasks for project #3:");
  console.log(`  ${JSON.stringify((globexTasks.body as any).tasks)}`);

  // ── Missing Tenant Header ───────────────────────────
  console.log("\n=== Missing Tenant ===\n");
  const noTenantReq: Request = { headers: {}, path: "/api/projects" };
  const noTenantResponse = await tenantMiddleware(noTenantReq, handleListProjects);
  console.log(`Status: ${noTenantResponse.status}`);
  console.log(`Body: ${JSON.stringify(noTenantResponse.body)}`);

  // ── RLS SQL Reference ───────────────────────────────
  console.log("\n─────────────────────────────────────");
  console.log("RLS SETUP (Postgres)");
  console.log("─────────────────────────────────────\n");
  console.log("  -- 1. Enable RLS");
  console.log("  ALTER TABLE projects ENABLE ROW LEVEL SECURITY;");
  console.log("  ALTER TABLE projects FORCE ROW LEVEL SECURITY;\n");
  console.log("  -- 2. Create isolation policy");
  console.log("  CREATE POLICY tenant_isolation ON projects");
  console.log("    USING (tenant_id = current_setting('app.current_tenant_id')::int);\n");
  console.log("  -- 3. Set tenant per request (in your connection middleware)");
  console.log("  SET LOCAL app.current_tenant_id = '42';\n");
  console.log("  -- 4. All queries are now auto-filtered by Postgres");
  console.log("  SELECT * FROM projects;  -- returns only tenant 42's rows");
}

main().catch(console.error);
