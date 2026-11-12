import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { initSecurityTestEnv } = require("../security/setup.cjs");

const { repoRoot, backendDir, testHost, env } = initSecurityTestEnv();
const securityDir = path.join(repoRoot, "tests", "security");

function collectSecurityTests(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSecurityTests(full));
    } else if (/\.test\.(js|mjs|cjs)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results.sort();
}

const extraFiles = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const testFiles = extraFiles.length
  ? extraFiles.map((file) => path.resolve(repoRoot, file))
  : collectSecurityTests(securityDir);

if (testFiles.length === 0) {
  console.log(`[ClassDex test:security] Target DB host: ${testHost} | No security tests found yet.`);
  process.exit(0);
}

console.log(
  `[ClassDex test:security] Target DB host: ${testHost} | EMAIL_MODE=stub | Running ${testFiles.length} security suite(s)`,
);

const res = spawnSync(
  process.execPath,
  ["--test", "--test-concurrency=1", ...testFiles],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
      NODE_ENV: "test",
      EMAIL_MODE: "stub",
    },
    stdio: "inherit",
  },
);

process.exit(res.status ?? 1);
