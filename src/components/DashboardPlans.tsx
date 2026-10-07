"use client";
import { ArrowUpRight } from "lucide-react";
import { categories, type Plan } from "@/domain/model";
import { dashboardPeriod } from "@/domain/dashboard-period";

type Props = {
  groups: ReturnType<typeof dashboardPeriod>["groups"];
  label: string;
  onOpen: (plan: Plan) => void;
  onCategory: (category: string) => void;
};
export default function DashboardPlans({
  groups,
  label,
  onOpen,
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
          <h2 id="dashboard-plans-title">{label}의 계획 · 분야별</h2>
        </div>
      </div>
      <p className="muted small period-explanation">
        선택한 기간에 목표 날짜나 미완료 할 일이 있는 진행 중 계획입니다. 날짜
        없는 계획은 따로 표시해요. 후보·보류 계획은 ‘내 계획’에서 확인하세요.
      </p>
      <div className="category-plan-grid">
        {groups.map(({ category, plans }) => (
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
                <span className="count">{plans.length}</span>
              </h3>
              <button
                className="text-button"
                onClick={() => onCategory(category)}
                aria-label={`${category} 전체 계획 보기`}
              >
                전체 <ArrowUpRight size={15} />
              </button>
            </div>
            {plans.length ? (
              plans.map(({ plan, next, undated }) => (
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
              ))
            ) : (
              <p className="category-empty">
                {label}에 해당하는 계획이 없어요.
              </p>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}
