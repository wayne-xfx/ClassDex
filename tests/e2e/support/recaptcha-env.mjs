import dns from "node:dns";

dns.setDefaultResultOrder("ipv4first");

const staticCache = new Map();

const FORWARD_REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "content-type",
  "origin",
  "referer",
  "user-agent",
]);

const STRIP_RESPONSE_HEADERS = new Set([
  "alt-svc",
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "set-cookie",
  "transfer-encoding",
]);

function isCacheableStatic(method, url) {
  if (method !== "GET") return false;
  return (
    url.startsWith("https://www.gstatic.com/recaptcha/") ||
    url.startsWith("https://www.google.com/recaptcha/api.js")
  );
}

function buildUpstreamHeaders(reqHeaders) {
  const out = {};
  for (const [k, v] of Object.entries(reqHeaders || {})) {
    const key = k.toLowerCase();
    if (FORWARD_REQUEST_HEADERS.has(key) && typeof v === "string" && v.length > 0) {
      out[key] = v;
    }
  }
  return out;
}

function sanitizeResponseHeaders(resHeaders) {
  const out = {};
  for (const [k, v] of resHeaders.entries()) {
    const key = k.toLowerCase();
    if (!STRIP_RESPONSE_HEADERS.has(key)) {
      out[key] = v;
    }
  }
  return out;
}

async function fetchWithIpv4Retry(url, init) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(8_000),
      });
      const body = Buffer.from(await response.arrayBuffer());
      const headers = sanitizeResponseHeaders(response.headers);
      return { status: response.status, headers, body };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Forces Google reCAPTCHA browser requests through Node's IPv4-first HTTPS stack
 * with bounded timeout + retry and caches immutable gstatic/api.js assets, avoiding
 * headless Chromium/WebKit IPv6 ENETUNREACH and QUIC/HTTP3 stalls in test runs.
 */
export async function installRecaptchaIpv4Relay(page) {
  const handler = async (route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method().toUpperCase();
    const headers = buildUpstreamHeaders(request.headers());
    const cacheKey = isCacheableStatic(method, url)
      ? `${headers["user-agent"] || ""}|${url}`
      : null;

    try {
      if (cacheKey && staticCache.has(cacheKey)) {
        const cached = staticCache.get(cacheKey);
        await route.fulfill({
          status: cached.status,
          headers: cached.headers,
          body: cached.body,
        });
        return;
      }

      const postBody =
        method !== "GET" && method !== "HEAD" ? request.postDataBuffer() : null;

      const result = await fetchWithIpv4Retry(url, {
        method,
        headers,
        body: postBody && postBody.length > 0 ? postBody : undefined,
      });

      if (cacheKey && result.status === 200) {
        staticCache.set(cacheKey, result);
      }

      await route.fulfill({
        status: result.status,
        headers: result.headers,
        body: result.body,
      });
    } catch {
      await route.abort("timedout").catch(() => {});
    }
  };

  await page.route("https://www.google.com/recaptcha/**", handler);
  await page.route("https://www.gstatic.com/recaptcha/**", handler);
}
