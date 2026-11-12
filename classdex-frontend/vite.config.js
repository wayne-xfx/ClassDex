import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const GOOGLE_RECAPTCHA_TEST_SITE_KEY = "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI";
const GOOGLE_RECAPTCHA_TEST_SECRET_KEY = "6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const siteKey = String(
    process.env.VITE_RECAPTCHA_SITE_KEY ?? env.VITE_RECAPTCHA_SITE_KEY ?? "",
  ).trim();

  if (
    command === "build" &&
    mode === "production" &&
    (siteKey === GOOGLE_RECAPTCHA_TEST_SITE_KEY ||
      siteKey === GOOGLE_RECAPTCHA_TEST_SECRET_KEY)
  ) {
    throw new Error(
      "[ClassDex Build] Refusing production build with Google's public reCAPTCHA test key in VITE_RECAPTCHA_SITE_KEY.",
    );
  }

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        "/api": {
          target: "http://localhost:5000",
          changeOrigin: true,
        },
      },
    },
  };
});
