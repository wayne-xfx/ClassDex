import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "../../../classdex-frontend/node_modules/vite/dist/node/index.js";
import react from "../../../classdex-frontend/node_modules/@vitejs/plugin-react/dist/index.js";
import tailwindcss from "../../../classdex-frontend/node_modules/@tailwindcss/vite/dist/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "../../../classdex-frontend");
const backendPort = Number(process.env.E2E_BACKEND_PORT || 5051);

export default defineConfig({
  root: frontendRoot,
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
});
