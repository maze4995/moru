"use client";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { api, clientAuth, login } from "@/client/firebase";

export default function McpConsent() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [details, setDetails] = useState<{scope: string} | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    try {
      return onAuthStateChanged(clientAuth(), value => { setUser(value); setReady(true); setDetails(null); setError(""); });
    } catch { setReady(true); setError("로그인 설정을 불러오지 못했습니다."); }
  }, []);
  useEffect(() => {
    if (!user) return;
    let active = true;
    api("/api/mcp/consent" + window.location.search)
      .then(value => { if (active) setDetails(value); })
      .catch(() => { if (active) setError("연결 요청을 확인하지 못했습니다. 모루 소유자 계정인지 확인하고 dots에서 다시 연결해 주세요."); });
    return () => { active = false; };
  }, [user]);
  async function act(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); }
    catch { setError("요청을 처리하지 못했습니다. dots에서 연결을 다시 시작해 주세요."); }
    finally { setBusy(false); }
  }
  async function decide(allow: boolean) {
    await act(async () => {
      const params = new URLSearchParams(window.location.search);
      const parameters: Record<string, string> = {};
      for (const [key, value] of params) {
        if (Object.hasOwn(parameters, key)) throw new Error("Duplicate parameter");
        parameters[key] = value;
      }
      const result = await api("/api/mcp/consent", { parameters, allow });
      window.location.assign(result.redirect);
    });
  }
  return <main className="mcp-consent">
    <a href="/">모루 홈</a>
    <section className="card">
      <span className="eyebrow">대화로 관리하기</span>
      <h1>dots와 모루 연결</h1>
      <p>PC를 켜 두지 않아도 대화에서 모루를 사용할 수 있어요.</p>
      {!ready ? <p role="status">로그인 상태를 확인하고 있어요…</p> : !user ?
        <button className="primary" disabled={busy} onClick={() => act(async () => { await login(); })}>모루 계정으로 로그인</button> :
        <>
          <p className="muted">{user.email}</p>
          {details ? <>
            <h2>ChatGPT / dots에 허용할 범위</h2>
            <ul>
              <li>내 계획과 할 일 조회</li>
              {details.scope.includes("moru:write") && <li>명확히 요청한 등록·수정·완료·보류·일정 변경과 복구 가능한 삭제</li>}
            </ul>
            <p>Google Calendar·이메일 권한은 포함하지 않습니다. 기존 직접 연결이 있다면 새 연결로 교체됩니다. 모루 설정에서 언제든 해제할 수 있습니다.</p>
            <div className="actions">
              <button className="primary" disabled={busy} onClick={() => decide(true)}>허용하고 dots로 돌아가기</button>
              <button disabled={busy} onClick={() => decide(false)}>취소</button>
            </div>
          </> : !error && <p role="status">연결 요청을 확인하고 있어요…</p>}
          <button disabled={busy} onClick={() => act(async () => { await signOut(clientAuth()); })}>다른 계정으로 로그인</button>
        </>}
      {error && <p role="alert" className="error">{error}</p>}
    </section>
  </main>;
}

