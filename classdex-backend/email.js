const { createHmac, randomBytes } = require("node:crypto");

const RESEND_API_URL = "https://api.resend.com/emails";

function getFrontendUrl() {
  return process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN || "http://localhost:5173";
}

function getEmailFrom() {
  return process.env.EMAIL_FROM || "ClassDex <no-reply@classdex.local>";
}

function getEmailSecret() {
  return process.env.SESSION_SECRET || "classdex-dev-session-secret";
}

function createSignedEmailToken(payload) {
  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      nonce: randomBytes(8).toString("hex"),
      issuedAt: new Date().toISOString(),
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", getEmailSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function buildVerificationEmail(user) {
  const token = createSignedEmailToken({
    type: "verify-email",
    userId: user.id,
    email: user.email,
  });
  const verifyLink = `${getFrontendUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  return {
    to: user.email,
    subject: "Verify your ClassDex email",
    html: `
      <p>Hello ${user.name},</p>
      <p>Thanks for creating your ClassDex account. Use the secure link below to verify your email address.</p>
      <p><a href="${verifyLink}">Verify your email</a></p>
      <p>If you did not create this account, you can safely ignore this message.</p>
    `,
    text: `Hello ${user.name},\n\nThanks for creating your ClassDex account. Use the secure link below to verify your email address.\n\n${verifyLink}\n\nIf you did not create this account, you can safely ignore this message.`,
  };
}

function buildJoinEmail({ studentName, studentEmail, classSectionName, classCode, status, facultyName }) {
  const subject = status === "PENDING"
    ? `Your request to join ${classSectionName} is pending`
    : `You joined ${classSectionName}`;
  const html = status === "PENDING"
    ? `
      <p>Hello ${studentName},</p>
      <p>Your request to join <strong>${classSectionName}</strong> is waiting for instructor approval.</p>
      <p>Class code: <strong>${classCode}</strong></p>
    `
    : `
      <p>Hello ${studentName},</p>
      <p>You are now enrolled in <strong>${classSectionName}</strong>.</p>
      <p>${facultyName ? `Your faculty member is ${facultyName}.` : ""}</p>
    `;
  const text = status === "PENDING"
    ? `Hello ${studentName},\n\nYour request to join ${classSectionName} is waiting for instructor approval.\n\nClass code: ${classCode}`
    : `Hello ${studentName},\n\nYou are now enrolled in ${classSectionName}.\n${facultyName ? `Your faculty member is ${facultyName}.\n` : ""}`;
  return { to: studentEmail, subject, html, text };
}

function buildFacultyJoinEmail({ facultyEmail, facultyName, studentName, classSectionName, classCode, status }) {
  const subject = status === "PENDING"
    ? `${studentName} requested to join ${classSectionName}`
    : `${studentName} joined ${classSectionName}`;
  const html = `
    <p>Hello ${facultyName || "faculty"},</p>
    <p><strong>${studentName}</strong> ${status === "PENDING" ? "requested to join" : "joined"} <strong>${classSectionName}</strong>.</p>
    <p>Class code: <strong>${classCode}</strong></p>
  `;
  const text = `Hello ${facultyName || "faculty"},\n\n${studentName} ${status === "PENDING" ? "requested to join" : "joined"} ${classSectionName}.\n\nClass code: ${classCode}`;
  return { to: facultyEmail, subject, html, text };
}

function buildDecisionEmail({ studentName, studentEmail, classSectionName, decision, facultyName }) {
  const isApproved = decision === "APPROVED";
  const subject = isApproved
    ? `You were approved for ${classSectionName}`
    : `Your request for ${classSectionName} was declined`;
  const html = `
    <p>Hello ${studentName},</p>
    <p>Your join request for <strong>${classSectionName}</strong> was ${isApproved ? "approved" : "declined"}${facultyName ? ` by ${facultyName}` : ""}.</p>
  `;
  const text = `Hello ${studentName},\n\nYour join request for ${classSectionName} was ${isApproved ? "approved" : "declined"}${facultyName ? ` by ${facultyName}` : ""}.`;
  return { to: studentEmail, subject, html, text };
}

async function sendEmail(message) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("Email skipped: RESEND_API_KEY is not configured.");
    return;
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: getEmailFrom(),
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Resend request failed with ${response.status}: ${errorText || response.statusText}`);
  }
}

function queueEmail(message, context) {
  Promise.resolve()
    .then(() => sendEmail(message))
    .catch((error) => {
      console.error(`Email send failed${context ? ` (${context})` : ""}:`, error);
    });
}

module.exports = {
  buildVerificationEmail,
  buildJoinEmail,
  buildFacultyJoinEmail,
  buildDecisionEmail,
  queueEmail,
};
