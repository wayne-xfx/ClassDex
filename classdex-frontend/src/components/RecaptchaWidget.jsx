import { useEffect, useRef, useState } from "react";

const RECAPTCHA_SITE_KEY =
  import.meta.env.VITE_RECAPTCHA_SITE_KEY ||
  "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI";

let scriptPromise;

function loadRecaptchaScript() {
  if (window.grecaptcha?.render) {
    return Promise.resolve(window.grecaptcha);
  }
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-recaptcha="true"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(window.grecaptcha));
        existing.addEventListener("error", () => reject(new Error("Unable to load the verification widget.")));
        return;
      }

      const script = document.createElement("script");
      script.async = true;
      script.defer = true;
      script.dataset.recaptcha = "true";
      script.src = "https://www.google.com/recaptcha/api.js?render=explicit";
      script.onload = () => resolve(window.grecaptcha);
      script.onerror = () => reject(new Error("Unable to load the verification widget."));
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

export default function RecaptchaWidget({ onToken, onError, label = "Complete the security check" }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const tokenRef = useRef("");
  const onTokenRef = useRef(onToken);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let cancelled = false;
    loadRecaptchaScript()
      .then((grecaptcha) => {
        if (cancelled || !containerRef.current) return;
        widgetIdRef.current = grecaptcha.render(containerRef.current, {
          sitekey: RECAPTCHA_SITE_KEY,
          callback(token) {
            tokenRef.current = token || "";
            onTokenRef.current?.(tokenRef.current);
            setError("");
          },
          "expired-callback"() {
            tokenRef.current = "";
            onTokenRef.current?.("");
          },
          "error-callback"() {
            tokenRef.current = "";
            setError("The security check could not be loaded.");
            onError?.("The security check could not be loaded.");
          },
        });
        setStatus("ready");
      })
      .catch((loadError) => {
        if (cancelled) return;
        setStatus("error");
        setError(loadError.message);
        onError?.(loadError.message);
      });

    return () => {
      cancelled = true;
      tokenRef.current = "";
      if (window.grecaptcha?.reset && widgetIdRef.current !== null) {
        try {
          window.grecaptcha.reset(widgetIdRef.current);
        } catch {
          // Widget teardown is best-effort.
        }
      }
    };
  }, [onError]);

  return (
    <div className="recaptcha-widget">
      <span className="field-hint">{label}</span>
      <div ref={containerRef} aria-label={label} />
      {status === "loading" ? <span className="field-hint">Loading verification…</span> : null}
      {status === "error" ? <span className="field-error">{error}</span> : null}
    </div>
  );
}
