const { sendMail } = require("./src/services/mailer");
const {
  buildJoinEmail,
  buildFacultyJoinEmail,
  buildDecisionEmail,
} = require("./src/services/emailTemplates");

function queueEmail(message, context) {
  if (!message || !message.to) {
    return Promise.resolve({ ok: false, error: "Missing recipient" });
  }
  return Promise.resolve()
    .then(() => sendMail(message))
    .then((result) => {
      if (result && result.ok === false && context) {
        console.error(
          `[ClassDex Mailer] Queued email delivery failed (${context}): ${result.error || result.transport || "unknown error"}`,
        );
      }
      return result;
    })
    .catch((error) => {
      console.error(
        `[ClassDex Mailer] Email send failed${context ? ` (${context})` : ""}:`,
        error?.message || error,
      );
      return { ok: false, error: error?.message || "Queued email failed" };
    });
}

module.exports = {
  buildJoinEmail,
  buildFacultyJoinEmail,
  buildDecisionEmail,
  queueEmail,
};
