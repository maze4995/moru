"use client";
import { useEffect, useState } from "react";
import { api } from "@/client/firebase";
type Status = { configured: boolean; connected: boolean; url: string | null; expiresAt: number | null };
export default function McpConnection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setError("");
    try { setStatus(await api("/api/mcp/connection")); }
    catch { setError("직접 연결 상태를 확인하지 못했습니다."); }
  }
  useEffect(() => { void load(); }, []);
  return <section className="card full">
    <span className="eyebrow">PC 없이 대화로 관리</span><h2>dots · 클라우드 직접 연결</h2>
    <div className="status-box" role="status">
      <b>{!status ? "연결 확인 중…" : !status.configured ? "운영 전환 준비 중" : status.connected ? "직접 연결 허용됨" : "연결 승인 필요"}</b>
      <p>{status?.configured ? "dots에서 아래 주소를 OAuth 방식으로 연결하고 모루 계정으로 승인하세요. PC나 터널 창을 켜 둘 필요가 없습니다." : "직접 연결은 아직 활성화되지 않았습니다. 기존 터널 연결은 아래에서 관리할 수 있습니다."}</p>
      {status?.url && <p className="mcp-url">{status.url}</p>}
      {status?.connected && <p>플러그인의 실제 호출 여부는 dots에서 확인하세요. 연결을 해제하면 현재 토큰과 갱신 권한이 중단됩니다.</p>}
    </div>
    <div className="actions">
      {status?.connected && <button className="danger" disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try { setStatus(await api("/api/mcp/connection", { action: "revoke" })); }
        catch { setError("연결을 해제하지 못했습니다. 다시 시도하세요."); }
        finally { setBusy(false); }
      }}>직접 연결 해제</button>}
      <button disabled={busy} onClick={load}>직접 연결 상태 새로고침</button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

