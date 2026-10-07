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

import { daySchedule } from "../src/domain/day-schedule";
import type { Task, Plan } from "../src/domain/model";
describe("today circular schedule", () => {
  const task = (id: string, startAt: string | null, endAt: string | null, patch: Partial<Task> = {}): Task => ({
    ...blankTask, id, uid: "test", version: 1, updatedAt: "", title: id, startAt, endAt, ...patch,
  });
  it("clips midnight crossings and counts overlaps only once while assigning separate rings", () => {
    const result = daySchedule([
      task("overnight", "2026-10-06T23:00:00+09:00", "2026-10-07T02:00:00+09:00"),
      task("overlap", "2026-10-07T01:00:00+09:00", "2026-10-07T03:00:00+09:00"),
      task("ending-at-midnight", "2026-10-06T22:00:00+09:00", "2026-10-07T00:00:00+09:00"),
      task("next-day", "2026-10-08T00:00:00+09:00", "2026-10-08T01:00:00+09:00"),
    ], [], "2026-10-07", "Asia/Seoul");
    expect(result.entries.map(e => e.task.id)).toEqual(["overnight", "overlap"]);
    expect(result.entries[0].from).toBe(0);
    expect(result.entries[0].to).toBeCloseTo(2 / 24);
    expect(result.lanes).toBe(2);
    expect(result.occupiedMinutes).toBe(180);
  });
  it("excludes deadline-only, deleted, held and candidate items but retains completed time", () => {
    const start = "2026-10-07T09:00:00+09:00", end = "2026-10-07T10:00:00+09:00";
    const candidate: Plan = { ...blankPlan, id: "candidate", title: "candidate", uid: "test", version: 1, updatedAt: "" };
    const result = daySchedule([
      task("deadline", null, null, { dueDate: "2026-10-07" }),
      task("deleted", start, end, { deleted: true }),
      task("held", start, end, { status: "보류" }),
      task("cancelled", start, end, { status: "취소" }),
      task("candidate", start, end, { planId: candidate.id }),
      task("done", start, end, { status: "완료" }),
    ], [candidate], "2026-10-07", "Asia/Seoul");
    expect(result.entries.map(e => e.task.id)).toEqual(["done"]);
  });
  it("uses timezone day boundaries and real DST day lengths", () => {
    const fullDay = task("dst", "2026-03-08T00:00:00-05:00", "2026-03-09T00:00:00-04:00");
    const spring = daySchedule([fullDay], [], "2026-03-08", "America/New_York");
    expect(spring.duration).toBe(23 * 3600000);
    expect(spring.occupiedMinutes).toBe(23 * 60);
    expect(spring.entries[0].to).toBe(1);
    expect(daySchedule([], [], "2026-11-01", "America/New_York").duration).toBe(25 * 3600000);
    const shifted = daySchedule([task("late", "2026-10-07T23:30:00Z", "2026-10-08T00:30:00Z")], [], "2026-10-08", "Asia/Seoul");
    expect(shifted.entries[0].from).toBeCloseTo(8.5 / 24);
  });
});

import { dashboardPeriod, executionLabel } from "../src/domain/dashboard-period";

