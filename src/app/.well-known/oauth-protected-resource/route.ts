import { mcpConfig, SCOPES, json, oauthFailure } from "@/server/mcp-protocol";
export const dynamic = "force-dynamic";
export function GET() {
  try {
    const { origin, resource } = mcpConfig();
    return json({ resource, authorization_servers: [origin], scopes_supported: SCOPES,
      bearer_methods_supported: ["header"], resource_name: "모루 개인 일정" });
  } catch(e) { return oauthFailure(e); }
}

