import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import {
  active,
  blankTask,
  blankPlan,
  confirmed,
  localToInstant,
  normalizeEvents,
  reminderTime,
  taskSchema,
  todayKey,
  weekRange,
} from "../src/domain/model";
describe("date and scheduling semantics", () => {
  it("keeps date-only deadlines separate from execution timestamps", () => {
    const t = taskSchema.parse({
      ...blankTask,
      title: "접수",
      dueDate: "2026-10-07",
    });
    expect(t.startAt).toBeNull();
    expect(t.dueDate).toBe("2026-10-07");
  });
  it("rejects impossible dates and incomplete/reversed intervals", () => {
    expect(() =>
      taskSchema.parse({ ...blankTask, title: "x", dueDate: "2026-02-30" }),
    ).toThrow();
    expect(() =>
      taskSchema.parse({
        ...blankTask,
        title: "x",
        startAt: "2026-10-07T00:00:00Z",
      }),
    ).toThrow();
    expect(() =>
      taskSchema.parse({
        ...blankTask,
        title: "x",
        startAt: "2026-10-07T01:00:00Z",
        endAt: "2026-10-07T00:00:00Z",
      }),
    ).toThrow();
  });
  it("handles Korean midnight and Monday boundary", () => {
    expect(
      todayKey("Asia/Seoul", DateTime.fromISO("2026-10-04T15:00:00Z")),
    ).toBe("2026-10-05");
    expect(
      weekRange("Asia/Seoul", DateTime.fromISO("2026-10-04T15:00:00Z")),
    ).toEqual({ start: "2026-10-05", end: "2026-10-11" });
  });
  it("changes reminder instant with zone without moving date-only deadline", () => {
    const t = {
      ...blankTask,
      dueDate: "2026-10-07",
      reminder: { ...blankTask.reminder, enabled: true },
    };
    expect(reminderTime(t, "Asia/Seoul")).toBe("2026-10-07T00:00:00.000Z");
    expect(reminderTime(t, "UTC")).toBe("2026-10-07T09:00:00.000Z");
    expect(t.dueDate).toBe("2026-10-07");
  });
  it("rejects nonexistent or ambiguous daylight saving wall times", () => {
    expect(() =>
      localToInstant("2026-03-08T02:30", "America/New_York"),
    ).toThrow();
    expect(() =>
      localToInstant("2026-11-01T01:30", "America/New_York"),
    ).toThrow();
    expect(localToInstant("2026-10-07T09:00", "Asia/Seoul")).toBe(
      "2026-10-07T00:00:00.000Z",
    );
  });
  it("suppresses candidate, paused, completed and deleted reminders", () => {
    expect(
      confirmed({ ...blankTask, planId: "p" }, [
        { ...blankPlan, id: "p", uid: "u", version: 1, updatedAt: "" },
      ]),
    ).toBe(false);
    for (const status of ["완료", "취소", "보류"] as const)
      expect(active({ ...blankTask, status })).toBe(false);
    expect(reminderTime({ ...blankTask, deleted: true }, "UTC")).toBeNull();
  });
});
describe("calendar projection", () => {
  it("deduplicates by calendar/event ID, applies changes and cancellations", () => {
    const event = {
      id: "e",
      summary: "old",
      start: { date: "2026-10-07" },
      end: { date: "2026-10-08" },
    };
    expect(
      normalizeEvents("a", [event, { ...event, summary: "new" }]),
    ).toMatchObject([{ title: "new", allDay: true, end: "2026-10-08" }]);
    expect(
      normalizeEvents("a", [event, { id: "e", status: "cancelled" }]),
    ).toEqual([]);
    expect(normalizeEvents("b", [event])[0].id).not.toBe(
      normalizeEvents("a", [event])[0].id,
    );
  });
  it("retains individual recurring instance IDs and multi-day all-day ranges", () => {
    const events = normalizeEvents("a", [
      {
        id: "series_1",
        start: { date: "2026-10-07" },
        end: { date: "2026-10-10" },
      },
      {
        id: "series_2",
        start: { dateTime: "2026-10-14T09:00:00+09:00" },
        end: { dateTime: "2026-10-14T10:00:00+09:00" },
      },
    ]);
    expect(events).toHaveLength(2);
    expect(events[0].allDay).toBe(true);
    expect(events[1].allDay).toBe(false);
  });
});
