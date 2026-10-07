import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createDotsMcp, BridgeError } from "@/integrations/dots-mcp";
import { executeDots } from "@/server/dots";
import { HttpError } from "@/server/firebase";
import { authenticateMcp } from "@/server/mcp-oauth";
import { mcpConfig, sameOrigin, json, oauthFailure, OAuthError } from "@/server/mcp-protocol";
export const runtime = "nodejs";
export const maxDuration = 30;
async function handle(req: Request) {
  try {
    sameOrigin(req);
    const access = await authenticateMcp(req);
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
    const server = createDotsMcp(async (tool, args) => {
      const required = /_(create|update)_/.test(tool) ? "moru:write" : "moru:read";
      if (!access.scope.split(" ").includes(required)) throw new BridgeError("권한이 부족합니다. 모루에 다시 연결하세요.");
      try { return await executeDots(access.uid, tool, args); }
      catch(e) { if (e instanceof HttpError) throw new BridgeError(e.message); throw e; }
    }, true);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 65536,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(req);
      // JSON-only responses are fully consumed before the per-request transport closes.
      const body = await response.text();
      return new Response(body || null, { status: response.status, headers: {
        ...Object.fromEntries(response.headers), "Cache-Control": "no-store",
      } });
    } finally { await server.close(); }
  } catch(e) {
    if (e instanceof OAuthError && e.status === 401) {
      const { origin } = mcpConfig();
      return json({ error: "invalid_token" }, 401, {
        "WWW-Authenticate": 'Bearer resource_metadata="' + origin + '/.well-known/oauth-protected-resource", error="invalid_token"',
      });
    }
    return oauthFailure(e);
  }
}
export { handle as POST, handle as GET, handle as DELETE };

