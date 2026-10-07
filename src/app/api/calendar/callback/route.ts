import { completeConnect } from "@/server/calendar";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const url = new URL(req.url),
    state = url.searchParams.get("state"),
    cookie = req.headers
      .get("cookie")
      ?.split("; ")
      .find((v) => v.startsWith("moru_oauth="))
      ?.slice(11);
  let outcome = "error";
  try {
    if (state && cookie === state && !url.searchParams.has("error")) {
      await completeConnect(state, url.searchParams.get("code") || "");
      outcome = "connected";
    }
  } catch {
    /* Deliberately do not log codes or token responses. */
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${process.env.APP_ORIGIN}/?calendar=${outcome}`,
      "Set-Cookie":
        "moru_oauth=; HttpOnly; SameSite=Lax; Path=/api/calendar; Max-Age=0",
    },
  });
}
