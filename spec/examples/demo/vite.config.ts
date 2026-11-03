import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Connect, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { decide, recordEvent, useExampleFiles } from "./nudges.ts";

const demoDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(demoDir, "../../..");
useExampleFiles(path.resolve(demoDir, ".."));

function nudgesApi(): Plugin {
  return {
    name: "nudges-demo-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req: Connect.IncomingMessage, res, next) => {
        const pathname = new URL(req.url ?? "/", "http://demo.local").pathname;
        if (pathname !== "/api/nudges/decide" && pathname !== "/api/nudges/events") {
          next();
          return;
        }
        void readBody(req)
          .then((raw) => {
            const body = raw ? JSON.parse(raw) : {};
            if (pathname === "/api/nudges/decide") {
              const location = typeof body.location === "string" ? body.location : "";
              sendJson(res, decide(location, body.context));
              return;
            }
            recordEvent(body);
            res.statusCode = 204;
            res.end();
          })
          .catch((err) => {
            console.log("[nudges] bad request", err instanceof Error ? err.message : err);
            res.statusCode = 400;
            res.end();
          });
      });
    },
  };
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: Connect.ServerResponse, value: unknown) {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(value));
}

export default defineConfig({
  plugins: [react(), nudgesApi()],
  resolve: { dedupe: ["react", "react-dom"] },
  server: { fs: { allow: [repoRoot] } },
});
