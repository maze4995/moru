import { authorize, checkOrigin, failure, HttpError } from "@/server/firebase";
import {
  beginConnect,
  connectionRef,
  disconnect,
  fetchEvents,
  listCalendars,
  oauthReady,
  selectCalendars,
} from "@/server/calendar";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    const user = await authorize(req),
      url = new URL(req.url),
      action = url.searchParams.get("action");
    if (action === "events")
      return Response.json(
        await fetchEvents(
          user.uid,
          url.searchParams.get("from") || "",
          url.searchParams.get("to") || "",
        ),
      );
    if (action === "calendars")
      return Response.json(await listCalendars(user.uid));
    const d = (await connectionRef(user.uid).get()).data();
    return Response.json({
      configured: oauthReady(),
      connected: !!d,
      selected: d?.selected || [],
      lastSync: d?.lastSync || null,
      error: d?.error || null,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const user = await authorize(req),
      body = await req.json();
    if (body.action === "connect") {
      const { state, url } = await beginConnect(user.uid);
      return Response.json(
        { url },
        {
          headers: {
            "Set-Cookie": `moru_oauth=${state}; HttpOnly; SameSite=Lax; Path=/api/calendar; Max-Age=600${process.env.APP_ORIGIN?.startsWith("https:") ? "; Secure" : ""}`,
          },
        },
      );
    }
    if (body.action === "select") {
      await selectCalendars(user.uid, body.ids);
      return Response.json({ ok: true });
    }
    if (body.action === "disconnect")
      return Response.json(await disconnect(user.uid));
    throw new HttpError(400, "잘못된 작업");
  } catch (e) {
    return failure(e);
  }
}
