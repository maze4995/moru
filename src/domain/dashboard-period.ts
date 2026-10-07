import { DateTime } from "luxon";
import { active, categories, confirmed, type Plan, type Task } from "./model";

export type DashboardPeriod = "today" | "week";
export function dashboardPeriod(
  tasks: Task[],
  plans: Plan[],
  zone: string,
  clock: number,
  period: DashboardPeriod,
) {
  const now = DateTime.fromMillis(clock).setZone(zone);
  const start = now.startOf(period === "today" ? "day" : "week");
  const end = start.plus({ days: period === "today" ? 1 : 7 });
  const from = start.toISODate()!,
    until = end.toISODate()!;
  const inDates = (date: string | null) =>
    !!date && date >= from && date < until;
  const inPeriod = (task: Task) =>
    inDates(task.dueDate) ||
    !!(
      task.startAt &&
      task.endAt &&
      DateTime.fromISO(task.startAt).toMillis() < end.toMillis() &&
      DateTime.fromISO(task.endAt).toMillis() > start.toMillis()
    );
  const actionable = tasks.filter((t) => active(t) && confirmed(t, plans));
  const dateKey = (t: Task) =>
    [
      t.dueDate,
      t.startAt ? DateTime.fromISO(t.startAt).setZone(zone).toISODate() : null,
    ]
      .filter((d): d is string => !!d)
      .sort()[0] || "9999";
  const sortTasks = (a: Task, b: Task) =>
    dateKey(a).localeCompare(dateKey(b)) ||
    Number(b.priority === "높음") - Number(a.priority === "높음") ||
    a.title.localeCompare(b.title, "ko");
  const items = actionable.filter(inPeriod).sort(sortTasks);
  const groups = categories.map((category) => ({
    category,
    plans: plans
      .filter(
        (p) => !p.deleted && p.status === "진행 중" && p.category === category,
      )
      .flatMap((plan) => {
        const linked = actionable
          .filter((t) => t.planId === plan.id)
          .sort(sortTasks);
        const selected = linked.filter(inPeriod);
        const undated =
          !plan.targetDate && !linked.some((t) => t.dueDate || t.startAt);
        return inDates(plan.targetDate) || selected.length || undated
          ? [{ plan, next: selected[0] || linked[0], undated }]
          : [];
      })
      .sort(
        (a, b) =>
          Number(a.undated) - Number(b.undated) ||
          (a.plan.targetDate || "9999").localeCompare(
            b.plan.targetDate || "9999",
          ) ||
          a.plan.title.localeCompare(b.plan.title, "ko"),
      ),
  }));
  return {
    start,
    end,
    items,
    groups,
    deadlines: actionable.filter((t) => inDates(t.dueDate)),
    planCount: groups.reduce((sum, g) => sum + g.plans.length, 0),
  };
}
