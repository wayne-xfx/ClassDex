const fs = require("node:fs");
const path = require("node:path");

function resolveRepoRoot() {
  return path.resolve(__dirname, "..", "..");
}

function loadBackendTestEnv() {
  const repoRoot = resolveRepoRoot();
  const backendDir = path.join(repoRoot, "classdex-backend");
  const dotenv = require(path.join(backendDir, "node_modules", "dotenv"));

  const prodEnvPath = path.join(backendDir, ".env");
  const testEnvPath = path.join(backendDir, ".env.test");

  if (!fs.existsSync(testEnvPath)) {
    throw new Error(`Missing test environment file: ${testEnvPath}`);
  }

  const testEnv = dotenv.parse(fs.readFileSync(testEnvPath, "utf8"));
  if (!testEnv.DATABASE_URL) {
    throw new Error("classdex-backend/.env.test is missing DATABASE_URL.");
  }

  const testHost = new URL(testEnv.DATABASE_URL).hostname;
  if (fs.existsSync(prodEnvPath)) {
    const prodEnv = dotenv.parse(fs.readFileSync(prodEnvPath, "utf8"));
    if (prodEnv.DATABASE_URL) {
      const prodHost = new URL(prodEnv.DATABASE_URL).hostname;
      if (testHost === prodHost) {
        throw new Error(
          `Refusing to run tests against production database host (${testHost}).`,
        );
      }
    }
  }

  const merged = {
    ...testEnv,
    NODE_ENV: "test",
    EMAIL_MODE: "stub",
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

module.exports = { loadBackendTestEnv, resolveRepoRoot };
