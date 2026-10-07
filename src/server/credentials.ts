import { applicationDefault, cert, type Credential } from "firebase-admin/app";

// Server only: never import this module into a client component.
export function serverCredential(projectId: string, raw?: string): Credential {
  if (!raw) return applicationDefault();
  try {
    const value = JSON.parse(raw);
    if (
      value.type !== "service_account" ||
      value.project_id !== projectId ||
      typeof value.client_email !== "string" ||
      !value.client_email.endsWith(`@${projectId}.iam.gserviceaccount.com`) ||
      typeof value.private_key !== "string"
    ) throw new Error();
    return cert({
      projectId,
      clientEmail: value.client_email,
      privateKey: value.private_key,
    });
  } catch {
    // SDK/parser errors can contain credential fragments; never pass them onward.
    throw new Error("Firebase 서버 자격증명의 형식과 전용 프로젝트를 확인하세요");
  }
}
