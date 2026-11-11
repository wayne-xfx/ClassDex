import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadBackendTestEnv } = require("./load-test-env.cjs");

const { repoRoot, testHost, env } = loadBackendTestEnv();

console.log(`[ClassDex test:e2e] Target DB host: ${testHost} | EMAIL_MODE=stub`);

const extraArgs = process.argv.slice(2);

const pwCli = path.join(repoRoot, "node_modules", "@playwright", "test", "cli.js");
const res = spawnSync(process.execPath, [pwCli, "test", ...extraArgs], {
  cwd: repoRoot,
  env: {
    ...process.env,
    ...env,
    NODE_ENV: "test",
    EMAIL_MODE: "stub",
  },
  stdio: "inherit",
});

process.exit(res.status ?? 1);
