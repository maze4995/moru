import { mcpConfig, SCOPES, json, oauthFailure } from "@/server/mcp-protocol";
export const dynamic = "force-dynamic";
export function GET() {
  try {
    const { origin } = mcpConfig();
    return json({ issuer: origin, authorization_endpoint: origin + "/oauth/authorize",
      token_endpoint: origin + "/oauth/token", response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
      token_endpoint_auth_signing_alg_values_supported: ["RS256"], code_challenge_methods_supported: ["S256"],
      scopes_supported: SCOPES, client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true });
  } catch(e) { return oauthFailure(e); }
}

