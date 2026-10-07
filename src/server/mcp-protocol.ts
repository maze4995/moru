import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const SCOPES = ["moru:read", "moru:write"] as const;
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const pkce = (value: string) => createHash("sha256").update(value).digest("base64url");
export const equal = (a: string, b: string) => timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
export class OAuthError extends Error {
  constructor(public error: string, public status = 400) { super(error); }
}
export function mcpConfig() {
  if (process.env.MORU_MCP_ENABLED !== "true") throw new OAuthError("temporarily_unavailable", 503);
  const origin = process.env.APP_ORIGIN || "";
  let url: URL;
  try { url = new URL(origin); } catch { throw new OAuthError("temporarily_unavailable", 503); }
  const local = process.env.FIREBASE_PROJECT_ID?.startsWith("demo-") &&
    !!process.env.FIRESTORE_EMULATOR_HOST && !!process.env.FIREBASE_AUTH_EMULATOR_HOST &&
    ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.origin !== origin || url.username || url.password || !(url.protocol === "https:" || (local && url.protocol === "http:")))
    throw new OAuthError("temporarily_unavailable", 503);
  return { origin, resource: origin + "/api/mcp" };
}
export function enabled() { try { mcpConfig(); return true; } catch { return false; } }
export function clientIdAllowed(id: string) {
  return /^https:\/\/chatgpt\.com\/oauth\/(?:[A-Za-z0-9_-]{1,160}\/)?client\.json$/.test(id);
}
export function scopes(value: string) {
  const values = [...new Set(value.split(" "))].filter(Boolean);
  if (!values.includes("moru:read") || values.some(v => !SCOPES.includes(v as typeof SCOPES[number])))
    throw new OAuthError("invalid_scope");
  return SCOPES.filter(v => values.includes(v)).join(" ");
}
export function paramsObject(params: URLSearchParams) {
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    if (Object.hasOwn(result, key)) throw new OAuthError("invalid_request");
    result[key] = value;
  }
  return result;
}
const authorizeSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().max(256).refine(clientIdAllowed),
  redirect_uri: z.string().url().max(2048),
  resource: z.string().max(2048),
  scope: z.string().max(100),
  state: z.string().min(1).max(2048),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal("S256"),
});
export type Authorization = z.infer<typeof authorizeSchema>;
export function parseAuthorization(raw: unknown): Authorization {
  const parsed = authorizeSchema.safeParse(raw);
  if (!parsed.success) throw new OAuthError("invalid_request");
  const data = parsed.data;
  if (data.resource !== mcpConfig().resource) throw new OAuthError("invalid_target");
  const redirect = new URL(data.redirect_uri);
  if (redirect.origin !== "https://chatgpt.com" || redirect.username || redirect.password || redirect.hash)
    throw new OAuthError("invalid_request");
  return { ...data, scope: scopes(data.scope) };
}
export async function limitedText(req: Request | Response, max = 16384) {
  const reader = req.body?.getReader();
  if (!reader) throw new OAuthError("invalid_request");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > max) { await reader.cancel(); throw new OAuthError("invalid_request", 413); }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache", ...headers } });
}
export function oauthFailure(error: unknown) {
  return error instanceof OAuthError ? json({ error: error.error }, error.status) : json({ error: "server_error" }, 500);
}
export function sameOrigin(req: Request, required = false) {
  const origin = req.headers.get("origin");
  if ((required || origin) && origin !== mcpConfig().origin) throw new OAuthError("access_denied", 403);
}

