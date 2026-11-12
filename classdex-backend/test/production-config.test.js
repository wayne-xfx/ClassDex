if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    "postgresql://placeholder:placeholder@127.0.0.1:5432/classdex_unit?sslmode=disable";
}

const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeLogPath, assertProductionStartupConfig } = require("../index");
const { prisma, pool } = require("../db");

test.after(async () => {
  await prisma.$disconnect().catch(() => {});
  await pool.end().catch(() => {});
});

test("sanitizeLogPath strips query strings and masks token path segments", () => {
  assert.equal(
    sanitizeLogPath("/api/auth/reset-password/validate?token=secret-token-123"),
    "/api/auth/reset-password/validate",
  );
  assert.equal(
    sanitizeLogPath("/api/auth/reset-password/abc123tokenvalue"),
    "/api/auth/reset-password/[REDACTED]",
  );
  assert.equal(
    sanitizeLogPath("/api/auth/verify-email/abc123tokenvalue"),
    "/api/auth/verify-email/[REDACTED]",
  );
  assert.equal(
    sanitizeLogPath("/api/classes/cmabc123def456/students"),
    "/api/classes/cmabc123def456/students",
  );
  assert.equal(sanitizeLogPath("/api/status"), "/api/status");
});

test("assertProductionStartupConfig rejects Google public reCAPTCHA test keys in production", () => {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    SESSION_SECRET: process.env.SESSION_SECRET,
    FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN,
    APP_BASE_URL: process.env.APP_BASE_URL,
    RECAPTCHA_SECRET_KEY: process.env.RECAPTCHA_SECRET_KEY,
    EMAIL_MODE: process.env.EMAIL_MODE,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
  };
  try {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef_strong";
    process.env.FRONTEND_ORIGIN = "https://classdex.me";
    process.env.APP_BASE_URL = "https://classdex.me";
    process.env.RECAPTCHA_SECRET_KEY = "6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe";
    process.env.EMAIL_MODE = "resend";
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "ClassDex <no-reply@classdex.me>";

    assert.throws(
      () => assertProductionStartupConfig({ requireMailer: true }),
      /RECAPTCHA_SECRET_KEY must not use Google's public test key in production/,
    );
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
