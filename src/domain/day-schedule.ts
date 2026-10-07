import { DateTime } from "luxon";
import { confirmed, type Plan, type Task } from "./model";

// Half-open intervals preserve midnight and 23/25-hour DST days.
export function daySchedule(tasks: Task[], plans: Plan[], day: string, zone: string) {
  const start = DateTime.fromISO(day, { zone }).startOf("day"), end = start.plus({ days: 1 });
  const duration = end.toMillis() - start.toMillis(), laneEnds: number[] = [];
  const entries = tasks
    .filter(t => !t.deleted && !["취소", "보류"].includes(t.status) && confirmed(t, plans) && t.startAt && t.endAt)
    .map(task => ({ task, start: Math.max(Date.parse(task.startAt!), start.toMillis()), end: Math.min(Date.parse(task.endAt!), end.toMillis()) }))
    .filter(e => Number.isFinite(e.start) && Number.isFinite(e.end) && e.end > e.start)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.task.id.localeCompare(b.task.id))
    .map(e => {
      let lane = laneEnds.findIndex(value => value <= e.start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = e.end;
      return { ...e, lane, from: (e.start - start.toMillis()) / duration, to: (e.end - start.toMillis()) / duration };
    });
  let occupied = 0, until = start.toMillis();
  for (const e of entries) {
    occupied += Math.max(0, e.end - Math.max(until, e.start));
    until = Math.max(until, e.end);
  }
  return { start, end, duration, entries, lanes: Math.max(1, laneEnds.length), occupiedMinutes: Math.round(occupied / 60000) };
}

