import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTheme } from "../context/useTheme";

const SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY || "";
const CALLBACK_NAME = "__classDexRecaptchaReady";
let scriptPromise;

function loadRecaptchaScript() {
  if (window.grecaptcha?.render) return Promise.resolve(window.grecaptcha);
  if (!SITE_KEY) return Promise.reject(new Error("Captcha is not configured. Ask an administrator to set the site key."));
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-classdex-recaptcha="true"]');
      const fail = () => {
        scriptPromise = null;
        existing?.remove();
        reject(new Error("Could not load the security check. Retry."));
      };
      window[CALLBACK_NAME] = () => {
        if (window.grecaptcha?.render) resolve(window.grecaptcha);
        else fail();
      };
      if (existing) {
        existing.addEventListener("load", () => {
          if (window.grecaptcha?.render) resolve(window.grecaptcha);
          else fail();
        }, { once: true });
        existing.addEventListener("error", fail, { once: true });
        if (window.grecaptcha?.render) resolve(window.grecaptcha);
        return;
      }
      const script = document.createElement("script");
      script.async = true;
      script.defer = true;
      script.dataset.classdexRecaptcha = "true";
      script.src = `https://www.google.com/recaptcha/api.js?render=explicit&onload=${CALLBACK_NAME}`;
      script.onerror = fail;
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

const RecaptchaWidget = forwardRef(function RecaptchaWidget({ onChange, label = "Complete the security check" }, ref) {
  const { theme } = useTheme();
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 380px)").matches);
  onChangeRef.current = onChange;

  useImperativeHandle(ref, () => ({
    reset() {
      onChangeRef.current?.("");
      if (widgetIdRef.current !== null && window.grecaptcha?.reset) window.grecaptcha.reset(widgetIdRef.current);
    },
  }), []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 380px)");
    const update = () => setCompact(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    loadRecaptchaScript().then((grecaptcha) => {
      if (cancelled || !containerRef.current) return;
      if (typeof grecaptcha.render !== "function") throw new Error("Security check is unavailable. Retry.");
      containerRef.current.replaceChildren();
      widgetIdRef.current = grecaptcha.render(containerRef.current, {
        sitekey: SITE_KEY,
        theme,
        size: compact ? "compact" : "normal",
        callback(token) { onChangeRef.current?.(token || ""); setError(""); },
        "expired-callback"() { onChangeRef.current?.(""); },
        "error-callback"() { onChangeRef.current?.(""); setError("Security check failed. Retry."); },
      });
      setStatus("ready");
    }).catch((loadError) => {
      if (!cancelled) { setStatus("error"); setError(loadError.message); }
    });
    return () => {
      cancelled = true;
      if (widgetIdRef.current !== null && window.grecaptcha?.reset) {
        try { window.grecaptcha.reset(widgetIdRef.current); } catch { /* Google may already have torn down the frame. */ }
      }
      widgetIdRef.current = null;
      containerRef.current?.replaceChildren();
      onChangeRef.current?.("");
    };
  }, [attempt, compact, theme]);

  return (
    <div className="recaptcha-widget">
      <span className="field-hint">{label}</span>
      <div className="recaptcha-frame" ref={containerRef} aria-label={label} />
      {status === "loading" ? <span className="field-hint">Loading security check…</span> : null}
      {status === "error" ? <div className="recaptcha-retry"><span className="field-hint" role="status">{error}</span><button type="button" className="button button-quiet" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div> : null}
    </div>
  );
});

export default RecaptchaWidget;
