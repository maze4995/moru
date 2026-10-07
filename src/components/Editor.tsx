"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  blankPlan,
  blankTask,
  categories,
  localToInstant,
  planSchema,
  planStates,
  taskSchema,
  taskStates,
  toLocal,
  type Plan,
  type Task,
  type PlanInput,
  type TaskInput,
} from "@/domain/model";
export default function Editor({
  kind,
  item,
  plans,
  zone,
  onClose,
  onSave,
  defaultPlan,
}: {
  kind: "tasks" | "plans";
  item?: Task | Plan;
  plans: Plan[];
  zone: string;
  onClose: () => void;
  onSave: (data: any) => Promise<void>;
  defaultPlan?: Plan;
}) {
  const [form, setForm] = useState<any>(() =>
    item
      ? Object.fromEntries(
          Object.entries(item).filter(
            ([k]) => !["id", "uid", "version", "updatedAt"].includes(k),
          ),
        )
      : kind === "tasks"
        ? {
            ...blankTask,
            ...(defaultPlan
              ? { planId: defaultPlan.id, category: defaultPlan.category }
              : {}),
          }
        : blankPlan,
  );
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const d = ref.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      d?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  const set = (key: string, value: any) =>
    setForm((f: any) => ({ ...f, [key]: value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const data = (kind === "tasks" ? taskSchema : planSchema).parse(form);
      await onSave(data);
    } catch (e) {
      setError(
        e instanceof Error && e.name === "ZodError"
          ? "입력값을 확인하세요. 제목, 날짜, 실행 시간과 알림 기준이 올바른지 확인해 주세요."
          : e instanceof Error
            ? e.message
            : "저장 실패",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!saving) onClose();
      }}
      aria-labelledby="editor-title"
    >
      <form onSubmit={submit}>
        <div className="dialog-head">
          <div>
            <span className="eyebrow">
              {kind === "tasks" ? "작은 행동부터" : "나만의 방향"}
            </span>
            <h2 id="editor-title">
              {item
                ? "수정하기"
                : kind === "tasks"
                  ? "할 일 추가"
                  : "새 계획 만들기"}
            </h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="닫기"
            onClick={onClose}
            disabled={saving}
          >
            <X />
          </button>
        </div>
        <div className="editor-fields">
          <label>
            제목 <span className="required">*</span>
            <input
              autoFocus
              required
              maxLength={200}
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder={
                kind === "tasks"
                  ? "다음으로 할 작은 행동은 무엇인가요?"
                  : "어떤 목표를 이루고 싶나요?"
              }
            />
          </label>
          <div className="form-grid">
            <label>
              분야
              <select
                value={form.category}
                disabled={kind === "tasks" && !!form.planId}
                onChange={(e) => set("category", e.target.value)}
              >
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              상태
              <select
                value={form.status}
                onChange={(e) => set("status", e.target.value)}
              >
                {(kind === "tasks" ? taskStates : planStates).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          {kind === "tasks" ? (
            <>
              <label>
                소속 계획
                <select
                  value={form.planId || ""}
                  onChange={(e) => {
                    const p = plans.find((p) => p.id === e.target.value);
                    setForm((f: TaskInput) => ({
                      ...f,
                      planId: p?.id || null,
                      category: p?.category || f.category,
                    }));
                  }}
                >
                  <option value="">독립적인 할 일</option>
                  {plans
                    .filter((p) => !p.deleted)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title} · {p.status}
                      </option>
                    ))}
                </select>
              </label>
              <div className="form-grid">
                <label>
                  우선순위
                  <select
                    value={form.priority}
                    onChange={(e) => set("priority", e.target.value)}
                  >
                    {["높음", "보통", "낮음"].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <label>
                  마감일 · 날짜만
                  <input
                    type="date"
                    value={form.dueDate || ""}
                    onChange={(e) => set("dueDate", e.target.value || null)}
                  />
                </label>
              </div>
              <fieldset>
                <legend>
                  실행 시간 <small>선택 · {zone}</small>
                </legend>
                <p className="muted">
                  마감일과 별개로, 실제로 할 시간을 정하세요.
                </p>
                <div className="form-grid">
                  {(["startAt", "endAt"] as const).map((field, i) => (
                    <label key={field}>
                      {i ? "종료" : "시작"}
                      <input
                        type="datetime-local"
                        value={toLocal(form[field], zone)}
                        onChange={(e) => {
                          try {
                            set(field, localToInstant(e.target.value, zone));
                            setError("");
                          } catch (err) {
                            setError((err as Error).message);
                          }
                        }}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>알림</legend>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={form.reminder.enabled}
                    onChange={(e) =>
                      set("reminder", {
                        ...form.reminder,
                        enabled: e.target.checked,
                      })
                    }
                  />{" "}
                  앱 내 알림 예약
                </label>
                {form.reminder.enabled && (
                  <>
                    <div className="form-grid">
                      <label>
                        기준
                        <select
                          value={form.reminder.basis}
                          onChange={(e) =>
                            set("reminder", {
                              ...form.reminder,
                              basis: e.target.value,
                            })
                          }
                        >
                          <option value="deadline">마감일</option>
                          <option value="start">실행 시작</option>
                        </select>
                      </label>
                      <label>
                        얼마나 전에
                        <select
                          value={form.reminder.minutesBefore}
                          onChange={(e) =>
                            set("reminder", {
                              ...form.reminder,
                              minutesBefore: Number(e.target.value),
                            })
                          }
                        >
                          {[
                            [0, "정한 시각에"],
                            [10, "10분 전"],
                            [30, "30분 전"],
                            [60, "1시간 전"],
                            [1440, "하루 전"],
                          ].map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {form.reminder.basis === "deadline" && (
                      <label>
                        마감일 알림 기준 시각
                        <input
                          type="time"
                          value={form.reminder.deadlineTime}
                          onChange={(e) =>
                            set("reminder", {
                              ...form.reminder,
                              deadlineTime: e.target.value,
                            })
                          }
                        />
                        <small>
                          알림용 시각입니다. 마감일에 실행 일정을 만들지
                          않습니다.
                        </small>
                      </label>
                    )}
                    <p className="muted">
                      서버 작업자가 실행 중이어야 처리됩니다. 이메일은 설정에서
                      별도로 켜세요.
                    </p>
                  </>
                )}
              </fieldset>
            </>
          ) : (
            <>
              <label>
                목표 설명
                <textarea
                  rows={3}
                  maxLength={5000}
                  value={form.goal}
                  onChange={(e) => set("goal", e.target.value)}
                  placeholder="이 계획으로 이루고 싶은 것"
                />
              </label>
              <label>
                목표 날짜 · 선택
                <input
                  type="date"
                  value={form.targetDate || ""}
                  onChange={(e) => set("targetDate", e.target.value || null)}
                />
              </label>
              <label>
                자료 링크 · 한 줄에 하나
                <textarea
                  rows={3}
                  value={form.links.join("\n")}
                  onChange={(e) => set("links", e.target.value.split("\n"))}
                  onBlur={() =>
                    set(
                      "links",
                      form.links.map((x: string) => x.trim()).filter(Boolean),
                    )
                  }
                  placeholder="https://…"
                />
              </label>
              <p className="muted">
                검토 중인 계획은 후보로 보관합니다. 진행 중으로 바꾸기 전에는
                확정 일정에 표시하지 않습니다.
              </p>
            </>
          )}
          <label>
            메모
            <textarea
              rows={3}
              maxLength={10000}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="기억해 둘 내용이나 준비할 것"
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="dialog-foot">
          <button type="button" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button className="primary" disabled={saving}>
            {saving ? "저장 중…" : "저장하기"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
