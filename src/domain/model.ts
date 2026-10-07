import { z } from "zod";
import { DateTime, IANAZone } from "luxon";
export const categories = [
  "취업",
  "자격증",
  "학습",
  "개인 프로젝트",
  "생활",
] as const;
export const planStates = ["검토 중", "진행 중", "보류", "완료"] as const;
export const taskStates = ["할 일", "진행 중", "보류", "완료", "취소"] as const;
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => DateTime.fromISO(v).isValid, "올바른 날짜를 입력하세요");
const instant = z.string().datetime({ offset: true }).nullable();
const title = z.string().trim().min(1, "제목을 입력하세요").max(200);
export const planSchema = z
  .object({
    title,
    category: z.enum(categories),
    goal: z.string().max(5000),
    status: z.enum(planStates),
    targetDate: date.nullable(),
    notes: z.string().max(10000),
    links: z
      .array(
        z
          .string()
          .url()
          .max(2000)
          .refine((v) => /^https?:\/\//.test(v)),
      )
      .max(20),
    deleted: z.boolean(),
  })
  .strict();
export const taskSchema = z
  .object({
    title,
    category: z.enum(categories),
    planId: z
      .string()
      .regex(/^[\w-]{1,128}$/)
      .nullable(),
    status: z.enum(taskStates),
    priority: z.enum(["높음", "보통", "낮음"]),
    dueDate: date.nullable(),
    startAt: instant,
    endAt: instant,
    notes: z.string().max(10000),
    deleted: z.boolean(),
    reminder: z
      .object({
        enabled: z.boolean(),
        basis: z.enum(["deadline", "start"]),
        minutesBefore: z.number().int().min(0).max(43200),
        deadlineTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      })
      .strict(),
  })
  .strict()
  .superRefine((t, c) => {
    if (
      !!t.startAt !== !!t.endAt ||
      (t.startAt && t.endAt && Date.parse(t.endAt) <= Date.parse(t.startAt))
    )
      c.addIssue({
        code: "custom",
        message:
          "실행 시작·종료 시간을 함께 입력하고 종료를 시작 이후로 지정하세요",
      });
    if (
      t.reminder.enabled &&
      !(t.reminder.basis === "deadline" ? t.dueDate : t.startAt)
    )
      c.addIssue({
        code: "custom",
        message: "알림 기준 날짜 또는 실행 시간이 필요합니다",
      });
  });
export const settingsSchema = z
  .object({
    timezone: z
      .string()
      .refine(
        (v) => IANAZone.isValidZone(v),
        "올바른 IANA 시간대가 필요합니다",
      ),
    emailEnabled: z.boolean(),
  })
  .strict();
export type PlanInput = z.infer<typeof planSchema>;
export type TaskInput = z.infer<typeof taskSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type Meta = {
  id: string;
  uid: string;
  version: number;
  updatedAt: string;
};
export type Plan = PlanInput & Meta;
export type Task = TaskInput & Meta;
export type CalendarEvent = {
  id: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  status: string;
};
export const defaultSettings: Settings = {
  timezone: "Asia/Seoul",
  emailEnabled: false,
};
export const blankTask: TaskInput = {
  title: "",
  category: "학습",
  planId: null,
  status: "할 일",
  priority: "보통",
  dueDate: null,
  startAt: null,
  endAt: null,
  notes: "",
  deleted: false,
  reminder: {
    enabled: false,
    basis: "deadline",
    minutesBefore: 0,
    deadlineTime: "09:00",
  },
};
export const blankPlan: PlanInput = {
  title: "",
  category: "학습",
  goal: "",
  status: "검토 중",
  targetDate: null,
  notes: "",
  links: [],
  deleted: false,
};
export function active(t: TaskInput) {
  return !t.deleted && !["완료", "취소", "보류"].includes(t.status);
}
export function confirmed(t: TaskInput, plans: Plan[]) {
  return (
    !t.planId ||
    plans.some((p) => p.id === t.planId && !p.deleted && p.status === "진행 중")
  );
}
export function todayKey(zone: string, now: DateTime = DateTime.now()) {
  return now.setZone(zone).toISODate()!;
}
export function weekRange(zone: string, now: DateTime = DateTime.now()) {
  const start = now.setZone(zone).startOf("week");
  return {
    start: start.toISODate()!,
    end: start.plus({ days: 6 }).toISODate()!,
  };
}
export function reminderTime(t: TaskInput, zone: string) {
  if (!active(t) || !t.reminder.enabled) return null;
  const d =
    t.reminder.basis === "start"
      ? DateTime.fromISO(t.startAt || "", { setZone: true })
      : DateTime.fromISO(`${t.dueDate}T${t.reminder.deadlineTime}`, { zone });
  return d.isValid
    ? d.minus({ minutes: t.reminder.minutesBefore }).toUTC().toISO()
    : null;
}
export function localToInstant(value: string, zone: string) {
  if (!value) return null;
  const d = DateTime.fromISO(value, { zone });
  if (!d.isValid || d.toFormat("yyyy-MM-dd'T'HH:mm") !== value)
    throw new Error("존재하지 않는 현지 시간입니다");
  if (d.getPossibleOffsets().length > 1)
    throw new Error(
      "서머타임이 끝나는 중복 시간입니다. 다른 시간을 선택하세요",
    );
  return d.toUTC().toISO()!;
}
export function toLocal(value: string | null, zone: string) {
  return value
    ? DateTime.fromISO(value).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm")
    : "";
}
export function normalizeEvents(
  calendarId: string,
  items: any[],
): CalendarEvent[] {
  const unique = new Map<string, CalendarEvent>();
  for (const e of items) {
    if (!e.id) continue;
    const id = `${calendarId}:${e.id}`;
    if (e.status === "cancelled") {
      unique.delete(id);
      continue;
    }
    if (!e.start || !e.end) continue;
    unique.set(id, {
      id,
      calendarId,
      title: e.summary || "(제목 없음)",
      start: e.start.dateTime || e.start.date,
      end: e.end.dateTime || e.end.date,
      allDay: !!e.start.date,
      status: e.status || "confirmed",
    });
  }
  return [...unique.values()];
}
