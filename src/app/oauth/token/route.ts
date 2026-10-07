import { exchange } from "@/server/mcp-oauth";
import { limitedText, paramsObject, sameOrigin, OAuthError, json, oauthFailure } from "@/server/mcp-protocol";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    if (req.headers.has("authorization")) throw new OAuthError("invalid_client", 401);
    if (!req.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded"))
      throw new OAuthError("invalid_request", 415);
    const input = paramsObject(new URLSearchParams(await limitedText(req)));
    return json(await exchange(input));
  } catch(e) { return oauthFailure(e); }
}

