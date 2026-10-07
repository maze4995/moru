import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
export function admin() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("Firebase 서버 설정이 필요합니다");
  if (
    !!process.env.FIRESTORE_EMULATOR_HOST !==
    !!process.env.FIREBASE_AUTH_EMULATOR_HOST
  )
    throw new Error("Auth와 Firestore Emulator는 함께 설정해야 합니다");
  if (projectId.startsWith("demo-") && !process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("demo 프로젝트에는 Emulator가 필요합니다");
  if (process.env.FIRESTORE_EMULATOR_HOST && !projectId.startsWith("demo-"))
    throw new Error("Emulator는 demo 프로젝트만 허용합니다");
  const app =
    getApps()[0] ||
    initializeApp({
      projectId,
      ...(!process.env.FIRESTORE_EMULATOR_HOST
        ? { credential: applicationDefault() }
        : {}),
    });
  return { db: getFirestore(app), auth: getAuth(app) };
}
export function encode(data: any): any {
  if (data instanceof Timestamp) return data.toDate().toISOString();
  if (Array.isArray(data)) return data.map(encode);
  if (data && typeof data === "object")
    return Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, encode(v)]),
    );
  return data;
}
export function storeTimes(data: Record<string, any>) {
  return {
    ...data,
    ...("startAt" in data
      ? {
          startAt: data.startAt
            ? Timestamp.fromDate(new Date(data.startAt))
            : null,
          endAt: data.endAt ? Timestamp.fromDate(new Date(data.endAt)) : null,
        }
      : {}),
  };
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function authorize(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw new HttpError(401, "로그인이 필요합니다");
  let decoded;
  try {
    decoded = await admin().auth.verifyIdToken(token, true);
  } catch {
    throw new HttpError(401, "로그인이 만료되었습니다");
  }
  if (!process.env.OWNER_UID || decoded.uid !== process.env.OWNER_UID)
    throw new HttpError(403, "허용된 개인 계정이 아닙니다");
  const policy = await admin().db.doc("access/owner").get();
  if (policy.data()?.uid !== decoded.uid)
    throw new HttpError(403, "소유자 설정이 필요합니다");
  return decoded;
}
export function checkOrigin(req: Request) {
  if (!["GET", "HEAD"].includes(req.method)) {
    const origin = req.headers.get("origin");
    if (origin && origin !== process.env.APP_ORIGIN)
      throw new HttpError(403, "허용되지 않은 요청 출처입니다");
  }
}
export function failure(e: unknown) {
  if (e instanceof HttpError)
    return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof Error && e.name === "ZodError")
    return Response.json(
      { error: "입력값을 확인하세요", details: JSON.parse(e.message) },
      { status: 400 },
    );
  return Response.json(
    {
      error:
        "요청을 처리하지 못했습니다. 설정과 서버 상태를 확인하고 다시 시도하세요.",
    },
    { status: 500 },
  );
}
