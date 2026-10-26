const { createHash, randomBytes } = require("node:crypto");

const DEFAULT_RESET_TTL_MINUTES = 30;
const DEFAULT_VERIFY_TTL_HOURS = 24;

function hashToken(raw) {
  return createHash("sha256").update(String(raw || "")).digest("hex");
}

function generateToken() {
  const raw = randomBytes(32).toString("hex");
  return {
    raw,
    hash: hashToken(raw),
  };
}

function parsePositiveNumber(envValue, fallback) {
  const parsed = Number(envValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getResetTokenTtlMinutes() {
  return parsePositiveNumber(process.env.RESET_TOKEN_TTL_MINUTES, DEFAULT_RESET_TTL_MINUTES);
}

function getVerifyTokenTtlHours() {
  return parsePositiveNumber(process.env.VERIFY_TOKEN_TTL_HOURS, DEFAULT_VERIFY_TTL_HOURS);
}

function getResetTokenExpiry(now = new Date()) {
  return new Date(now.getTime() + getResetTokenTtlMinutes() * 60 * 1000);
}

function getVerifyTokenExpiry(now = new Date()) {
  return new Date(now.getTime() + getVerifyTokenTtlHours() * 60 * 60 * 1000);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

module.exports = {
  DEFAULT_RESET_TTL_MINUTES,
  DEFAULT_VERIFY_TTL_HOURS,
  hashToken,
  generateToken,
  getResetTokenTtlMinutes,
  getVerifyTokenTtlHours,
  getResetTokenExpiry,
  getVerifyTokenExpiry,
  normalizeEmail,
};
