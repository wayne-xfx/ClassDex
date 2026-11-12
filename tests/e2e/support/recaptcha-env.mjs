import { createHash } from "node:crypto";
import dns from "node:dns";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

dns.setDefaultResultOrder("ipv4first");

const staticCache = new Map();
const DISK_CACHE_DIR = path.join(os.tmpdir(), "classdex-e2e-recaptcha-cache");
const DISK_CACHE_TTL_MS = 15 * 60 * 1000;

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

function getDiskCachePath(cacheKey) {
  const hash = createHash("sha256").update(cacheKey).digest("hex");
  return path.join(DISK_CACHE_DIR, `${hash}.json`);
}

function readCachedAsset(cacheKey) {
  if (!cacheKey) return null;
  if (staticCache.has(cacheKey)) return staticCache.get(cacheKey);
  try {
    const raw = fs.readFileSync(getDiskCachePath(cacheKey), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || Date.now() - Number(parsed.savedAt || 0) > DISK_CACHE_TTL_MS) {
      return null;
    }
    const entry = {
      status: parsed.status,
      headers: parsed.headers,
      body: Buffer.from(parsed.bodyBase64, "base64"),
    };
    staticCache.set(cacheKey, entry);
    return entry;
  } catch {
    return null;
  }
}

function writeCachedAsset(cacheKey, result) {
  if (!cacheKey || result.status !== 200) return;
  staticCache.set(cacheKey, result);
  try {
    fs.mkdirSync(DISK_CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      getDiskCachePath(cacheKey),
      JSON.stringify({
        savedAt: Date.now(),
        status: result.status,
        headers: result.headers,
        bodyBase64: result.body.toString("base64"),
      }),
      "utf8",
    );
  } catch {
    // Best-effort cross-worker static asset cache only.
  }
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
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(15_000),
      });
      const body = Buffer.from(await response.arrayBuffer());
      const headers = sanitizeResponseHeaders(response.headers);
      return { status: response.status, headers, body };
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
  }
  throw lastError;
}

/**
 * Forces Google reCAPTCHA browser requests through Node's IPv4-first HTTPS stack
 * with bounded timeout + retry and caches immutable gstatic/api.js assets across
 * Playwright project workers, avoiding IPv6 ENETUNREACH and CDN stalls mid-run.
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
      const cached = readCachedAsset(cacheKey);
      if (cached) {
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

      writeCachedAsset(cacheKey, result);

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
