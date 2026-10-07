import { runReminders } from "../src/server/reminders";
// Independent server process. A process supervisor/cron is required in production.
async function tick() {
  try {
    const result = await runReminders();
    console.log("Reminder cycle", result);
  } catch {
    console.error(
      "Reminder cycle failed. Check Firebase and owner configuration.",
    );
  }
}
await tick();
if (!process.argv.includes("--once")) setInterval(() => void tick(), 60000);
