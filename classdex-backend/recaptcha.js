const VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";

async function verifyRecaptchaToken(token, remoteIp) {
  if (!token || !String(token).trim()) {
    return { success: false, message: "Captcha token is required." };
  }
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) return { success: false, message: "Captcha verification is not configured on the server." };

  try {
    const body = new URLSearchParams({
      secret,
      response: String(token).trim(),
    });
    if (remoteIp) {
      body.set("remoteip", remoteIp);
    }

    const response = await fetch(VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!response.ok) return { success: false, message: "Captcha verification is temporarily unavailable." };
    const payload = await response.json().catch(() => null);
    if (!payload?.success) console.error("reCAPTCHA rejected token; Google error-codes:", payload?.["error-codes"] || ["invalid-response"]);
    return payload?.success
      ? { success: true }
      : { success: false, message: "Captcha verification failed. Please complete the security check again.", errorCodes: payload?.["error-codes"] || [] };
  } catch (error) {
    console.error("reCAPTCHA verification request failed:", error?.message || "unknown error");
    return { success: false, message: "Captcha verification is temporarily unavailable." };
  }
}

module.exports = {
  verifyRecaptchaToken,
};
