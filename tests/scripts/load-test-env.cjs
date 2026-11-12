const fs = require("node:fs");
const path = require("node:path");

const PROD_NEON_HOST_MARKER = "ep-polished-night-b3hs4no6";

function resolveRepoRoot() {
  return path.resolve(__dirname, "..", "..");
}

function parseDbHost(databaseUrl) {
  const raw = String(databaseUrl || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (!/^postgres(ql)?:$/i.test(parsed.protocol)) {
      return "";
    }
    return String(parsed.hostname || "").trim();
  } catch {
    return "";
  }
}

function getProdEnvHost(prodEnvPath, dotenv) {
  if (!prodEnvPath || !fs.existsSync(prodEnvPath)) {
    return "";
  }
  const prodEnv = dotenv.parse(fs.readFileSync(prodEnvPath, "utf8"));
  if (!prodEnv.DATABASE_URL) {
    return "";
  }
  return parseDbHost(prodEnv.DATABASE_URL);
}

function assertSafeTestDatabaseUrl(
  databaseUrl,
  { prodEnvPath, label = "DATABASE_URL" } = {},
) {
  const repoRoot = resolveRepoRoot();
  const backendDir = path.join(repoRoot, "classdex-backend");
  const dotenv = require(path.join(backendDir, "node_modules", "dotenv"));
  const resolvedProdEnvPath = prodEnvPath || path.join(backendDir, ".env");

  const host = parseDbHost(databaseUrl);
  if (!host) {
    throw new Error(
      `Refusing to start: ${label} is missing or not a valid PostgreSQL URL.`,
    );
  }

  if (host.toLowerCase().includes(PROD_NEON_HOST_MARKER)) {
    throw new Error(
      `Refusing to run tests against production database host (${host}).`,
    );
  }

  const prodHost = getProdEnvHost(resolvedProdEnvPath, dotenv);
  if (prodHost && host.toLowerCase() === prodHost.toLowerCase()) {
    throw new Error(
      `Refusing to run tests against production database host (${host}).`,
    );
  }

  return host;
}

function loadBackendTestEnv(options = {}) {
  const repoRoot = resolveRepoRoot();
  const backendDir = path.join(repoRoot, "classdex-backend");
  const dotenv = require(path.join(backendDir, "node_modules", "dotenv"));

  const prodEnvPath = path.join(backendDir, ".env");
  const testEnvPath = path.join(backendDir, ".env.test");

  if (!fs.existsSync(testEnvPath)) {
    throw new Error(`Missing test environment file: ${testEnvPath}`);
  }

  if (process.env.DATABASE_URL) {
    assertSafeTestDatabaseUrl(process.env.DATABASE_URL, {
      prodEnvPath,
      label: "process.env.DATABASE_URL",
    });
  }

  const testEnv = dotenv.parse(fs.readFileSync(testEnvPath, "utf8"));
  const testHost = assertSafeTestDatabaseUrl(testEnv.DATABASE_URL, {
    prodEnvPath,
    label: "classdex-backend/.env.test DATABASE_URL",
  });

  const targetNodeEnv =
    options.preserveNodeEnv && process.env.NODE_ENV
      ? process.env.NODE_ENV
      : "test";

  const merged = {
    ...testEnv,
    NODE_ENV: targetNodeEnv,
    EMAIL_MODE: "stub",
    RESEND_API_KEY: "",
    EMAIL_FROM: "",
  };

  for (const [key, value] of Object.entries(merged)) {
    process.env[key] = value;
  }

  return {
    repoRoot,
    backendDir,
    testHost,
    env: merged,
  };
}

module.exports = {
  PROD_NEON_HOST_MARKER,
  parseDbHost,
  assertSafeTestDatabaseUrl,
  loadBackendTestEnv,
  resolveRepoRoot,
};
