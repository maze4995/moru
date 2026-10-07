import { authorize, failure } from "@/server/firebase";
import { oauthReady } from "@/server/calendar";
export async function GET(req: Request) {
  try {
    await authorize(req);
    return Response.json({
      emulator: !!process.env.FIRESTORE_EMULATOR_HOST,
      calendarConfigured: oauthReady(),
      scheduler: process.env.SCHEDULER_ENABLED === "true",
      emailMode: process.env.EMAIL_MODE || "test",
      emailConfigured: !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
      emailActive:
        process.env.SCHEDULER_ENABLED === "true" &&
        process.env.EMAIL_MODE === "live" &&
        !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    });
  } catch (e) {
    return failure(e);
  }
}
