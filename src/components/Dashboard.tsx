"use client";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { DateTime } from "luxon";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronRight,
  Circle,
  Flag,
  FolderOpen,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Plus,
  Settings as SettingsIcon,
  Sun,
  Target,
  Trash2,
  Undo2,
} from "lucide-react";
import { api, clientAuth, emulator, login } from "@/client/firebase";
import {
  active,
  blankTask,
  categories,
  confirmed,
  defaultSettings,
  planStates,
  todayKey,
  weekRange,
  type Plan,
  type Settings as Preferences,
  type Task,
} from "@/domain/model";
import Editor from "./Editor";
import CalendarView from "./CalendarView";
import Settings from "./Settings";
const nav = [
  ["today", "오늘", LayoutDashboard],
  ["plans", "내 계획", FolderOpen],
  ["tasks", "모든 할 일", ListTodo],
  ["calendar", "캘린더", CalendarDays],
  ["inbox", "알림함", Bell],
  ["settings", "설정", SettingsIcon],
] as const;
type Tab = (typeof nav)[number][0];
export default function Dashboard() {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const tick = setInterval(() => setClock(Date.now()), 60000);
    return () => clearInterval(tick);
  }, []);
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [tab, setTab] = useState<Tab>("today"),
    [tasks, setTasks] = useState<Task[]>([]),
    [plans, setPlans] = useState<Plan[]>([]),
    [notifications, setNotifications] = useState<any[]>([]),
    [settings, setSettings] = useState<Preferences>(defaultSettings),
    [editor, setEditor] = useState<{
      kind: "tasks" | "plans";
      item?: Task | Plan;
      plan?: Plan;
    } | null>(null),
    [selectedPlan, setSelectedPlan] = useState<string | null>(null),
    [filter, setFilter] = useState("전체"),
    [stateFilter, setStateFilter] = useState("전체"),
    [quick, setQuick] = useState(""),
    [saving, setSaving] = useState(false),
    [cursors, setCursors] = useState<Record<string, string | null>>({});
  useEffect(() => {
    try {
      return onAuthStateChanged(clientAuth(), (u) => {
        setUser(u);
        setReady(true);
        if (!u) {
          setTasks([]);
          setPlans([]);
        }
      });
    } catch (e) {
      setError((e as Error).message);
      setReady(true);
    }
  }, []);
  async function reload() {
    setLoading(true);
    setError("");
    try {
      const [t, p, s, n] = await Promise.all([
        api("/api/data?kind=tasks"),
        api("/api/data?kind=plans"),
        api("/api/data?kind=settings"),
        api("/api/data?kind=notifications"),
      ]);
      setTasks(t.items);
      setPlans(p.items);
      setSettings(s);
      setNotifications(n.items);
      setCursors({ tasks: t.cursor, plans: p.cursor, notifications: n.cursor });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (user) void reload();
  }, [user]);
  useEffect(() => {
    if (!user) return;
    let timer: ReturnType<typeof setTimeout>;
    const refreshOnReturn = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void reload();
      }, 150);
    };
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [user]);
  useEffect(() => {
    const result = new URLSearchParams(location.search).get("calendar");
    if (result) {
      setTab("settings");
      setNotice(
        result === "connected"
          ? "Google Calendar를 연결했습니다. 표시할 캘린더를 선택하세요."
          : "Calendar 연결을 완료하지 못했습니다. 설정과 동의한 권한을 확인하세요.",
      );
      history.replaceState(null, "", "/");
    }
  }, []);
  async function save(kind: "tasks" | "plans", data: any, item?: Task | Plan) {
    const saved = await api("/api/data", {
      kind,
      id: item?.id,
      version: item?.version || 0,
      data,
    });
    if (kind === "tasks")
      setTasks((old) => [saved, ...old.filter((t) => t.id !== saved.id)]);
    else setPlans((old) => [saved, ...old.filter((p) => p.id !== saved.id)]);
    setNotice("저장했습니다.");
  }
  async function updateTask(t: Task, changes: Partial<Task>) {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const { id, uid, version, updatedAt, ...data } = { ...t, ...changes };
      await save("tasks", data, t);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function remove(kind: "tasks" | "plans", item: Task | Plan) {
    if (
      !confirm(
        `‘${item.title}’을 삭제할까요? 삭제됨 목록에서 복구할 수 있습니다.${kind === "plans" ? " 연결된 할 일은 보관되며 일정에서 제외됩니다." : ""}`,
      )
    )
      return;
    try {
      const { id, uid, version, updatedAt, ...data } = item;
      await save(kind, { ...data, deleted: true }, item);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function more(kind: string) {
    try {
      const r = await api(`/api/data?kind=${kind}&cursor=${cursors[kind]}`);
      if (kind === "tasks")
        setTasks((old) => [
          ...old,
          ...r.items.filter((t: Task) => !old.some((x) => x.id === t.id)),
        ]);
      if (kind === "plans")
        setPlans((old) => [
          ...old,
          ...r.items.filter((t: Plan) => !old.some((x) => x.id === t.id)),
        ]);
      if (kind === "notifications")
        setNotifications((old) => [...old, ...r.items]);
      setCursors({ ...cursors, [kind]: r.cursor });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const zone = settings.timezone,
    now = DateTime.fromMillis(clock).setZone(zone),
    today = todayKey(zone, now),
    week = weekRange(zone, now),
    open = tasks.filter((t) => active(t) && confirmed(t, plans)),
    overdue = open.filter((t) => t.dueDate && t.dueDate < today),
    missed = open.filter(
      (t) =>
        t.endAt &&
        DateTime.fromISO(t.endAt) < now.startOf("day") &&
        !(t.dueDate && t.dueDate < today),
    ),
    scheduledToday = open.filter(
      (t) =>
        t.dueDate === today ||
        (t.startAt &&
          DateTime.fromISO(t.startAt) < now.endOf("day") &&
          DateTime.fromISO(t.endAt!) > now.startOf("day")),
    ),
    upcoming = open
      .filter((t) => t.dueDate && t.dueDate > today && t.dueDate <= week.end)
      .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!)),
    high = open.filter((t) => t.priority === "높음"),
    ongoing = plans.filter((p) => !p.deleted && p.status === "진행 중"),
    detail = plans.find((p) => p.id === selectedPlan);
  function TaskRow({
    task: t,
    compact = false,
  }: {
    task: Task;
    compact?: boolean;
  }) {
    return (
      <div className={`task-row ${t.status === "완료" ? "completed" : ""}`}>
        <button
          className="complete-button"
          aria-label={`${t.title} ${t.status === "완료" ? "다시 열기" : "완료"}`}
          disabled={saving || t.deleted}
          onClick={() =>
            updateTask(t, { status: t.status === "완료" ? "할 일" : "완료" })
          }
        >
          {t.status === "완료" ? <Check size={17} /> : <Circle size={21} />}
        </button>
        <button
          className="task-main"
          disabled={saving}
          onClick={() => setEditor({ kind: "tasks", item: t })}
        >
          <span>{t.title}</span>
          <small>
            <span
              className={`category category-${categories.indexOf(t.category)}`}
            >
              {t.category}
            </span>
            {t.startAt && (
              <span>
                {DateTime.fromISO(t.startAt)
                  .setZone(zone)
                  .toFormat("M/d HH:mm")}
                –{DateTime.fromISO(t.endAt!).setZone(zone).toFormat("HH:mm")}
              </span>
            )}
            {t.dueDate && (
              <span
                className={t.dueDate < today && active(t) ? "overdue-text" : ""}
              >
                마감 {t.dueDate.slice(5).replace("-", ".")}
              </span>
            )}
            {!confirmed(t, plans) && <span>미확정·보관</span>}
            {["보류", "취소"].includes(t.status) && <span>{t.status}</span>}
          </small>
        </button>
        {t.priority === "높음" && (
          <Flag
            size={15}
            className="priority-flag"
            aria-label="높은 우선순위"
          />
        )}
        {!compact && (
          <button
            className="icon-button muted"
            aria-label={`${t.title} ${t.deleted ? "복구" : "삭제"}`}
            onClick={() =>
              t.deleted ? updateTask(t, { deleted: false }) : remove("tasks", t)
            }
          >
            {t.deleted ? <Undo2 size={17} /> : <Trash2 size={17} />}
          </button>
        )}
      </div>
    );
  }
  function Group({
    title,
    items,
    tone,
    empty,
  }: {
    title: string;
    items: Task[];
    tone?: string;
    empty: string;
  }) {
    return (
      <section className={`card task-group ${tone || ""}`}>
        <div className="card-heading">
          <h2>
            {title}
            <span className="count">{items.length}</span>
          </h2>
        </div>
        {items.length ? (
          items.map((t) => <TaskRow key={t.id} task={t} />)
        ) : (
          <p className="empty">{empty}</p>
        )}
      </section>
    );
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="모루 홈">
          <span className="brand-symbol">
            m<span>·</span>
          </span>
          <div>
            모루<small>나의 오늘, 다음 한 걸음</small>
          </div>
        </a>
        <span className="nav-caption">MY SPACE</span>
        <nav aria-label="주 메뉴">
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={tab === id ? "nav-item active" : "nav-item"}
              onClick={() => {
                setTab(id);
                setSelectedPlan(null);
                setFilter("전체");
                setStateFilter("전체");
                window.scrollTo({ top: 0, behavior: "instant" });
              }}
              aria-current={tab === id ? "page" : undefined}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === "today" && <small>{scheduledToday.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-leaf">✳</span>
          <p>
            작게 나누고,
            <br />
            하나씩 이어가요.
          </p>
          <small>나만의 속도로 충분해요.</small>
        </div>
        <div className="profile">
          <span className="avatar">나</span>
          <div>
            <b>나의 공간</b>
            <small>{emulator ? "로컬 · 가상 예시" : "개인 전용"}</small>
          </div>
          {user && (
            <button
              className="icon-button"
              aria-label="로그아웃"
              onClick={() => signOut(clientAuth())}
            >
              <LogOut size={17} />
            </button>
          )}
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            내 공간 <ChevronRight size={14} />{" "}
            {nav.find((n) => n[0] === tab)?.[1]}
          </span>
          <div>
            <span className="private-mark">
              <span className="dot green" />
              PRIVATE
            </span>
            <button
              className="icon-button"
              aria-label="알림함 열기"
              onClick={() => setTab("inbox")}
            >
              <Bell size={19} />
            </button>
          </div>
        </header>
        <div className="main-content">
          {!ready ? (
            <p className="empty">로그인 상태를 확인하고 있습니다…</p>
          ) : !user ? (
            <section className="welcome card">
              <span className="eyebrow">나만의 작은 정리 공간</span>
              <h1>
                오늘의 한 걸음이
                <br />
                목표에 가까워지도록.
              </h1>
              <p>계획, 할 일, 다가오는 마감을 한곳에서 정리하세요.</p>
              <button
                className="primary"
                onClick={async () => {
                  setError("");
                  try {
                    await login();
                  } catch {
                    setError(
                      "로그인하지 못했습니다. 로컬 환경에서는 Emulator를 시작하고 npm run seed를 실행하세요.",
                    );
                  }
                }}
              >
                {emulator ? "로컬 테스트 계정으로 시작" : "Google로 로그인"}
              </button>
              <small>
                {emulator
                  ? "실제 개인정보가 없는 가상 예시입니다. Auth / Firestore Emulator가 필요합니다."
                  : "허용된 개인 계정만 접근할 수 있습니다."}
              </small>
            </section>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    {tab === "today"
                      ? now.setLocale("ko").toFormat("yyyy년 M월 d일 cccc")
                      : "조금 더 선명하게, 나의 방향"}
                  </span>
                  <h1>
                    {tab === "today"
                      ? "오늘, 한 걸음"
                      : nav.find((n) => n[0] === tab)?.[1]}
                    <span className="heading-dot">.</span>
                  </h1>
                  <p>
                    {
                      {
                        today:
                          "지금 할 일에 집중하고, 다음 걸음을 가볍게 준비해요.",
                        plans: "후보부터 완료까지, 내 목표가 자라는 곳.",
                        tasks: "작은 행동을 모아 나만의 속도로 이어가세요.",
                        calendar:
                          "마감과 실행 시간을 구분해서 하루를 살펴보세요.",
                        inbox: "놓치지 않도록, 내가 정한 시각에.",
                        settings: "내 생활에 맞게 공간을 조정하세요.",
                      }[tab]
                    }
                  </p>
                </div>
                {["today", "tasks", "plans"].includes(tab) && (
                  <button
                    className="primary"
                    onClick={() =>
                      setEditor({ kind: tab === "plans" ? "plans" : "tasks" })
                    }
                  >
                    <Plus size={17} />
                    {tab === "plans" ? "새 계획" : "할 일 추가"}
                  </button>
                )}
              </div>
              {emulator && (
                <div className="demo-banner">
                  <span>LOCAL DEMO</span>가상 예시 데이터 · 변경 내용은 로컬
                  Firestore에 저장됩니다.
                </div>
              )}
              {loading && (
                <p role="status" className="notice">
                  데이터를 불러오는 중입니다…
                </p>
              )}
              {notice && (
                <div role="status" className="notice">
                  {notice}
                  <button onClick={() => setNotice("")} aria-label="안내 닫기">
                    ×
                  </button>
                </div>
              )}
              {Object.values(cursors).some(Boolean) && (
                <div className="notice">
                  목록은 100개씩 불러옵니다. 전체 요약을 보려면 나머지를
                  불러오세요.
                  {Object.entries(cursors)
                    .filter(([, v]) => v)
                    .map(([k]) => (
                      <button key={k} onClick={() => more(k)}>
                        {k === "tasks"
                          ? "할 일"
                          : k === "plans"
                            ? "계획"
                            : "알림"}{" "}
                        더 불러오기
                      </button>
                    ))}
                </div>
              )}
              {tab === "today" && (
                <>
                  <div className="summary-grid">
                    <div className="summary-card">
                      <span>
                        <Sun size={17} />
                        오늘 할 일
                      </span>
                      <strong>
                        {scheduledToday.length}
                        <small>개의 작은 행동</small>
                      </strong>
                      <div className="summary-line green-line" />
                    </div>
                    <div className="summary-card">
                      <span>
                        <Flag size={17} />
                        이번 주 남은 마감
                      </span>
                      <strong>
                        {upcoming.length}
                        <small>미리 확인해요</small>
                      </strong>
                      <div className="summary-line amber-line" />
                    </div>
                    <div className="summary-card">
                      <span>
                        <Target size={17} />
                        진행 중인 계획
                      </span>
                      <strong>
                        {ongoing.length}
                        <small>나만의 방향</small>
                      </strong>
                      <div className="summary-line blue-line" />
                    </div>
                  </div>
                  <form
                    className="quick-add"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!quick.trim() || saving) return;
                      setSaving(true);
                      try {
                        await save("tasks", {
                          ...blankTask,
                          title: quick,
                          dueDate: today,
                        });
                        setQuick("");
                      } catch (err) {
                        setError((err as Error).message);
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    <Plus size={20} />
                    <input
                      aria-label="빠른 할 일 제목"
                      maxLength={200}
                      value={quick}
                      onChange={(e) => setQuick(e.target.value)}
                      placeholder="오늘까지 할 일, 가볍게 적어보세요"
                    />
                    <button disabled={saving || !quick.trim()}>
                      추가 <ArrowRight size={15} />
                    </button>
                  </form>
                  <div className="dashboard-columns">
                    <div>
                      <Group
                        title="오늘 할 일"
                        items={scheduledToday}
                        empty="오늘 예정된 할 일이 없습니다. 작은 행동 하나를 정해보세요."
                      />
                      {overdue.length > 0 && (
                        <Group
                          title="마감이 지났어요"
                          items={overdue}
                          tone="overdue-group"
                          empty=""
                        />
                      )}
                      {missed.length > 0 && (
                        <Group
                          title="지난 실행 일정 · 직접 조정하기"
                          items={missed}
                          empty=""
                        />
                      )}
                      <Group
                        title="이번 주 다가오는 마감"
                        items={upcoming}
                        empty="이번 주 남은 마감이 없습니다."
                      />
                    </div>
                    <div>
                      <section className="card priority-card">
                        <div className="card-heading">
                          <h2>
                            <Flag size={17} />
                            내가 정한 우선순위
                          </h2>
                        </div>
                        <p className="muted small">
                          ‘높음’으로 표시한 할 일이에요.
                        </p>
                        {high.length ? (
                          high.map((t) => (
                            <TaskRow key={t.id} task={t} compact />
                          ))
                        ) : (
                          <p className="empty">집중할 일을 골라보세요.</p>
                        )}
                      </section>
                      <section className="card next-card">
                        <div className="card-heading">
                          <h2>계획의 다음 행동</h2>
                          <button
                            className="text-button"
                            onClick={() => setTab("plans")}
                          >
                            전체 <ArrowUpRight size={14} />
                          </button>
                        </div>
                        {ongoing.length ? (
                          ongoing.map((p) => {
                            const list = tasks.filter(
                                (t) =>
                                  t.planId === p.id &&
                                  !t.deleted &&
                                  t.status !== "취소",
                              ),
                              next = list.find((t) => active(t));
                            return (
                              <button
                                className="next-plan"
                                key={p.id}
                                onClick={() => {
                                  setTab("plans");
                                  setSelectedPlan(p.id);
                                }}
                              >
                                <span className="category">{p.category}</span>
                                <b>{p.title}</b>
                                <span>
                                  {next
                                    ? `다음 · ${next.title}`
                                    : "다음 할 일을 정해보세요"}
                                </span>
                                {list.length > 0 && (
                                  <small>
                                    {
                                      list.filter((t) => t.status === "완료")
                                        .length
                                    }
                                    /{list.length}개 완료
                                  </small>
                                )}
                              </button>
                            );
                          })
                        ) : (
                          <p className="empty">진행 중인 계획이 없습니다.</p>
                        )}
                      </section>
                      <div className="quiet-note">
                        <span>✳</span>
                        <p>
                          모든 일을 오늘 끝내지 않아도 괜찮아요.
                          <br />
                          미완료 일정은 직접 조정할 수 있어요.
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}
              {tab === "tasks" && (
                <>
                  <div className="section-toolbar">
                    <select
                      aria-label="할 일 분야 필터"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      {["전체", ...categories].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <select
                      aria-label="할 일 상태 필터"
                      value={stateFilter}
                      onChange={(e) => setStateFilter(e.target.value)}
                    >
                      {[
                        "전체",
                        "할 일",
                        "진행 중",
                        "완료",
                        "보류",
                        "취소",
                        "삭제됨",
                      ].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <section className="card">
                    {tasks
                      .filter(
                        (t) =>
                          (filter === "전체" || t.category === filter) &&
                          (stateFilter === "삭제됨" ? t.deleted : !t.deleted) &&
                          (stateFilter === "전체" ||
                            stateFilter === "삭제됨" ||
                            t.status === stateFilter),
                      )
                      .map((t) => (
                        <TaskRow key={t.id} task={t} />
                      ))}
                    {tasks.length === 0 && (
                      <p className="empty">첫 할 일을 추가해보세요.</p>
                    )}
                  </section>
                </>
              )}
              {tab === "plans" &&
                (detail ? (
                  <>
                    <button
                      className="text-button"
                      onClick={() => setSelectedPlan(null)}
                    >
                      ← 계획 목록
                    </button>
                    <section className="card plan-detail">
                      <div className="card-heading">
                        <div>
                          <span className="category">
                            {detail.category} · {detail.status}
                            {detail.deleted ? " · 삭제됨" : ""}
                          </span>
                          <h2>{detail.title}</h2>
                        </div>
                        <div className="actions">
                          <button
                            onClick={() =>
                              setEditor({ kind: "plans", item: detail })
                            }
                          >
                            계획 수정
                          </button>
                          {detail.deleted ? (
                            <button
                              onClick={async () => {
                                const { id, uid, version, updatedAt, ...data } =
                                  detail;
                                await save(
                                  "plans",
                                  { ...data, deleted: false },
                                  detail,
                                );
                              }}
                            >
                              복구
                            </button>
                          ) : (
                            <button
                              className="danger"
                              onClick={() => remove("plans", detail)}
                            >
                              삭제
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="prewrap">
                        {detail.goal || "목표 설명을 적어보세요."}
                      </p>
                      {detail.targetDate && (
                        <p className="muted">목표 날짜 · {detail.targetDate}</p>
                      )}
                      <h3>메모</h3>
                      <p className="prewrap muted">
                        {detail.notes || "아직 메모가 없습니다."}
                      </p>
                      <h3>자료 링크</h3>
                      {detail.links.length ? (
                        detail.links.map((url, i) => (
                          <a
                            className="resource-link"
                            key={i}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {url}
                            <ArrowUpRight size={14} />
                          </a>
                        ))
                      ) : (
                        <p className="muted">
                          공고나 학습 자료를 연결해보세요.
                        </p>
                      )}
                    </section>
                    <section className="card">
                      <div className="card-heading">
                        <h2>계획의 할 일</h2>
                        <button
                          disabled={detail.deleted}
                          onClick={() =>
                            setEditor({ kind: "tasks", plan: detail })
                          }
                        >
                          <Plus size={15} />할 일 추가
                        </button>
                      </div>
                      {tasks
                        .filter((t) => t.planId === detail.id && !t.deleted)
                        .map((t) => (
                          <TaskRow key={t.id} task={t} />
                        ))}
                      {!tasks.some(
                        (t) => t.planId === detail.id && !t.deleted,
                      ) && (
                        <p className="empty">다음 행동을 하나 추가해보세요.</p>
                      )}
                    </section>
                  </>
                ) : (
                  <>
                    <div className="section-toolbar">
                      <div className="filter-chips">
                        {["전체", ...categories].map((c) => (
                          <button
                            key={c}
                            aria-pressed={filter === c}
                            onClick={() => setFilter(c)}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                      <select
                        aria-label="계획 상태 필터"
                        value={stateFilter}
                        onChange={(e) => setStateFilter(e.target.value)}
                      >
                        {["전체", ...planStates, "삭제됨"].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                    <div className="plan-grid">
                      {plans
                        .filter(
                          (p) =>
                            (filter === "전체" || p.category === filter) &&
                            (stateFilter === "삭제됨"
                              ? p.deleted
                              : !p.deleted) &&
                            (stateFilter === "전체" ||
                              stateFilter === "삭제됨" ||
                              p.status === stateFilter),
                        )
                        .map((p) => {
                          const list = tasks.filter(
                              (t) =>
                                t.planId === p.id &&
                                !t.deleted &&
                                t.status !== "취소",
                            ),
                            done = list.filter(
                              (t) => t.status === "완료",
                            ).length;
                          return (
                            <button
                              className="card plan-card"
                              key={p.id}
                              onClick={() => setSelectedPlan(p.id)}
                            >
                              <div className="card-heading">
                                <span
                                  className={`category category-${categories.indexOf(p.category)}`}
                                >
                                  {p.category}
                                </span>
                                <span className="state-pill">{p.status}</span>
                              </div>
                              <h2>{p.title}</h2>
                              <p>{p.goal || "목표 설명을 적어보세요"}</p>
                              {list.length > 0 ? (
                                <div className="progress">
                                  <div>
                                    <span
                                      style={{
                                        width: `${(done / list.length) * 100}%`,
                                      }}
                                    />
                                  </div>
                                  <small>
                                    {done}/{list.length}개 할 일 완료
                                  </small>
                                </div>
                              ) : (
                                <small className="muted">
                                  아직 등록한 할 일이 없어요
                                </small>
                              )}
                              <footer>
                                {p.targetDate
                                  ? `목표 ${p.targetDate}`
                                  : p.status === "검토 중"
                                    ? "후보로 보관 중"
                                    : "목표 날짜 미정"}
                                <ArrowUpRight size={16} />
                              </footer>
                            </button>
                          );
                        })}
                    </div>
                    {plans.length === 0 && (
                      <div className="card empty">첫 계획을 만들어보세요.</div>
                    )}
                  </>
                ))}
              {tab === "calendar" && (
                <CalendarView
                  tasks={tasks}
                  plans={plans}
                  zone={zone}
                  onEdit={(t) => setEditor({ kind: "tasks", item: t })}
                />
              )}
              {tab === "settings" && (
                <Settings
                  settings={settings}
                  verified={!!user.emailVerified}
                  onSave={async (s) => {
                    await api("/api/data", { kind: "settings", data: s });
                    setSettings(s);
                  }}
                />
              )}
              {tab === "inbox" && (
                <section className="card">
                  <div className="card-heading">
                    <h2>예약 및 알림 기록</h2>
                    <button onClick={reload}>새로고침</button>
                  </div>
                  <p className="muted">
                    서버 작업자가 예약을 확인한 뒤 표시합니다. 테스트 모드는
                    실제 이메일을 보내지 않습니다.
                  </p>
                  {notifications.length ? (
                    notifications.map((n) => (
                      <article className="notification" key={n.id}>
                        <Bell size={19} />
                        <div>
                          <b>{n.title}</b>
                          <p>
                            {n.dueAt &&
                              DateTime.fromISO(n.dueAt)
                                .setZone(zone)
                                .toFormat("yyyy.MM.dd HH:mm")}{" "}
                            ·{" "}
                            {
                              (
                                {
                                  scheduled: "예약됨",
                                  processing: "처리 중",
                                  sent: "알림 도착",
                                  failed: "실패 · 재시도 대기",
                                  "failed-final": "실패 · 확인 필요",
                                  cancelled: "취소됨",
                                } as Record<string, string>
                              )[n.status]
                            }
                            <br />
                            이메일:{" "}
                            {
                              (
                                {
                                  pending: "처리 대기",
                                  disabled: "비활성화",
                                  test: "테스트 처리 · 실제 발송 없음",
                                  sent: "발송됨",
                                  failed: "실패",
                                  cancelled: "취소됨",
                                } as Record<string, string>
                              )[n.emailStatus]
                            }
                          </p>
                          {n.error && (
                            <small className="error">{n.error}</small>
                          )}
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="empty">
                      <CheckCheck size={28} />
                      <p>아직 알림이 없습니다.</p>
                      <small>
                        할 일에서 알림을 켜고 서버 작업자를 실행하세요.
                      </small>
                    </div>
                  )}
                </section>
              )}
              <footer className="page-footer">
                <span>모루 · 나의 속도로, 꾸준히</span>
                <span>
                  <button
                    className="text-button mobile-logout"
                    onClick={() => signOut(clientAuth())}
                  >
                    로그아웃
                  </button>
                  {zone}
                  <button className="text-button" onClick={reload}>
                    새로고침
                  </button>
                </span>
              </footer>
            </>
          )}
          {error && (
            <div role="alert" className="error global-error">
              {error}
              <button onClick={() => setError("")}>닫기</button>
            </div>
          )}
        </div>
      </main>
      {editor && (
        <Editor
          kind={editor.kind}
          item={editor.item}
          defaultPlan={editor.plan}
          plans={plans}
          zone={zone}
          onClose={() => setEditor(null)}
          onSave={async (data) => {
            await save(editor.kind, data, editor.item);
            setEditor(null);
          }}
        />
      )}
    </div>
  );
}
