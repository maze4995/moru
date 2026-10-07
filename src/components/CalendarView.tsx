"use client";
import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { api } from "@/client/firebase";
import {
  active,
  confirmed,
  type CalendarEvent,
  type Plan,
  type Task,
} from "@/domain/model";
export default function CalendarView({
  tasks,
  plans,
  zone,
  onEdit,
}: {
  tasks: Task[];
  plans: Plan[];
  zone: string;
  onEdit: (t: Task) => void;
}) {
  const [anchor, setAnchor] = useState(
      DateTime.now().setZone(zone).toISODate()!,
    ),
    [mode, setMode] = useState<"month" | "week">("month"),
    [events, setEvents] = useState<CalendarEvent[]>([]),
    [sync, setSync] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const d = DateTime.fromISO(anchor, { zone }),
    start = d.startOf(mode).startOf("week"),
    end =
      mode === "month"
        ? d.endOf("month").endOf("week")
        : start.plus({ days: 6 }).endOf("day"),
    days = Array.from(
      { length: Math.round(end.startOf("day").diff(start, "days").days) + 1 },
      (_, i) => start.plus({ days: i }),
    );
  const [periodTasks, setPeriodTasks] = useState<Task[]>(tasks);
  const rangeStart = start.toISO()!,
    rangeEnd = end.plus({ milliseconds: 1 }).toISO()!;
  useEffect(() => {
    let live = true;
    api(
      `/api/schedule?from=${encodeURIComponent(rangeStart)}&to=${encodeURIComponent(rangeEnd)}`,
    )
      .then((r) => {
        if (live) setPeriodTasks(r.items);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [rangeStart, rangeEnd, tasks]);
  const scheduled = periodTasks.filter((t) => active(t) && confirmed(t, plans));
  const entriesForDay = (day: DateTime) => {
    const key = day.toISODate()!;
    const dayEnd = day.plus({ days: 1 });
    return {
      timed: scheduled.filter(
        (t) =>
          t.startAt &&
          DateTime.fromISO(t.startAt) < dayEnd &&
          DateTime.fromISO(t.endAt!) > day,
      ),
      deadlines: scheduled.filter((t) => t.dueDate === key),
      goals: plans.filter(
        (p) => !p.deleted && p.status === "진행 중" && p.targetDate === key,
      ),
      external: events.filter((e) =>
        e.allDay
          ? e.start <= key && e.end > key
          : DateTime.fromISO(e.start) < dayEnd && DateTime.fromISO(e.end) > day,
      ),
    };
  };
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const r = await api(
        `/api/calendar?action=events&from=${encodeURIComponent(start.toUTC().toISO()!)}&to=${encodeURIComponent(end.plus({ milliseconds: 1 }).toUTC().toISO()!)}`,
      );
      setEvents(r.events);
      setSync(r.lastSync);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function move(n: number) {
    setAnchor(
      d.plus(mode === "month" ? { months: n } : { weeks: n }).toISODate()!,
    );
    setEvents([]);
    setSync("");
  }
  return (
    <>
      <div className="section-toolbar">
        <div className="calendar-nav">
          <button
            aria-label="이전 기간"
            className="icon-button"
            onClick={() => move(-1)}
          >
            <ChevronLeft />
          </button>
          <h2>
            {d.toFormat("yyyy년 M월")}
            {mode === "week" && ` ${d.day}일 주간`}
          </h2>
          <button
            aria-label="다음 기간"
            className="icon-button"
            onClick={() => move(1)}
          >
            <ChevronRight />
          </button>
          <button
            onClick={() => {
              setAnchor(DateTime.now().setZone(zone).toISODate()!);
              setEvents([]);
            }}
          >
            오늘
          </button>
        </div>
        <div className="actions">
          <div className="segmented">
            <button
              aria-pressed={mode === "month"}
              onClick={() => {
                setMode("month");
                setEvents([]);
              }}
            >
              월간
            </button>
            <button
              aria-pressed={mode === "week"}
              onClick={() => {
                setMode("week");
                setEvents([]);
              }}
            >
              주간
            </button>
          </div>
          <button disabled={busy} onClick={refresh}>
            <RefreshCw size={15} />
            {busy ? "읽는 중…" : "Google 새로고침"}
          </button>
        </div>
      </div>
      <div className="legend">
        <span>
          <i className="dot green" />앱 실행 일정
        </span>
        <span>
          <i className="dot blue" />
          Google 일정
        </span>
        <span>
          <i className="dot amber" />
          날짜 마감
        </span>
        <small>
          {zone} ·{" "}
          {sync
            ? `최근 동기화 ${DateTime.fromISO(sync).setZone(zone).toFormat("M/d HH:mm")}`
            : "Google 일정은 연결 후 기간별로 새로고침하세요"}
        </small>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className={`calendar-grid ${mode}`}>
        {mode === "month" && (
          <div
            className="mobile-month-picker"
            role="group"
            aria-label="월간 날짜 선택"
          >
            {["월", "화", "수", "목", "금", "토", "일"].map((label) => (
              <span key={label} className="picker-weekday">
                {label}
              </span>
            ))}
            {days.map((day) => {
              const key = day.toISODate()!;
              if (day.month !== d.month) return <span key={key} />;
              const entries = entriesForDay(day);
              const count = Object.values(entries).reduce(
                (sum, items) => sum + items.length,
                0,
              );
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={`${day.toFormat("M월 d일")} · ${count}개 항목`}
                  aria-pressed={key === anchor}
                  aria-current={
                    key === DateTime.now().setZone(zone).toISODate()
                      ? "date"
                      : undefined
                  }
                  onClick={() => setAnchor(key)}
                >
                  <span>{day.day}</span>
                  <small aria-hidden="true">{count ? `${count}건` : ""}</small>
                </button>
              );
            })}
          </div>
        )}
        <div className="weekdays">
          {["월", "화", "수", "목", "금", "토", "일"].map((x) => (
            <span key={x}>{x}</span>
          ))}
        </div>
        <div className="calendar-days">
          {days.map((day) => {
            const key = day.toISODate()!;
            const entries = entriesForDay(day);
            return (
              <section
                className={`day ${mode === "month" && day.month !== d.month ? "outside" : ""} ${key === anchor ? "selected-day" : ""} ${key === DateTime.now().setZone(zone).toISODate() ? "is-today" : ""}`}
                aria-label={day.toFormat("yyyy년 M월 d일")}
                key={key}
              >
                <header>
                  <span>{day.day}</span>
                  <small>
                    {day.toFormat("M월 d일 cccc", { locale: "ko" })}
                  </small>
                </header>
                {Object.values(entries).every(
                  (items) => items.length === 0,
                ) && (
                  <p className="day-empty">예정된 일정과 마감이 없습니다.</p>
                )}
                {entries.timed.map((t) => (
                  <button
                    key={`s${t.id}`}
                    className="cal-event app-event"
                    onClick={() => onEdit(t)}
                  >
                    <b>
                      {DateTime.fromISO(t.startAt!)
                        .setZone(zone)
                        .toFormat("HH:mm")}
                    </b>{" "}
                    {t.title}
                  </button>
                ))}
                {entries.deadlines.map((t) => (
                  <button
                    key={`d${t.id}`}
                    className="cal-event deadline-event"
                    onClick={() => onEdit(t)}
                  >
                    마감 · {t.title}
                  </button>
                ))}
                {entries.goals.map((p) => (
                  <div key={p.id} className="cal-event deadline-event">
                    목표 · {p.title}
                  </div>
                ))}
                {entries.external.map((e) => (
                  <div key={e.id} className="cal-event google-event">
                    <b>
                      {e.allDay
                        ? "종일"
                        : DateTime.fromISO(e.start)
                            .setZone(zone)
                            .toFormat("HH:mm")}
                    </b>{" "}
                    {e.title}
                    <small>Google</small>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </div>
      <section className="card unscheduled">
        <div className="card-heading">
          <h2>시간 미정</h2>
          <span className="muted">
            마감일이 있어도 실행 시간은 별도로 정합니다
          </span>
        </div>
        {scheduled.filter((t) => !t.startAt).length ? (
          scheduled
            .filter((t) => !t.startAt)
            .map((t) => (
              <button
                className="unscheduled-item"
                key={t.id}
                onClick={() => onEdit(t)}
              >
                <span>{t.title}</span>
                <small>{t.dueDate ? `마감 ${t.dueDate}` : "마감 없음"}</small>
              </button>
            ))
        ) : (
          <p className="empty">시간 미정인 할 일이 없습니다.</p>
        )}
      </section>
    </>
  );
}
