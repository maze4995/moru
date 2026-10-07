"use client";
import { useEffect, useState } from "react";
import { api } from "@/client/firebase";
type Connection = {
  configured: boolean;
  enabled: boolean;
  history: {
    requestId: string;
    kind: string;
    title: string;
    action: string;
    updatedAt: string;
    version: number;
  }[];
};
export default function DotsConnection({ zone }: { zone: string }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setError("");
    try {
      setConnection(await api("/api/dots/connection"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function change(enabled: boolean) {
    if (
      enabled &&
      !confirm(
        "dots 연결에 내 계획·할 일 조회와 등록·수정·완료·복구 가능한 삭제 권한을 허용할까요? 명확한 요청은 즉시 반영합니다. Google Calendar와 이메일 접근은 포함하지 않습니다.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      setConnection(await api("/api/dots/connection", { enabled }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card full">
      <span className="eyebrow">대화로 관리하기</span>
      <h2>dots · 모루 연결</h2>
      <p>
        명확한 등록·수정·완료 요청은 즉시 반영합니다. 대상이나 날짜가 모호할
        때만 다시 확인합니다.
      </p>
      <div className="status-box" role="status">
        <b>
          {!connection
            ? "연결 설정 확인 중…"
            : !connection.configured
              ? "연결 준비 필요 · 접근 꺼짐"
              : connection.enabled
                ? "모루 접근 허용됨"
                : "모루 접근 꺼짐"}
        </b>
        <p>
          {connection?.enabled
            ? "앱의 접근 허용 상태입니다. dots 플러그인의 실제 연결 여부는 dots에서 확인하세요. 이 PC와 모루 서버·연결 프로그램이 실행 중이어야 합니다."
            : "서버 연결 키를 준비하고 접근을 허용한 뒤 dots에 전용 플러그인을 연결하세요. 연결하지 않아도 기존 계획과 할 일은 계속 사용할 수 있습니다."}
        </p>
      </div>
      <div className="actions">
        {connection?.enabled ? (
          <button
            className="danger"
            disabled={busy}
            onClick={() => change(false)}
          >
            dots 접근 해제
          </button>
        ) : (
          <button
            disabled={busy || !connection?.configured}
            onClick={() => change(true)}
          >
            dots 접근 허용
          </button>
        )}
        <button disabled={busy} onClick={load}>
          연결 상태·기록 새로고침
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <h3>대화에서 반영한 최근 변경</h3>
      {connection?.history.length ? (
        connection.history.map((entry) => (
          <article className="notification" key={entry.requestId}>
            <div>
              <b>{entry.title}</b>
              <p>
                {entry.kind === "plans" ? "계획" : "할 일"} ·{" "}
                {entry.action === "create" ? "등록" : "수정·상태 변경"} · 버전{" "}
                {entry.version}
                <br />
                {new Date(entry.updatedAt).toLocaleString("ko-KR", {
                  timeZone: zone,
                })}
              </p>
            </div>
          </article>
        ))
      ) : (
        <p className="empty">아직 대화에서 반영한 변경이 없습니다.</p>
      )}
    </section>
  );
}
