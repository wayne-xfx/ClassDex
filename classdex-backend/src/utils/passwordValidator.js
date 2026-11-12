const rulesConfig = require("../../../shared/passwordRules.json");

const PASSWORD_MIN_LENGTH = rulesConfig.minLength;
const PASSWORD_MAX_BYTES = rulesConfig.maxBytes || 72;
const PASSWORD_MAX_BYTES_MESSAGE =
  rulesConfig.maxBytesErrorMessage || `Password must be ${PASSWORD_MAX_BYTES} bytes or fewer.`;
const PASSWORD_MISMATCH_MESSAGE = rulesConfig.mismatchMessage;

function checkRule(rule, password) {
  const value = String(password || "");
  if (rule.type === "minLength") {
    return value.length >= rule.value;
  }
  return true;
}

const PASSWORD_RULES = rulesConfig.rules.map((rule) => ({
  ...rule,
  test: (password) => checkRule(rule, password),
}));

function evaluatePasswordRules(password) {
  const value = String(password || "");
  return PASSWORD_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    errorMessage: rule.errorMessage,
    passed: rule.test(value),
  }));
}

function validatePassword(password) {
  const value = String(password || "");
  const results = evaluatePasswordRules(value);
  const failed = results.find((item) => !item.passed);
  if (failed) {
    return { valid: false, message: failed.errorMessage, results };
  }
  if (Buffer.byteLength(value, "utf8") > PASSWORD_MAX_BYTES) {
    return { valid: false, message: PASSWORD_MAX_BYTES_MESSAGE, results };
  }
  return { valid: true, message: "", results };
}

function validatePasswordWithConfirm(password, confirmPassword) {
  const base = validatePassword(password);
  if (!base.valid) {
    return base;
  }
  if (String(password || "") !== String(confirmPassword || "")) {
    return {
      valid: false,
      message: PASSWORD_MISMATCH_MESSAGE,
      results: base.results,
    };
  }
  return { valid: true, message: "", results: base.results };
}

module.exports = {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_BYTES,
  PASSWORD_MISMATCH_MESSAGE,
  PASSWORD_RULES,
  evaluatePasswordRules,
  validatePassword,
  validatePasswordWithConfirm,
};
