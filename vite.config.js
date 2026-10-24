import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { loadEnv } from "./scripts/_env.mjs";

// Yerel geliştirmede /api/* isteklerini Vercel'deki aynı işleyicilere yönlendirir (ayrı sunucu yok).
function apiDev() {
  return {
    name: "takas-api-dev",
    configureServer(server) {
      loadEnv();
      process.env.HOST_TOKEN ||= "dev-token";
      server.middlewares.use(async (req, res, next) => {
        const m = req.url?.match(/^\/api\/([a-z]+)(\?.*)?$/);
        if (!m) return next();
        try {
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const raw = Buffer.concat(chunks).toString("utf8");
          req.body = raw ? JSON.parse(raw) : {};
          const out = {
            setHeader: (k, v) => res.setHeader(k, v),
            status(code) {
              res.statusCode = code;
              return out;
            },
            json(o) {
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify(o));
            },
          };
          const file = pathToFileURL(resolve("api", `${m[1]}.js`)).href + `?t=${Date.now()}`;
          const mod = await import(file);
          await mod.default(req, out);
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(e.message || e) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiDev()],
  build: { chunkSizeWarningLimit: 1200 },
});
