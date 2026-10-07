"use client";
import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { api } from "@/client/firebase";
import { categories, type Plan, type Task } from "@/domain/model";
import { daySchedule } from "@/domain/day-schedule";

const colors = ["#42735e", "#916532", "#517d9b", "#7d6393", "#99685e"];
function point(fraction: number, radius: number) {
  const angle = fraction * Math.PI * 2 - Math.PI / 2;
  return { x: 180 + Math.cos(angle) * radius, y: 180 + Math.sin(angle) * radius };
}
function arc(from: number, to: number, radius: number) {
  const a = point(from, radius), mid = point((from + to) / 2, radius), b = point(to, radius);
  // Two arcs support an exact full-day circle.
  return `M ${a.x} ${a.y} A ${radius} ${radius} 0 0 1 ${mid.x} ${mid.y} A ${radius} ${radius} 0 0 1 ${b.x} ${b.y}`;
}
export default function TodaySchedule({ tasks, plans, zone, clock, onEdit, onAdd }: {
  tasks: Task[]; plans: Plan[]; zone: string; clock: number;
  onEdit: (task: Task) => void; onAdd: () => void;
}) {
  const now = DateTime.fromMillis(clock).setZone(zone), day = now.toISODate()!;
  const [result, setResult] = useState<{ key: string; items: Task[]; error: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const key = `${day}/${zone}`;
  useEffect(() => {
    let live = true;
    setResult(null);
    const start = DateTime.fromISO(day, { zone });
    api(`/api/schedule?timedOnly=true&from=${encodeURIComponent(start.toISO()!)}&to=${encodeURIComponent(start.plus({ days: 1 }).toISO()!)}`)
      .then(r => { if (live) setResult({ key, items: r.items, error: "" }); })
      .catch(() => { if (live) setResult({ key, items: [], error: "시간표를 불러오지 못했습니다." }); });
    return () => { live = false; };
  }, [day, zone, key, tasks, retry]);
  const ready = result?.key === key;
  const { entries, lanes, occupiedMinutes, duration, start, end } = daySchedule(ready ? result.items : [], plans, day, zone);
  const width = Math.min(22, 64 / lanes), nowPoint = point((clock - start.toMillis()) / duration, 145);
  const time = (millis: number) => millis === end.toMillis() ? "24:00" : DateTime.fromMillis(millis).setZone(zone).toFormat("HH:mm");
  return (
    <section className="card today-schedule" aria-labelledby="today-schedule-title">
      <div className="card-heading">
        <div><span className="eyebrow">하루를 한눈에</span><h2 id="today-schedule-title">오늘의 시간표</h2></div>
        <span className="schedule-source">앱 실행 일정 · {zone}</span>
      </div>
      {!ready ? <p role="status" className="empty">오늘의 실행 시간을 불러오는 중…</p> : result.error ? (
        <div role="alert" className="schedule-error"><p>{result.error} 기존 할 일 목록은 계속 사용할 수 있습니다.</p><button onClick={() => setRetry(x => x + 1)}>다시 불러오기</button></div>
      ) : (
        <div className="schedule-layout">
          <div className="schedule-dial">
            <svg viewBox="0 0 360 360" role="img" aria-label={`오늘 실행 일정 ${entries.length}개, 겹친 시간을 제외한 ${occupiedMinutes}분. 상세 시간은 일정 목록에서 확인하세요.`}>
              <circle cx="180" cy="180" r="122" fill="none" stroke="#edf1ee" strokeWidth="24" />
              {Array.from({ length: Math.round(duration / 3600000) }, (_, hour) => {
                const instant = start.plus({ hours: hour }), f = hour * 3600000 / duration;
                const a = point(f, 142), b = point(f, instant.hour % 3 === 0 ? 149 : 146), label = point(f, 163);
                return <g key={hour}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#a5b3ab" />{instant.hour % 3 === 0 && <text x={label.x} y={label.y} textAnchor="middle" dominantBaseline="central" className="dial-hour">{instant.toFormat("HH")}</text>}</g>;
              })}
              {entries.map(e => <path key={e.task.id} d={arc(e.from, e.to, 122 - e.lane * (64 / lanes))} fill="none" stroke={colors[categories.indexOf(e.task.category)]} strokeWidth={width} opacity={e.task.status === "완료" ? 0.4 : 1}><title>{e.task.title} · {time(e.start)}–{time(e.end)} · {e.task.status}</title></path>)}
              <circle cx={nowPoint.x} cy={nowPoint.y} r="5" fill="#26352f" stroke="white" strokeWidth="2" />
              <text x="180" y="163" textAnchor="middle" className="dial-caption">지금</text>
              <text x="180" y="196" textAnchor="middle" className="dial-now">{now.toFormat("HH:mm")}</text>
              <text x="180" y="221" textAnchor="middle" className="dial-caption">{entries.length ? `${entries.length}개의 실행 일정` : "비어 있는 하루"}</text>
            </svg>
            <p className="schedule-total">{Math.floor(occupiedMinutes / 60)}시간 {occupiedMinutes % 60}분 예정 <span>· 겹친 시간은 한 번만 계산</span></p>
          </div>
          <div className="schedule-agenda">
            {entries.length ? <ol aria-label="오늘 실행 일정">
              {entries.map(e => <li key={e.task.id}><button onClick={() => onEdit(e.task)} className="schedule-entry">
                <span className="schedule-swatch" style={{ background: colors[categories.indexOf(e.task.category)] }} aria-hidden="true" />
                <span><b>{time(e.start)}–{time(e.end)}</b><span className="schedule-title">{e.task.title}</span><small>{e.task.category} · {e.task.status}{e.start <= clock && clock < e.end && e.task.status !== "완료" ? " · 지금 예정" : ""}</small></span>
                <span aria-hidden="true">↗</span>
              </button></li>)}
            </ol> : <div className="schedule-empty"><h3>아직 정해진 실행 시간이 없어요</h3><p>할 일에 시작·종료 시간을 정하면<br />오늘 하루의 흐름이 여기에 보여요.</p><button onClick={onAdd}>실행 일정 추가</button></div>}
            <p className="schedule-note">마감만 있는 할 일은 아래 목록에서 확인하세요. 겹치는 일정은 안쪽 고리로 표시하며, 완료한 일정도 하루 기록으로 남습니다.{duration !== 86400000 && ` 오늘은 시간대 전환으로 ${duration / 3600000}시간입니다.`}</p>
          </div>
        </div>
      )}
    </section>
  );
}

