import { createLocalJWKSet, jwtVerify } from "jose";
import { clientIdAllowed, limitedText, mcpConfig, OAuthError, hash } from "./mcp-protocol";

export async function clientMetadata(clientId: string) {
  if (!clientIdAllowed(clientId)) throw new OAuthError("invalid_client");
  let response;
  try { response = await fetch(clientId, { redirect: "error", signal: AbortSignal.timeout(5000), cache: "no-store" }); }
  catch { throw new OAuthError("temporarily_unavailable", 503); }
  if (!response.ok) throw new OAuthError("invalid_client");
  let metadata;
  try { metadata = JSON.parse(await limitedText(response)); } catch { throw new OAuthError("invalid_client"); }
  if (metadata.client_id !== clientId || !Array.isArray(metadata.redirect_uris)) throw new OAuthError("invalid_client");
  const methods: string[] = Array.isArray(metadata.token_endpoint_auth_methods_supported)
    ? metadata.token_endpoint_auth_methods_supported : [metadata.token_endpoint_auth_method || "none"];
  return { ...metadata, methods } as { client_id: string; redirect_uris: string[]; methods: string[]; jwks_uri?: string };
}
export async function verifyClient(input: Record<string, string>) {
  const metadata = await clientMetadata(input.client_id);
  if (!input.client_assertion && !input.client_assertion_type) {
    if (!metadata.methods.includes("none")) throw new OAuthError("invalid_client", 401);
    return null;
  }
  if (!metadata.methods.includes("private_key_jwt") ||
      input.client_assertion_type !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer" ||
      !input.client_assertion || input.client_assertion.length > 10000 ||
      metadata.jwks_uri !== "https://chatgpt.com/oauth/jwks.json") throw new OAuthError("invalid_client", 401);
  try {
    const response = await fetch(metadata.jwks_uri, { redirect: "error", signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!response.ok) throw new Error();
    const jwks = JSON.parse(await limitedText(response, 65536));
    const { payload } = await jwtVerify(input.client_assertion, createLocalJWKSet(jwks), {
      algorithms: ["RS256"], issuer: input.client_id, subject: input.client_id,
      audience: mcpConfig().origin + "/oauth/token", requiredClaims: ["iss","sub","aud","exp","iat","jti"],
      maxTokenAge: 300, clockTolerance: 5,
    });
    const now = Date.now() / 1000;
    if (typeof payload.exp !== "number" || payload.exp > now + 305 || typeof payload.jti !== "string" ||
        !payload.jti || payload.jti.length > 256) throw new Error();
    return { hash: hash(input.client_id + ":" + payload.jti), expiresAt: (payload.exp + 5) * 1000 };
  } catch { throw new OAuthError("invalid_client", 401); }
}

