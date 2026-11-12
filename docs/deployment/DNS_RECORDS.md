# ClassDex — Final Namecheap DNS Records (`classdex.me`)

**Registrar / DNS Provider:** Namecheap (`BasicDNS` default nameservers)  
**Canonical Web Origin:** `https://classdex.me`  
**Canonical API Origin:** `https://api.classdex.me`  
**Verified Live:** `2026-11-12` (`1.1.1.1` + system resolver + `curl -I`)

---

## 1. Active DNS Record Table

*(Public DNS records only — zero secrets.)*

| Owner / Purpose | Type | Namecheap `Host` | FQDN | Target / Value | Notes |
|---|---|---|---|---|---|
| **Web (Vercel)** | `A` | `@` | `classdex.me` | `216.198.79.1` | Apex points directly to Vercel edge |
| **Web (Vercel)** | `CNAME` | `www` | `www.classdex.me` | `classdex.me` | Vercel returns `308 Permanent Redirect` → `https://classdex.me/` |
| **API (Render)** | `CNAME` | `api` | `api.classdex.me` | `classdex-api.onrender.com` | Verified + TLS certificate issued on Render; shares registrable domain for `SameSite=Lax` cookies |
| **Email (Resend DKIM)** | `TXT` | `resend._domainkey` | `resend._domainkey.classdex.me` | `p=MIGfMA0G...IDAQAB` *(public DKIM key)* | Required by Resend for DKIM (`PASS` confirmed in Gmail) |
| **Email (Resend Return-Path)** | `CNAME` | `send` | `send.classdex.me` | `send.forge.rmta.net` | Preserved untouched from initial setup |
| **Email (Resend Bounce/Tracking)** | `CNAME` | `rsend` | `rsend.classdex.me` | `rsend-apne1.forge.rmta.net` | Preserved untouched from initial setup |
| **Email (DMARC Policy)** | `TXT` | `_dmarc` | `_dmarc.classdex.me` | `v=DMARC1; p=none;` | Preserved untouched; DMARC `PASS` confirmed in Gmail |
| **Email (Forwarding SPF)** | `TXT` | `@` | `classdex.me` | `v=spf1 include:spf.efwd.registrar-servers.com ~all` | Preserved untouched for Namecheap Email Forwarding |
| **Email (Forwarding MX)** | `MX` | `@` | `classdex.me` | `eforward1..5.registrar-servers.com` *(prio 10/15/20)* | Preserved untouched from Namecheap Email Forwarding |

---

## 2. Migration Summary (Before vs. After)

- **Removed:** Old GitHub Pages `185.199.x.x` `A` records on `@` (and ensured no Namecheap parking or `URL Redirect` intercepted `@` or `www`).
- **Updated:** Apex `@` pointed to Vercel (`216.198.79.1`), `www` configured in Vercel as `308 -> https://classdex.me/`, and `api` pointed via CNAME to `classdex-api.onrender.com`.
- **Preserved Untouched:** Every Resend (`resend._domainkey`, `send`, `rsend`, `_dmarc`) and Namecheap Email Forwarding (`SPF TXT` + `MX`) record was verified identical before and after migration (`1.1.1.1`).
- **Certificate Issuance / CAA:** No blocking CAA records exist; both Vercel (`classdex.me`, `www.classdex.me`) and Render (`api.classdex.me`) issued HTTPS certificates automatically.

---

## 3. Why `api.classdex.me` Is Required (Cookie / CORS Security)

Serving the frontend at `https://classdex.me` and the backend at `https://api.classdex.me` keeps both origins on the same registrable domain (`classdex.me`). As a result, `classdex.sid` stays **`SameSite=Lax; Secure; HttpOnly`** without weakening cookies to `SameSite=None`. CORS on Render permits only the exact canonical origin `https://classdex.me`.
