const TEST_SECRET = "6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe";
const VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";

function getRecaptchaSecret() {
  return process.env.RECAPTCHA_SECRET_KEY || TEST_SECRET;
}

async function verifyRecaptchaToken(token, remoteIp) {
  const secret = getRecaptchaSecret();
  if (!token || !String(token).trim()) {
    return false;
  }

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
    if (!response.ok) {
      return false;
    }
    const payload = await response.json().catch(() => null);
    return Boolean(payload?.success);
  } catch (error) {
    console.error("reCAPTCHA verification failed:", error);
    return false;
  }
}

module.exports = {
  verifyRecaptchaToken,
};
