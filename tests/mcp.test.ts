import { afterEach, describe, it, expect, vi } from "vitest";
import { mcpConfig, parseAuthorization, paramsObject, pkce, scopes, limitedText } from "../src/server/mcp-protocol";
import { validateAuthorization } from "../src/server/mcp-oauth";
const origin = "https://moru-test.example";
const client = "https://chatgpt.com/oauth/client.json";
const redirect = "https://chatgpt.com/connector_platform/oauth/callback";
const request = () => ({ response_type: "code", client_id: client, redirect_uri: redirect,
  resource: origin + "/api/mcp", scope: "moru:read moru:write", state: "test-state",
  code_challenge: pkce("v".repeat(43)), code_challenge_method: "S256" });
function configure() { vi.stubEnv("MORU_MCP_ENABLED", "true"); vi.stubEnv("APP_ORIGIN", origin); }
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("MCP OAuth protocol boundaries", () => {
  it("is disabled by default and pins the canonical issuer, never request headers", () => {
    vi.stubEnv("MORU_MCP_ENABLED", "false");
    expect(mcpConfig).toThrow();
    configure();
    expect(mcpConfig()).toEqual({origin,resource:origin+"/api/mcp"});
    for (const value of ["http://example.com", origin+"/path", origin+"/", "https://user:pass@example.com"]) {
      vi.stubEnv("APP_ORIGIN",value); expect(mcpConfig).toThrow();
    }
  });
  it("requires PKCE S256, the exact resource, allowed scopes and OpenAI client metadata", () => {
    configure(); expect(parseAuthorization(request()).scope).toBe("moru:read moru:write");
    for (const patch of [
      {resource:"https://evil.test/api/mcp"}, {code_challenge_method:"plain"}, {scope:"moru:read admin"},
      {client_id:"https://chatgpt.com.evil.test/oauth/client.json"},
      {client_id:"https://chatgpt.com/oauth/../client.json"},
      {redirect_uri:"https://evil.test/callback"}, {redirect_uri:redirect+"#token"},
      {state:""}, {code_challenge:"short"},
    ]) expect(() => parseAuthorization({...request(),...patch})).toThrow();
    expect(() => scopes("moru:write")).toThrow();
    expect(() => paramsObject(new URLSearchParams("state=a&state=b"))).toThrow();
  });
  it("resolves only the pinned client host and requires the exact registered callback", async () => {
    configure();
    const mocked = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      client_id:client,redirect_uris:[redirect],token_endpoint_auth_method:"none",
    })));
    vi.stubGlobal("fetch",mocked);
    expect(await validateAuthorization(request())).toMatchObject({client_id:client});
    expect(mocked.mock.calls[0][1]).toMatchObject({redirect:"error",cache:"no-store"});
    await expect(validateAuthorization({...request(),redirect_uri:redirect+"/wrong"})).rejects.toThrow();
    await expect(validateAuthorization({...request(),client_id:"http://127.0.0.1/internal"})).rejects.toThrow();
    expect(mocked).toHaveBeenCalledTimes(2);
  });
  it("limits streamed bodies even without Content-Length", async () => {
    await expect(limitedText(new Response("x".repeat(16385)))).rejects.toThrow();
    expect(await limitedText(new Response("safe"))).toBe("safe");
  });
});

