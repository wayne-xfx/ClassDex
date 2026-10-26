function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapEmailLayout({ preheader, heading, greetingName, bodyHtml, ctaLabel, ctaUrl, footerNote }) {
  const safePreheader = escapeHtml(preheader);
  const safeHeading = escapeHtml(heading);
  const safeGreeting = greetingName ? `Hello ${escapeHtml(greetingName)},` : "Hello,";
  const safeCtaLabel = ctaLabel ? escapeHtml(ctaLabel) : "";
  const safeCtaUrl = ctaUrl ? escapeHtml(ctaUrl) : "";
  const safeFooter = escapeHtml(footerNote || "Leyte Normal University · ClassDex Classroom Records");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeHeading}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f7fc;font-family:'Inter','Segoe UI',Arial,sans-serif;color:#1c2940;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${safePreheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f7fc;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e2e8f1;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="background:linear-gradient(135deg,#192957,#3569d4);padding:22px 28px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.02em;">ClassDex</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <h1 style="margin:0 0 14px;color:#192957;font-size:22px;font-weight:700;line-height:1.3;">${safeHeading}</h1>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1c2940;">${safeGreeting}</p>
                ${bodyHtml}
                ${
                  safeCtaUrl
                    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0;">
                        <tr>
                          <td style="border-radius:10px;background-color:#192957;">
                            <a href="${safeCtaUrl}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;border-radius:10px;">${safeCtaLabel}</a>
                          </td>
                        </tr>
                      </table>
                      <p style="margin:0 0 16px;font-size:12px;line-height:1.5;color:#65738a;word-break:break-all;">
                        Or copy and paste this link into your browser:<br />
                        <a href="${safeCtaUrl}" style="color:#3569d4;">${safeCtaUrl}</a>
                      </p>`
                    : ""
                }
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;background-color:#f8fafd;border-top:1px solid #e2e8f1;font-size:12px;color:#65738a;">
                ${safeFooter}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function formatDurationMinutes(ttlMinutes) {
  const rounded = Math.round(Number(ttlMinutes) || 30);
  if (rounded === 1) return "1 minute";
  return `${rounded} minutes`;
}

function formatDurationHours(ttlHours) {
  const rounded = Math.round(Number(ttlHours) || 24);
  if (rounded === 1) return "1 hour";
  return `${rounded} hours`;
}

function buildResetPasswordEmail({ to, name, resetUrl, ttlMinutes = 30 }) {
  const expiryLabel = formatDurationMinutes(ttlMinutes);
  const subject = "Reset your ClassDex password";
  const bodyHtml = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1c2940;">
      We received a request to reset the password for your ClassDex account. Use the button below to choose a new password.
    </p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#65738a;">
      This single-use link expires in <strong>${escapeHtml(expiryLabel)}</strong>. If you didn’t request a password reset, you can safely ignore this email and your password will stay the same.
    </p>
  `;
  const html = wrapEmailLayout({
    preheader: `Reset your ClassDex password (valid for ${expiryLabel}).`,
    heading: "Reset your password",
    greetingName: name,
    bodyHtml,
    ctaLabel: "Reset password",
    ctaUrl: resetUrl,
  });
  const text = [
    `Hello ${name || "there"},`,
    "",
    "We received a request to reset the password for your ClassDex account.",
    "Open the single-use link below to choose a new password:",
    "",
    resetUrl,
    "",
    `This link expires in ${expiryLabel}. If you did not request a password reset, you can safely ignore this message.`,
  ].join("\n");

  return { to, subject, html, text };
}

function buildPasswordChangedEmail({ to, name, loginUrl }) {
  const subject = "Your ClassDex password was changed";
  const bodyHtml = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1c2940;">
      This is a confirmation that the password for your ClassDex account was just updated, and any earlier sessions on other devices have been signed out.
    </p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#65738a;">
      If you did not make this change, please reset your password immediately from the login page and contact your administrator.
    </p>
  `;
  const html = wrapEmailLayout({
    preheader: "Your ClassDex account password was recently changed.",
    heading: "Your password was changed",
    greetingName: name,
    bodyHtml,
    ctaLabel: loginUrl ? "Go to ClassDex Login" : "",
    ctaUrl: loginUrl || "",
  });
  const text = [
    `Hello ${name || "there"},`,
    "",
    "This is a confirmation that the password for your ClassDex account was just updated, and any earlier sessions on other devices have been signed out.",
    ...(loginUrl ? ["", `Sign in: ${loginUrl}`] : []),
    "",
    "If you did not make this change, please reset your password immediately from the login page.",
  ].join("\n");

  return { to, subject, html, text };
}

function buildVerifyEmail({ to, name, verifyUrl, ttlHours = 24 }) {
  const expiryLabel = formatDurationHours(ttlHours);
  const subject = "Verify your ClassDex email address";
  const bodyHtml = `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1c2940;">
      Welcome to ClassDex! Please confirm your email address so your account recovery and classroom notifications stay connected.
    </p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#65738a;">
      This verification link expires in <strong>${escapeHtml(expiryLabel)}</strong>. If you did not create a ClassDex account, you can safely ignore this message.
    </p>
  `;
  const html = wrapEmailLayout({
    preheader: `Confirm your ClassDex email address (valid for ${expiryLabel}).`,
    heading: "Verify your email address",
    greetingName: name,
    bodyHtml,
    ctaLabel: "Verify email address",
    ctaUrl: verifyUrl,
  });
  const text = [
    `Hello ${name || "there"},`,
    "",
    "Welcome to ClassDex! Please confirm your email address using the link below:",
    "",
    verifyUrl,
    "",
    `This link expires in ${expiryLabel}. If you did not create a ClassDex account, you can safely ignore this message.`,
  ].join("\n");

  return { to, subject, html, text };
}

module.exports = {
  buildResetPasswordEmail,
  buildPasswordChangedEmail,
  buildVerifyEmail,
};
