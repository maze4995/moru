import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { admin, HttpError } from "./firebase";
import { normalizeEvents } from "../domain/model";
export const scopes = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
];
export const oauthReady = () =>
  !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REDIRECT_URI &&
    process.env.TOKEN_ENCRYPTION_KEY
  );
function key() {
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY || "", "base64");
  if (key.length !== 32)
    throw new HttpError(503, "토큰 암호화 키 설정이 필요합니다");
  return key;
}
export function seal(value: unknown) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
export function unseal(value: string) {
  const data = Buffer.from(value, "base64"),
    decipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      decipher.update(data.subarray(28)),
      decipher.final(),
    ]).toString(),
  );
}
export const connectionRef = (uid: string) =>
  admin().db.doc(`privateCalendar/${uid}`);
export async function beginConnect(uid: string) {
  if (!oauthReady()) throw new HttpError(503, "Google OAuth 설정이 없습니다");
  const state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(32).toString("base64url");
  await admin()
    .db.doc(`oauthStates/${createHash("sha256").update(state).digest("hex")}`)
    .set({
      uid,
      verifier: seal(verifier),
      expiresAt: Timestamp.fromMillis(Date.now() + 600000),
    });
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  return {
    state,
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
  };
}
async function exchange(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      ...params,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok)
    throw new HttpError(
      502,
      "Google 인증이 만료되었거나 거절되었습니다. 다시 연결하세요",
    );
  return res.json();
}
export async function completeConnect(state: string, code: string) {
  const ref = admin().db.doc(
    `oauthStates/${createHash("sha256").update(state).digest("hex")}`,
  );
  const stateData = await admin().db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data();
    if (
      !d ||
      d.expiresAt.toMillis() < Date.now() ||
      d.uid !== process.env.OWNER_UID
    )
      throw new HttpError(403, "만료된 연결 요청입니다");
    tx.delete(ref);
    return d;
  });
  if (
    (await admin().db.doc("access/owner").get()).data()?.uid !== stateData.uid
  )
    throw new HttpError(403, "소유자 설정을 확인하세요");
  const token = await exchange({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    code_verifier: unseal(stateData.verifier),
  });
  if (
    !token.refresh_token ||
    !scopes.every((s) => (token.scope || "").split(" ").includes(s))
  )
    throw new HttpError(400, "두 읽기 권한에 모두 동의해야 합니다");
  await connectionRef(stateData.uid).set({
    tokens: seal({
      refresh: token.refresh_token,
      access: token.access_token,
      expires: Date.now() + token.expires_in * 1000,
    }),
    selected: [],
    lastSync: null,
    error: null,
  });
}
async function accessToken(uid: string) {
  const ref = connectionRef(uid),
    snap = await ref.get();
  if (!snap.exists)
    throw new HttpError(409, "Google Calendar가 연결되지 않았습니다");
  let token = unseal(snap.data()!.tokens);
  if (token.expires < Date.now() + 60000) {
    const next = await exchange({
      grant_type: "refresh_token",
      refresh_token: token.refresh,
    });
    token = {
      ...token,
      access: next.access_token,
      expires: Date.now() + next.expires_in * 1000,
    };
    await ref.update({ tokens: seal(token) });
  }
  return token.access as string;
}
async function googleList(
  token: string,
  path: string,
  params: Record<string, string> = {},
) {
  const items: any[] = [];
  let pageToken = "";
  do {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/${path}?${new URLSearchParams({ ...params, ...(pageToken ? { pageToken } : {}) })}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!res.ok)
      throw new HttpError(
        502,
        "Google 일정을 읽지 못했습니다. 권한·연결 상태를 확인하고 다시 시도하세요",
      );
    const body = await res.json();
    items.push(...(body.items || []));
    pageToken = body.nextPageToken || "";
    if (items.length > 20000)
      throw new HttpError(
        400,
        "일정이 너무 많습니다. 더 짧은 기간을 선택하세요",
      );
  } while (pageToken);
  return items;
}
export async function listCalendars(uid: string) {
  const token = await accessToken(uid);
  return (await googleList(token, "users/me/calendarList")).map((c) => ({
    id: c.id,
    title: c.summary,
    primary: !!c.primary,
  }));
}
export async function selectCalendars(uid: string, ids: unknown) {
  if (
    !Array.isArray(ids) ||
    ids.length > 20 ||
    ids.some((x) => typeof x !== "string")
  )
    throw new HttpError(400, "캘린더 선택을 확인하세요");
  const available = await listCalendars(uid);
  if (ids.some((id) => !available.some((c) => c.id === id)))
    throw new HttpError(400, "접근할 수 없는 캘린더입니다");
  await connectionRef(uid).update({
    selected: [...new Set(ids)],
    lastSync: null,
  });
}
export async function fetchEvents(uid: string, from: string, to: string) {
  const start = Date.parse(from),
    end = Date.parse(to);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > 93 * 86400000
  )
    throw new HttpError(400, "조회 기간은 최대 93일입니다");
  try {
    const connection = (await connectionRef(uid).get()).data();
    if (!connection) throw new HttpError(409, "Calendar를 먼저 연결하세요");
    const token = await accessToken(uid);
    const groups = await Promise.all(
      (connection.selected as string[]).map(async (id) =>
        normalizeEvents(
          id,
          await googleList(
            token,
            `calendars/${encodeURIComponent(id)}/events`,
            {
              timeMin: new Date(start).toISOString(),
              timeMax: new Date(end).toISOString(),
              singleEvents: "true",
              showDeleted: "true",
              maxResults: "2500",
            },
          ),
        ),
      ),
    );
    const lastSync = new Date().toISOString();
    await connectionRef(uid).update({ lastSync, error: null });
    return { events: groups.flat(), lastSync };
  } catch (e) {
    await connectionRef(uid)
      .update({ error: "동기화 실패 · 기존 앱 데이터는 안전합니다" })
      .catch(() => {});
    throw e;
  }
}
export async function disconnect(uid: string) {
  const ref = connectionRef(uid),
    doc = await ref.get();
  let revoked = true;
  if (doc.exists) {
    const token = unseal(doc.data()!.tokens);
    try {
      const r = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: token.refresh }),
        signal: AbortSignal.timeout(10000),
      });
      revoked = r.ok;
    } catch {
      revoked = false;
    }
  }
  await ref.delete();
  return { revoked };
}
