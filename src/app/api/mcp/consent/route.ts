import { authorize, failure } from "@/server/firebase";
import { consent, validateAuthorization } from "@/server/mcp-oauth";
import { sameOrigin, limitedText, paramsObject, OAuthError, json, oauthFailure } from "@/server/mcp-protocol";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    sameOrigin(req);
    await authorize(req);
    const input = paramsObject(new URL(req.url).searchParams);
    const value = await validateAuthorization(input);
    return json({ client: "ChatGPT / dots", scope: value.scope, redirect: new URL(value.redirect_uri).origin });
  } catch(e) { return e instanceof OAuthError ? oauthFailure(e) : failure(e); }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req, true);
    const user = await authorize(req);
    if (!req.headers.get("content-type")?.startsWith("application/json")) throw new OAuthError("invalid_request", 415);
    let body;
    try { body = JSON.parse(await limitedText(req)); } catch(e) {
      if (e instanceof OAuthError) throw e;
      throw new OAuthError("invalid_request");
    }
    if (typeof body.allow !== "boolean") throw new OAuthError("invalid_request");
    return json({ redirect: await consent(user.uid, body.parameters, body.allow) });
  } catch(e) { return e instanceof OAuthError ? oauthFailure(e) : failure(e); }
}

