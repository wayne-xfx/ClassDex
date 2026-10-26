const test = require("node:test");
const assert = require("node:assert/strict");
const {
  generateToken,
  hashToken,
  getResetTokenExpiry,
  getVerifyTokenExpiry,
  normalizeEmail,
} = require("../src/utils/tokens");
const {
  PASSWORD_MIN_LENGTH,
  evaluatePasswordRules,
  validatePassword,
  validatePasswordWithConfirm,
} = require("../src/utils/passwordValidator");
const {
  sendMail,
  setMailTransportForTests,
  resetMailTransportForTests,
} = require("../src/services/mailer");
const {
  buildResetPasswordEmail,
  buildPasswordChangedEmail,
  buildVerifyEmail,
} = require("../src/services/emailTemplates");

test("Token helper generates 32-byte random hex tokens and deterministic SHA-256 hashes", () => {
  const first = generateToken();
  const second = generateToken();

  assert.equal(first.raw.length, 64);
  assert.match(first.raw, /^[0-9a-f]{64}$/);
  assert.notEqual(first.raw, second.raw);
  assert.notEqual(first.raw, first.hash);
  assert.equal(first.hash, hashToken(first.raw));
  assert.equal(first.hash.length, 64);
});

test("Token expiry helpers honor default and environment TTL overrides", () => {
  const base = new Date("2026-10-26T12:00:00.000Z");
  const prevReset = process.env.RESET_TOKEN_TTL_MINUTES;
  const prevVerify = process.env.VERIFY_TOKEN_TTL_HOURS;

  try {
    delete process.env.RESET_TOKEN_TTL_MINUTES;
    delete process.env.VERIFY_TOKEN_TTL_HOURS;
    assert.equal(getResetTokenExpiry(base).getTime() - base.getTime(), 30 * 60 * 1000);
    assert.equal(getVerifyTokenExpiry(base).getTime() - base.getTime(), 24 * 60 * 60 * 1000);

    process.env.RESET_TOKEN_TTL_MINUTES = "5";
    process.env.VERIFY_TOKEN_TTL_HOURS = "2";
    assert.equal(getResetTokenExpiry(base).getTime() - base.getTime(), 5 * 60 * 1000);
    assert.equal(getVerifyTokenExpiry(base).getTime() - base.getTime(), 2 * 60 * 60 * 1000);
  } finally {
    if (prevReset === undefined) delete process.env.RESET_TOKEN_TTL_MINUTES;
    else process.env.RESET_TOKEN_TTL_MINUTES = prevReset;
    if (prevVerify === undefined) delete process.env.VERIFY_TOKEN_TTL_HOURS;
    else process.env.VERIFY_TOKEN_TTL_HOURS = prevVerify;
  }
});

test("normalizeEmail trims and lowercases email addresses", () => {
  assert.equal(normalizeEmail("  Faculty.User@LNU.edu.ph  "), "faculty.user@lnu.edu.ph");
});

test("Shared password validator enforces exact Registration rules", () => {
  assert.equal(PASSWORD_MIN_LENGTH, 8);
  assert.equal(validatePassword("short77").valid, false);
  assert.equal(validatePassword("short77").message, "Password must be at least 8 characters.");
  assert.equal(validatePassword("12345678").valid, true);

  assert.equal(validatePasswordWithConfirm("12345678", "87654321").valid, false);
  assert.equal(validatePasswordWithConfirm("12345678", "87654321").message, "Passwords do not match.");
  assert.equal(validatePasswordWithConfirm("12345678", "12345678").valid, true);

  const checklist = evaluatePasswordRules("12345678");
  assert.equal(checklist.length, 1);
  assert.equal(checklist[0].passed, true);
});

test("Email templates produce blue-and-white HTML and plain-text bodies with escaped user input", () => {
  const reset = buildResetPasswordEmail({
    to: "user@example.com",
    name: "Jane <Admin>",
    resetUrl: "http://localhost:5173/reset-password?token=abc123",
    ttlMinutes: 30,
  });
  assert.match(reset.subject, /reset/i);
  assert.match(reset.html, /Jane &lt;Admin&gt;/);
  assert.match(reset.html, /http:\/\/localhost:5173\/reset-password\?token=abc123/);
  assert.match(reset.text, /http:\/\/localhost:5173\/reset-password\?token=abc123/);

  const changed = buildPasswordChangedEmail({
    to: "user@example.com",
    name: "Jane",
    loginUrl: "http://localhost:5173/login",
  });
  assert.match(changed.subject, /password was changed/i);
  assert.match(changed.text, /http:\/\/localhost:5173\/login/);

  const verify = buildVerifyEmail({
    to: "user@example.com",
    name: "Jane",
    verifyUrl: "http://localhost:5173/verify-email?token=xyz789",
    ttlHours: 24,
  });
  assert.match(verify.subject, /verify/i);
  assert.match(verify.text, /http:\/\/localhost:5173\/verify-email\?token=xyz789/);
});

test("Mailer catches transport failures without throwing and warns cleanly in unconfigured production", async () => {
  setMailTransportForTests(async () => {
    throw new Error("Simulated transport error");
  });
  try {
    const result = await sendMail({
      to: "user@example.com",
      subject: "Test",
      html: "<p>Hi</p>",
      text: "Hi",
    });
    assert.equal(result.ok, false);
  } finally {
    resetMailTransportForTests();
  }

  const prevEnv = process.env.NODE_ENV;
  const prevResend = process.env.RESEND_API_KEY;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.RESEND_API_KEY;
    const prodResult = await sendMail({
      to: "user@example.com",
      subject: "Prod test",
      html: "<p>Hi</p>",
      text: "Hi",
    });
    assert.equal(prodResult.ok, false);
    assert.equal(prodResult.transport, "none");
  } finally {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    if (prevResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = prevResend;
  }
});
