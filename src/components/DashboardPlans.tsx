"use client";
import { ArrowUpRight } from "lucide-react";
import { categories, type Plan, type Task } from "@/domain/model";
import { dashboardPeriod, executionLabel } from "@/domain/dashboard-period";

type Props = {
  groups: ReturnType<typeof dashboardPeriod>["groups"];
  label: string;
  zone: string;
  onOpen: (plan: Plan) => void;
  onTask: (task: Task) => void;
  onCategory: (category: string) => void;
};
export default function DashboardPlans({
  groups,
  label,
  zone,
  onOpen,
  onTask,
  onCategory,
}: Props) {
  return (
    <section
      className="dashboard-plans"
      aria-labelledby="dashboard-plans-title"
    >
      <div className="card-heading">
        <div>
          <span className="eyebrow">목표에서 다음 행동으로</span>
          <h2 id="dashboard-plans-title">{label} 계획과 할 일 · 분야별</h2>
        </div>
      </div>
      <p className="muted small period-explanation">
        기간에 해당하는 진행 중 계획과 독립 할 일을 모았어요. 날짜 없는 진행 중
        계획은 ‘날짜 미정’으로 표시합니다. 후보·보류 계획은 ‘내 계획’에서
        확인하세요.
      </p>
      <div className="category-plan-grid">
        {groups.map(({ category, plans, tasks }) => (
          <section
            className="card category-plan-group"
            key={category}
            aria-label={`${category} 계획`}
          >
            <div className="card-heading">
              <h3>
                <span
                  className={`category category-${categories.indexOf(category)}`}
                >
                  {category}
                </span>
                <span
                  className="count"
                  aria-label={`계획 ${plans.length}개, 독립 할 일 ${tasks.length}개`}
                >
                  {plans.length + tasks.length}
                </span>
              </h3>
              <button
                className="text-button"
                onClick={() => onCategory(category)}
                aria-label={`${category} 전체 계획 보기`}
              >
                전체 <ArrowUpRight size={15} />
              </button>
            </div>
            {plans.map(({ plan, next, undated }) => (
              <button
                className="period-plan"
                key={plan.id}
                onClick={() => onOpen(plan)}
              >
                <b>{plan.title}</b>
                <span>
                  {next ? `다음 · ${next.title}` : "다음 할 일을 정해보세요"}
                </span>
                <small>
                  {undated
                    ? "날짜 미정"
                    : plan.targetDate
                      ? `목표 ${plan.targetDate}`
                      : "기간 내 할 일 있음"}
                </small>
              </button>
            ))}
            {tasks.map((task) => (
              <button
                className="period-plan"
                key={task.id}
                onClick={() => onTask(task)}
              >
                <b>{task.title}</b>
                {task.startAt && (
                  <span>실행 · {executionLabel(task, zone)}</span>
                )}
                {task.dueDate && <span>마감 · {task.dueDate}</span>}
                <small>
                  독립 할 일 · {task.status}
                  {task.priority === "높음" ? " · 높은 우선순위" : ""}
                </small>
              </button>
            ))}
            {!plans.length && !tasks.length && (
              <p className="category-empty">
                {label}에 해당하는 계획·할 일이 없어요.
              </p>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}