describe("dashboard today/week selection", () => {
  const meta = { uid: "owner", version: 1, updatedAt: "2026-10-07T00:00:00Z" };
  const p = (id: string, patch: Partial<Plan> = {}): Plan => ({
    ...blankPlan,
    ...meta,
    id,
    title: id,
    status: "진행 중",
    ...patch,
  });
  const t = (id: string, patch: Partial<Task> = {}): Task => ({
    ...blankTask,
    ...meta,
    id,
    title: id,
    ...patch,
  });
  const clock = Date.parse("2026-10-07T03:00:00Z");
  it("uses Monday through Sunday, excludes next Monday, and counts a deadline plus execution once", () => {
    const tasks = [
      t("mon", { dueDate: "2026-10-05" }),
      t("sun", { dueDate: "2026-10-11" }),
      t("next", { dueDate: "2026-10-12" }),
      t("today", {
        dueDate: "2026-10-07",
        startAt: "2026-10-07T02:00:00Z",
        endAt: "2026-10-07T03:00:00Z",
      }),
    ];
    expect(
      dashboardPeriod(tasks, [], "Asia/Seoul", clock, "week").items.map(
        (x) => x.id,
      ),
    ).toEqual(["mon", "today", "sun"]);
    expect(
      dashboardPeriod(tasks, [], "Asia/Seoul", clock, "today").items.map(
        (x) => x.id,
      ),
    ).toEqual(["today"]);
  });
  it("uses exclusive midnight boundaries and changes execution dates with timezone, not date-only deadlines", () => {
    const tasks = [
      t("ends-at-start", {
        startAt: "2026-10-06T14:00:00Z",
        endAt: "2026-10-06T15:00:00Z",
      }),
      t("seoul-today", {
        startAt: "2026-10-06T15:00:00Z",
        endAt: "2026-10-06T16:00:00Z",
      }),
      t("date-only", { dueDate: "2026-10-07" }),
      t("tomorrow", {
        startAt: "2026-10-07T15:00:00Z",
        endAt: "2026-10-07T16:00:00Z",
      }),
    ];
    expect(
      dashboardPeriod(tasks, [], "Asia/Seoul", clock, "today").items.map(
        (x) => x.id,
      ),
    ).toEqual(["date-only", "seoul-today"]);
    expect(
      dashboardPeriod(tasks, [], "UTC", clock, "today").items.map((x) => x.id),
    ).toEqual(["date-only", "tomorrow"]);
    expect(tasks[2].startAt).toBeNull();
  });
  it("groups all five categories, includes dated and unscheduled ongoing plans, excludes candidates and inactive work", () => {
    const plans = [
      p("target", { category: "취업", targetDate: "2026-10-07" }),
      p("linked", { category: "생활" }),
      p("undated", { category: "자격증" }),
      p("future", { targetDate: "2026-11-01" }),
      p("candidate", { status: "검토 중", targetDate: "2026-10-07" }),
      p("deleted", { deleted: true }),
      p("held", { status: "보류" }),
    ];
    const tasks = [
      t("linked-task", {
        planId: "linked",
        dueDate: "2026-10-07",
        category: "생활",
      }),
      t("candidate-task", { planId: "candidate", dueDate: "2026-10-07" }),
      t("done", { status: "완료", dueDate: "2026-10-07" }),
      t("paused", { status: "보류", dueDate: "2026-10-07" }),
      t("standalone", { dueDate: "2026-10-07" }),
    ];
    const view = dashboardPeriod(tasks, plans, "Asia/Seoul", clock, "today");
    expect(view.groups.map((g) => g.category)).toEqual([
      "취업",
      "자격증",
      "학습",
      "개인 프로젝트",
      "생활",
    ]);
    expect(view.groups.flatMap((g) => g.plans.map((x) => x.plan.id))).toEqual([
      "target",
      "undated",
      "linked",
    ]);
    expect(view.groups[1].plans[0].undated).toBe(true);
    expect(view.items.map((x) => x.id)).toEqual(["linked-task", "standalone"]);
  });
  it("handles a 25-hour DST day without including the next day", () => {
    const view = dashboardPeriod(
      [
        t("last-hour", {
          startAt: "2026-11-02T04:00:00Z",
          endAt: "2026-11-02T05:00:00Z",
        }),
        t("next-day", {
          startAt: "2026-11-02T05:00:00Z",
          endAt: "2026-11-02T06:00:00Z",
        }),
      ],
      [],
      "America/New_York",
      Date.parse("2026-11-01T12:00:00Z"),
      "today",
    );
    expect(view.end.diff(view.start, "hours").hours).toBe(25);
    expect(view.items.map((x) => x.id)).toEqual(["last-hour"]);
  });
});

it("groups independent work in chronological order and labels overnight execution with both dates", () => {
 const base = {...blankTask, uid:"owner", version:1, updatedAt:""};
 const early: Task = {...base,id:"early",title:"early",category:"생활",startAt:"2026-10-08T15:00:00+09:00",endAt:"2026-10-08T16:00:00+09:00"};
 const later: Task = {...early,id:"later",title:"later",startAt:"2026-10-08T17:00:00+09:00",endAt:"2026-10-09T13:00:00+09:00"};
 const view=dashboardPeriod([later,early],[],"Asia/Seoul",Date.parse("2026-10-07T03:00:00Z"),"week");
 expect(view.groups[4].tasks.map(t=>t.id)).toEqual(["early","later"]);
 expect(executionLabel(later,"Asia/Seoul")).toBe("10/8 17:00–10/9 13:00");
});
