import { z } from "zod";
import { authorize, checkOrigin, failure } from "@/server/firebase";
import { dotsStatus, setDotsAccess } from "@/server/dots";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    const user = await authorize(req);
    return Response.json(await dotsStatus(user.uid), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const user = await authorize(req);
    const body = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(await req.json());
    await setDotsAccess(user.uid, body.enabled);
    return Response.json(await dotsStatus(user.uid));
  } catch (e) {
    return failure(e);
  }
}
