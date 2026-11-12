const {
  assertSafeTestDatabaseUrl,
  loadBackendTestEnv,
} = require("../scripts/load-test-env.cjs");

function initSecurityTestEnv(options = {}) {
  const result = loadBackendTestEnv(options);
  console.log(
    `[ClassDex Security Setup] Target DB host: ${result.testHost} | NODE_ENV=${process.env.NODE_ENV} | EMAIL_MODE=${process.env.EMAIL_MODE}`,
  );
  return result;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const rejectCheckIdx = args.indexOf("--assert-url");
  if (rejectCheckIdx !== -1) {
    const candidate = args[rejectCheckIdx + 1] || "";
    const host = assertSafeTestDatabaseUrl(candidate, { label: "--assert-url" });
    console.log(`[ClassDex Security Setup] Accepted DB host: ${host}`);
  } else {
    initSecurityTestEnv({ preserveNodeEnv: true });
  }
}

module.exports = {
  initSecurityTestEnv,
  assertSafeTestDatabaseUrl,
  loadBackendTestEnv,
};
