const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const {
  getClientUrl,
  getEmailFrom,
  validateMailerConfig,
  sendMail,
} = require("../src/services/mailer");
const {
  escapeHtml,
  wrapEmailLayout,
} = require("../src/services/emailTemplates");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function main() {
  const recipient = String(process.argv[2] || "").trim();
  const mode = String(process.env.EMAIL_MODE || "").trim().toLowerCase();

  if (mode !== "resend") {
    console.error(
      `[ERROR] 400: EMAIL_MODE must be set to "resend" in classdex-backend/.env before running this script (current: "${process.env.EMAIL_MODE || "unset"}").`,
    );
    process.exit(1);
  }

  if (!recipient) {
    console.error(
      "[ERROR] 400: Missing recipient email address. Usage: node scripts/send-test-email.js <recipient>",
    );
    process.exit(1);
  }

  if (!EMAIL_PATTERN.test(recipient)) {
    console.error(`[ERROR] 400: Invalid recipient email address "${recipient}".`);
    process.exit(1);
  }

  if (/\.local$/i.test(recipient) || /@example\.(com|org|net)$/i.test(recipient)) {
    console.error(
      `[ERROR] 400: Refusing to send to reserved/test address "${recipient}" to protect classdex.me domain reputation. Use your real email address or delivered@resend.dev.`,
    );
    process.exit(1);
  }

  try {
    validateMailerConfig({ ignoreTestRunner: true });
  } catch (configError) {
    console.error(`[ERROR] 400: ${configError.message}`);
    process.exit(1);
  }

  const baseUrl = getClientUrl();
  const fromAddress = getEmailFrom();
  const loginUrl = `${baseUrl}/login`;
  const timestamp = new Date().toISOString();

  const subject = "ClassDex Resend Delivery Smoke Test";
  const bodyHtml = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1c2940;">
      This is a live Resend smoke-test message from your <strong>ClassDex</strong> backend.
    </p>
    <p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#65738a;">
      <strong>From:</strong> ${escapeHtml(fromAddress)}<br />
      <strong>To:</strong> ${escapeHtml(recipient)}<br />
      <strong>Base URL:</strong> ${escapeHtml(baseUrl)}<br />
      <strong>Sent at:</strong> ${escapeHtml(timestamp)}
    </p>
  `;

  const html = wrapEmailLayout({
    preheader: "ClassDex Resend live email delivery verification.",
    heading: "Resend delivery confirmed",
    greetingName: recipient,
    bodyHtml,
    ctaLabel: "Open ClassDex Login",
    ctaUrl: loginUrl,
  });

  const text = [
    `Hello ${recipient},`,
    "",
    "This is a live Resend smoke-test message from your ClassDex backend.",
    "",
    `From: ${fromAddress}`,
    `To: ${recipient}`,
    `Base URL: ${baseUrl}`,
    `Sent at: ${timestamp}`,
    "",
    `Open ClassDex Login: ${loginUrl}`,
  ].join("\n");

  const result = await sendMail({
    to: recipient,
    subject,
    html,
    text,
  });

  if (result?.ok && result.transport === "resend" && result.id) {
    console.log(`[OK] Sent via Resend — message id: ${result.id}`);
    process.exit(0);
  }

  const statusCode = result?.statusCode || "SEND_FAILED";
  const message = result?.error || "Failed to send email via Resend.";
  console.error(`[ERROR] ${statusCode}: ${message}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(`[ERROR] 500: ${error?.message || error}`);
  process.exit(1);
});
