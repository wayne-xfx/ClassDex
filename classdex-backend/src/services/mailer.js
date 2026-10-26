const DELIMITER = "=".repeat(72);
const SUB_DELIMITER = "-".repeat(72);

let customTestTransport = null;

function getClientUrl() {
  const raw =
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    process.env.FRONTEND_ORIGIN ||
    "http://localhost:5173";
  return String(raw).trim().replace(/\/+$/, "");
}

function getEmailFrom() {
  return process.env.EMAIL_FROM || "ClassDex <no-reply@classdex.local>";
}

function extractPrimaryLink(text, html) {
  const source = `${text || ""}\n${html || ""}`;
  const match = source.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : null;
}

async function devConsoleTransport({ to, subject, html, text }) {
  const link = extractPrimaryLink(text, html);
  const lines = [
    "",
    DELIMITER,
    "[ClassDex Dev Mailer]",
    `From:    ${getEmailFrom()}`,
    `To:      ${to}`,
    `Subject: ${subject}`,
    ...(link ? [`Link:    ${link}`] : []),
    SUB_DELIMITER,
    String(text || "").trim(),
    DELIMITER,
    "",
  ];
  console.log(lines.join("\n"));
  return { ok: true, transport: "dev-console", link };
}

function resolveTransport() {
  if (customTestTransport) {
    return customTestTransport;
  }

  if (process.env.RESEND_API_KEY) {
    // =======================================================================
    // RESEND TRANSPORT PLUG-IN POINT (postponed)
    // When ready to enable Resend delivery, return an async transport function
    // here that sends `{ from: getEmailFrom(), to, subject, html, text }` via
    // `new Resend(process.env.RESEND_API_KEY).emails.send(...)` so no caller
    // outside mailer.js needs to change.
    // =======================================================================
    if (process.env.NODE_ENV !== "production") {
      return devConsoleTransport;
    }
    console.warn(
      "[ClassDex Mailer] RESEND_API_KEY is set, but Resend transport is postponed and not yet wired.",
    );
    return async () => ({ ok: false, transport: "unconfigured-resend" });
  }

  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[ClassDex Mailer] Warning: NODE_ENV=production and no mail transport (RESEND_API_KEY) is configured. Skipping email delivery.",
    );
    return async () => ({ ok: false, transport: "none" });
  }

  return devConsoleTransport;
}

async function sendMail({ to, subject, html, text }) {
  try {
    if (!to || !subject) {
      throw new Error("sendMail requires 'to' and 'subject'.");
    }
    const transport = resolveTransport();
    return await transport({ to, subject, html, text });
  } catch (error) {
    console.error("[ClassDex Mailer] sendMail failed:", error?.message || error);
    return { ok: false, error: error?.message || "Mail delivery failed" };
  }
}

function setMailTransportForTests(transportFn) {
  customTestTransport = transportFn;
}

function resetMailTransportForTests() {
  customTestTransport = null;
}

module.exports = {
  getClientUrl,
  getEmailFrom,
  sendMail,
  setMailTransportForTests,
  resetMailTransportForTests,
};
