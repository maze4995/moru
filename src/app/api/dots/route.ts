import { dotsEnvelope } from "@/domain/dots";
import { authorizeDots, executeDots } from "@/server/dots";
import { failure, HttpError } from "@/server/firebase";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const uid = await authorizeDots(req);
    if (!req.headers.get("content-type")?.startsWith("application/json"))
      throw new HttpError(415, "JSON 요청이 필요합니다");
    const reader = req.body?.getReader();
    if (!reader) throw new HttpError(400, "요청이 비어 있습니다");
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65536) {
        await reader.cancel();
        throw new HttpError(413, "요청이 너무 큽니다");
      }
      chunks.push(value);
    }
    let raw;
    try {
      raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new HttpError(400, "잘못된 JSON 요청입니다");
    }
    const body = dotsEnvelope.parse(raw);
    return Response.json(await executeDots(uid, body.tool, body.arguments), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
