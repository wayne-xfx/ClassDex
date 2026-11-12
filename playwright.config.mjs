import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { defineConfig, devices } from "@playwright/test";

const require = createRequire(import.meta.url);
const { loadBackendTestEnv } = require("./tests/scripts/load-test-env.cjs");
const { testHost, env: loadedTestEnv } = loadBackendTestEnv();
if (!process.env.CLASSDEX_E2E_ENV_LOGGED) {
  process.env.CLASSDEX_E2E_ENV_LOGGED = "1";
  console.log(`[ClassDex E2E Startup] .env.test loaded | DB host: ${testHost} | EMAIL_MODE=${loadedTestEnv.EMAIL_MODE}`);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EDGE_PATH_X86 = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const EDGE_PATH_X64 = "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe";
const hasEdge = fs.existsSync(EDGE_PATH_X86) || fs.existsSync(EDGE_PATH_X64);

const E2E_BACKEND_PORT = process.env.E2E_BACKEND_PORT || "5051";
const E2E_FRONTEND_PORT = process.env.E2E_FRONTEND_PORT || "5174";
const BASE_URL = `http://localhost:${E2E_FRONTEND_PORT}`;

const projects = [
  {
    name: "chromium-desktop",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 1280, height: 800 },
    },
  },
  {
    name: "chromium-tablet",
    testMatch: /compat\.spec\.mjs/,
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 768, height: 1024 },
      hasTouch: true,
    },
  },
  {
    name: "chromium-mobile",
    testMatch: /compat\.spec\.mjs/,
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 375, height: 812 },
      isMobile: true,
      hasTouch: true,
    },
  },
  {
    name: "firefox-desktop",
    testMatch: /compat\.spec\.mjs/,
    use: {
      ...devices["Desktop Firefox"],
      viewport: { width: 1280, height: 800 },
    },
  },
  {
    name: "firefox-tablet",
    testMatch: /compat\.spec\.mjs/,
    use: {
      ...devices["Desktop Firefox"],
      viewport: { width: 768, height: 1024 },
    },
  },
  {
    name: "firefox-mobile",
    testMatch: /compat\.spec\.mjs/,
    use: {
      ...devices["Desktop Firefox"],
      viewport: { width: 375, height: 812 },
    },
  },
  {
    name: "webkit-desktop",
    testMatch: /compat\.spec\.mjs/,
    use: {
      ...devices["Desktop Safari"],
      viewport: { width: 1280, height: 800 },
    },
  },
  {
    name: "webkit-tablet",
    testMatch: /compat\.spec\.mjs/,
    use: {
      ...devices["Desktop Safari"],
      viewport: { width: 768, height: 1024 },
      hasTouch: true,
    },
  },
  {
    name: "webkit-mobile",
    testMatch: /compat\.spec\.mjs/,
    use: {
      ...devices["iPhone 13"],
      viewport: { width: 375, height: 812 },
    },
  },
];

if (hasEdge) {
  projects.push({
    name: "edge-desktop",
    testMatch: /compat\.spec\.mjs/,
    use: {
      ...devices["Desktop Edge"],
      channel: "msedge",
      viewport: { width: 1280, height: 800 },
    },
  });
}

export default defineConfig({
  testDir: path.join(__dirname, "tests/e2e"),
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects,
  webServer: [
    {
      command: `node "${path.join(__dirname, "tests/e2e/support/e2e-backend.cjs")}"`,
      url: `http://127.0.0.1:${E2E_BACKEND_PORT}/api/status`,
      reuseExistingServer: false,
      stdout: "pipe",
      timeout: 60_000,
      env: {
        ...process.env,
        ...loadedTestEnv,
        EMAIL_MODE: "stub",
        NODE_ENV: "test",
        E2E_BACKEND_PORT,
        E2E_FRONTEND_PORT,
      },
    },
    {
      command: `node "${path.join(__dirname, "classdex-frontend/node_modules/vite/bin/vite.js")}" --config "${path.join(__dirname, "tests/e2e/support/vite.e2e.config.mjs")}" --port ${E2E_FRONTEND_PORT} --strictPort`,
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        ...loadedTestEnv,
        EMAIL_MODE: "stub",
        E2E_BACKEND_PORT,
        VITE_RECAPTCHA_SITE_KEY:
          process.env.E2E_VITE_RECAPTCHA_SITE_KEY ||
          "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI",
      },
    },
  ],
});
