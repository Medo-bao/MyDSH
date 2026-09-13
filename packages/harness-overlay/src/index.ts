import { createHmac } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

interface HostContext {
  webServer: { register(route: {
    kind: "exact";
    path: string;
    handler(req: IncomingMessage, res: ServerResponse): void;
  }): () => void };
  effect(factory: () => () => void): void;
}

export const inject = ["webServer"];

/** Prove possession of the launch secret without exposing it to the listener. */
export function apply(ctx: HostContext): void {
  const secret = process.env.FIREFLY_HARNESS_SECRET;
  delete process.env.FIREFLY_HARNESS_SECRET;
  if (secret === undefined) return;
  if (!/^[a-f0-9]{64}$/u.test(secret)) throw new Error("Invalid desktop launch secret");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/firefly-desktop-identity",
    handler(req, res) {
      const authority = `127.0.0.1:${req.socket.localPort}`;
      const challenge = new URL(req.url ?? "/", `http://${authority}`).searchParams.get("challenge");
      if (req.method !== "GET" || req.headers.host !== authority
        || req.headers.origin !== undefined || !/^[a-f0-9]{64}$/u.test(challenge ?? "")) {
        res.writeHead(403); res.end(); return;
      }
      const proof = createHmac("sha256", secret).update(`${authority}\n${challenge}`).digest("hex");
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ proof }));
    },
  }));
}

export default { inject, apply };
