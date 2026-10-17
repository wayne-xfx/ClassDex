import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
      let scriptElement = existing;
      const fail = () => {
        scriptPromise = null;
        scriptElement?.remove();
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
      scriptElement = script;
      script.onerror = fail;
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

const RecaptchaWidget = forwardRef(function RecaptchaWidget({ onChange, onClose, returnFocusRef }, ref) {
  const { theme } = useTheme();
  const containerRef = useRef(null);
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const widgetIdRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const onCloseRef = useRef(onClose);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 340px)").matches);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useImperativeHandle(ref, () => ({
    reset() {
      onChangeRef.current?.("");
      if (widgetIdRef.current !== null && window.grecaptcha?.reset) window.grecaptcha.reset(widgetIdRef.current);
    },
  }), []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 340px)");
    const update = () => setCompact(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), iframe, [href], [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => returnFocusRef?.current?.focus());
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [returnFocusRef]);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    loadRecaptchaScript().then((grecaptcha) => {
      if (cancelled || !container) return;
      if (typeof grecaptcha.render !== "function") throw new Error("Security check is unavailable. Retry.");
      container.replaceChildren();
      widgetIdRef.current = grecaptcha.render(container, {
        sitekey: SITE_KEY,
        theme,
        size: compact ? "compact" : "normal",
        callback(token) { onChangeRef.current?.(token || ""); setError(""); },
        "expired-callback"() { onChangeRef.current?.(""); setError("Security check expired. Please try again."); },
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
      container?.replaceChildren();
      onChangeRef.current?.("");
    };
  }, [attempt, compact, theme]);

  return createPortal(
    <div className="captcha-modal-backdrop">
      <section className="captcha-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="captcha-modal-title" tabIndex={-1}>
        <button ref={closeButtonRef} type="button" className="captcha-modal-close" aria-label="Close security check" onClick={() => onCloseRef.current?.()}>
          <span aria-hidden="true">×</span>
        </button>
        <h2 id="captcha-modal-title">Security check</h2>
        <div className="recaptcha-widget">
          <div className="recaptcha-frame" aria-label="Security check">
            <div key={`${theme}-${compact ? "compact" : "normal"}-${attempt}`} ref={containerRef} />
          </div>
          {status === "loading" ? <span className="field-hint" role="status">Loading security check…</span> : null}
          {error ? <div className="recaptcha-retry"><span className="field-hint" role="status">{error}</span>{status === "error" ? <button type="button" className="button button-quiet" onClick={() => { setStatus("loading"); setError(""); setAttempt((value) => value + 1); }}>Retry</button> : null}</div> : null}
        </div>
      </section>
    </div>,
    document.body,
  );
});

export default RecaptchaWidget;
