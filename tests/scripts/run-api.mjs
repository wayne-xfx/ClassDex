import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadBackendTestEnv } = require("./load-test-env.cjs");

const { repoRoot, backendDir, testHost, env } = loadBackendTestEnv();
const frontendDir = path.join(repoRoot, "classdex-frontend");

const childEnv = {
  ...process.env,
  ...env,
  NODE_ENV: "test",
  EMAIL_MODE: "stub",
};

const backendTests = fs
  .readdirSync(path.join(backendDir, "test"))
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => path.join(backendDir, "test", name));

const frontendTests = [
  ...fs
    .readdirSync(path.join(frontendDir, "test"))
    .filter((name) => /\.(test)\.(mjs|js)$/.test(name))
    .sort()
    .map((name) => path.join(frontendDir, "test", name)),
  ...fs
    .readdirSync(path.join(frontendDir, "src", "utils"))
    .filter((name) => /\.(test)\.(mjs|js)$/.test(name))
    .sort()
    .map((name) => path.join(frontendDir, "src", "utils", name)),
];

console.log(`[ClassDex test:api] Target DB host: ${testHost} | EMAIL_MODE=stub`);
console.log(
  `[ClassDex test:api] Running ${backendTests.length} backend suites via node --test --test-concurrency=1`,
);

const backendRun = spawnSync(
  process.execPath,
  ["--test", "--test-concurrency=1", ...backendTests],
  {
    cwd: backendDir,
    env: childEnv,
    stdio: "inherit",
  },
);

if (backendRun.status !== 0) {
  process.exit(backendRun.status ?? 1);
}

console.log(
  `\n[ClassDex test:api] Running ${frontendTests.length} frontend unit suites via node --test`,
);

const frontendRun = spawnSync(process.execPath, ["--test", ...frontendTests], {
  cwd: frontendDir,
  env: childEnv,
  stdio: "inherit",
});

process.exit(frontendRun.status ?? 1);
