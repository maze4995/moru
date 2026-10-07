import { authorize, checkOrigin, failure, HttpError } from "@/server/firebase";
import { connectionStatus, revoke } from "@/server/mcp-oauth";
import { json } from "@/server/mcp-protocol";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try { const user = await authorize(req); return json(await connectionStatus(user.uid)); }
  catch(e) { return failure(e); }
}
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    if (req.headers.get("origin") !== process.env.APP_ORIGIN) throw new HttpError(403, "요청 출처를 확인하세요");
    const user = await authorize(req);
    await revoke(user.uid);
    return json(await connectionStatus(user.uid));
  } catch(e) { return failure(e); }
}

