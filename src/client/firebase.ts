import { getApps, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
} from "firebase/auth";
const configured = !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
export const emulator = process.env.NEXT_PUBLIC_USE_EMULATORS === "true";
export function clientAuth() {
  if (!configured)
    throw new Error("Firebase 환경변수를 설정한 후 앱을 다시 실행하세요");
  const app =
    getApps()[0] ||
    initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  const auth = getAuth(app);
  if (emulator && !(auth as any)._moruConnected) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
    (auth as any)._moruConnected = true;
  }
  return auth;
}
export async function login() {
  const auth = clientAuth();
  if (emulator)
    return signInWithEmailAndPassword(
      auth,
      "owner@example.test",
      "moru-local-only",
    );
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(auth, provider);
}
export async function api(path: string, body?: unknown) {
  const user = clientAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다");
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => {
    throw new Error("서버 응답을 받지 못했습니다. 잠시 후 새로고침하고 다시 시도하세요.");
  });
  if (!res.ok) throw new Error(data.error || "저장하지 못했습니다");
  return data;
}
