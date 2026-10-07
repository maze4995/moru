"use client";
import { useEffect, useState } from "react";
import { api } from "@/client/firebase";
import type { Settings as Preferences } from "@/domain/model";
import DotsConnection from "./DotsConnection";
export default function Settings({
  settings,
  onSave,
  verified,
}: {
  settings: Preferences;
  onSave: (s: Preferences) => Promise<void>;
  verified: boolean;
}) {
  const [form, setForm] = useState(settings),
    [status, setStatus] = useState<any>(null),
    [connection, setConnection] = useState<any>(null),
    [calendars, setCalendars] = useState<any[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const [s, c] = await Promise.all([
      api("/api/status"),
      api("/api/calendar"),
    ]);
    setStatus(s);
    setConnection(c);
    setSelected(c.selected);
    if (c.connected) setCalendars(await api("/api/calendar?action=calendars"));
  }
  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, []);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-grid">
      <section className="card">
        <span className="eyebrow">내 공간의 기준</span>
        <h2>시간대와 알림</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action(async () => {
              await onSave(form);
              setMessage(
                "설정을 저장했습니다. 다음 서버 처리 때 알림 시각을 다시 계산합니다.",
              );
            });
          }}
        >
          <label>
            시간대
            <input
              list="timezones"
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            />
            <datalist id="timezones">
              {[
                "Asia/Seoul",
                "Asia/Tokyo",
                "America/New_York",
                "America/Los_Angeles",
                "Europe/London",
                "UTC",
              ].map((z) => (
                <option key={z}>{z}</option>
              ))}
            </datalist>
            <small>
              날짜 마감은 그대로 유지됩니다. 실행 시간의 표시와 날짜 알림 기준은
              새 시간대를 따릅니다.
            </small>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.emailEnabled}
              disabled={!verified}
              onChange={(e) =>
                setForm({ ...form, emailEnabled: e.target.checked })
              }
            />{" "}
            내 확인된 이메일로도 알림 받기
          </label>
          {!verified && (
            <p className="muted">
              Firebase에서 이메일 확인을 마쳐야 켤 수 있습니다.
            </p>
          )}
          <div className="status-box">
            <b>서버 예약 실행 · {status?.scheduler ? "구성됨" : "설정 필요"}</b>
            <p>
              {status?.scheduler
                ? "독립 작업자 또는 외부 예약 실행 상태를 운영 환경에서 확인하세요."
                : "앱을 닫아도 알림을 받으려면 서버에서 npm run worker를 계속 실행해야 합니다."}
            </p>
            <b>
              이메일 ·{" "}
              {status?.emailMode === "live"
                ? status.emailActive
                  ? "실발송 구성됨"
                  : "발송 비활성화"
                : "테스트 모드 · 실제 메일 없음"}
            </b>
            <p>
              실발송에는 이메일 제공업체, 발신 주소, 서버 예약 실행 설정이 모두
              필요합니다.
            </p>
          </div>
          <button className="primary" disabled={busy}>
            설정 저장
          </button>
        </form>
      </section>
      <section className="card">
        <span className="eyebrow">외부 일정 · 읽기 전용</span>
        <h2>Google Calendar</h2>
        <p className="muted">
          로그인과 별도의 접근 동의가 필요합니다. Google 일정은
          생성·변경·삭제하지 않습니다.
        </p>
        <div className="status-box">
          <b>
            {connection?.connected
              ? "연결됨"
              : connection?.configured
                ? "연결되지 않음"
                : "OAuth 설정 없음 · 연결되지 않음"}
          </b>
          <p>
            {connection?.configured
              ? "표시할 캘린더를 선택하고 캘린더 화면에서 새로고침하세요."
              : "서버의 GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, TOKEN_ENCRYPTION_KEY를 설정하세요."}
          </p>
          {connection?.lastSync && (
            <small>
              마지막 동기화:{" "}
              {new Date(connection.lastSync).toLocaleString("ko-KR", {
                timeZone: settings.timezone,
              })}
            </small>
          )}
          {connection?.error && <p role="alert">{connection.error}</p>}
        </div>
        {connection?.connected ? (
          <>
            <fieldset>
              <legend>표시할 캘린더</legend>
              {calendars.map((c) => (
                <label className="checkbox" key={c.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(c.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, c.id]
                          : selected.filter((x) => x !== c.id),
                      )
                    }
                  />
                  {c.title}
                  {c.primary ? " · 기본" : ""}
                </label>
              ))}
            </fieldset>
            <div className="actions">
              <button
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await api("/api/calendar", {
                      action: "select",
                      ids: selected,
                    });
                    setMessage("표시할 캘린더를 저장했습니다.");
                  })
                }
              >
                선택 저장
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    if (
                      !confirm(
                        "Google Calendar 연결을 해제할까요? 앱의 계획과 할 일은 유지됩니다.",
                      )
                    )
                      return;
                    const result = await api("/api/calendar", {
                      action: "disconnect",
                    });
                    await load();
                    setCalendars([]);
                    setMessage(
                      result.revoked
                        ? "연결을 해제했습니다."
                        : "앱의 토큰은 삭제했습니다. Google 권한 철회에 실패해 Google 계정의 연결된 앱에서도 해제해야 합니다.",
                    );
                  })
                }
              >
                연결 해제
              </button>
            </div>
          </>
        ) : (
          <button
            disabled={!connection?.configured || busy}
            onClick={() =>
              action(async () => {
                const r = await api("/api/calendar", { action: "connect" });
                window.location.assign(r.url);
              })
            }
          >
            Google Calendar 연결
          </button>
        )}
      </section>
      {message && (
        <p role="status" className="notice full">
          {message}
        </p>
      )}
      <DotsConnection zone={settings.timezone} />
      <section className="card full">
        <h2>개인용 공간</h2>
        <p>
          앱 전용 Firebase 프로젝트의 OWNER_UID와 접근 정책에 등록된 계정만
          사용할 수 있습니다. 기존 서비스의 운영 데이터와 비밀값을 재사용하지
          마세요.
        </p>
        <p className="muted">
          삭제한 계획과 할 일은 목록의 ‘삭제됨’ 필터에서 복구할 수 있습니다.
          설정한 실행 시간은 자동으로 다음 날로 이동하지 않습니다.
        </p>
      </section>
    </div>
  );
}
