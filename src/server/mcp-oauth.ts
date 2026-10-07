import { randomBytes } from "node:crypto";
import { clientMetadata, verifyClient } from "./mcp-client";
import { admin, HttpError } from "./firebase";
import {
  type Authorization, OAuthError, mcpConfig, enabled, hash, pkce, equal,
  parseAuthorization, limitedText, scopes, clientIdAllowed,
} from "./mcp-protocol";

const random = () => randomBytes(32).toString("base64url");
const ACCESS_MS = 15 * 60 * 1000, REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
const opaque = (v: string) => /^[A-Za-z0-9_-]{43}$/.test(v);
// One private connection and one pending code per owner: storage stays bounded.
const ref = (uid: string) => admin().db.doc("privateMcp/" + uid);
const codeRef = (uid: string) => ref(uid).collection("codes").doc("pending");

async function owner() {
  const uid = process.env.OWNER_UID;
  if (!uid) throw new OAuthError("access_denied", 403);
  const { db, auth } = admin();
  const [policy, user] = await Promise.all([
    db.doc("access/owner").get(), auth.getUser(uid).catch(() => null),
  ]);
  if (policy.data()?.uid !== uid || !user || user.disabled) throw new OAuthError("access_denied", 403);
  return uid;
}
export async function validateAuthorization(raw: unknown): Promise<Authorization> {
  const value = parseAuthorization(raw);
  const metadata = await clientMetadata(value.client_id);
  if (!metadata.redirect_uris.includes(value.redirect_uri) ||
      !metadata.methods.some(method => ["none", "private_key_jwt"].includes(method)))
    throw new OAuthError("invalid_client");
  return value;
}
export async function consent(uid: string, raw: unknown, allow: boolean) {
  if (uid !== await owner()) throw new OAuthError("access_denied", 403);
  const value = await validateAuthorization(raw);
  const redirect = new URL(value.redirect_uri);
  redirect.searchParams.set("state", value.state);
  redirect.searchParams.set("iss", mcpConfig().origin);
  if (!allow) { redirect.searchParams.set("error", "access_denied"); return redirect.href; }
  const code = random();
  await admin().db.runTransaction(async tx => {
    const current = (await tx.get(ref(uid))).data();
    tx.set(codeRef(uid), {
      uid, codeHash: hash(code), clientId: value.client_id, redirectUri: value.redirect_uri,
      resource: value.resource, scope: value.scope, challenge: value.code_challenge,
      expiresAt: Date.now() + 5 * 60 * 1000, revision: current?.revision || 0,
    });
  });
  redirect.searchParams.set("code", code);
  return redirect.href;
}
export async function exchange(input: Record<string, string>) {
  const { resource, origin } = mcpConfig();
  if (!clientIdAllowed(input.client_id || "")) throw new OAuthError("invalid_client");
  if (input.resource !== resource) throw new OAuthError("invalid_target");
  if (input.client_secret) throw new OAuthError("invalid_client");
  if (!["authorization_code", "refresh_token"].includes(input.grant_type)) throw new OAuthError("unsupported_grant_type");
  if (input.grant_type === "authorization_code" &&
      (!opaque(input.code || "") || !/^[A-Za-z0-9._~-]{43,128}$/.test(input.code_verifier || "")))
    throw new OAuthError("invalid_grant");
  if (input.grant_type === "refresh_token" && !opaque(input.refresh_token || "")) throw new OAuthError("invalid_grant");
  const uid = await owner();
  const assertion = await verifyClient(input);
  const access = random(), refresh = random(), now = Date.now();
  const result = await admin().db.runTransaction(async tx => {
    const current = (await tx.get(ref(uid))).data();
    const recentAssertions: {hash:string;expiresAt:number}[] = (current?.recentAssertions || []).filter((a: {expiresAt:number}) => a.expiresAt > now);
    if (assertion) {
      if (recentAssertions.some(a => a.hash === assertion.hash)) throw new OAuthError("invalid_client", 401);
      if (recentAssertions.length >= 64) throw new OAuthError("temporarily_unavailable", 429);
      recentAssertions.push(assertion);
    }
    if (input.grant_type === "authorization_code") {
      const code = (await tx.get(codeRef(uid))).data();
      if (!code || code.uid !== uid || code.expiresAt <= now || !equal(code.codeHash, hash(input.code)) ||
          code.clientId !== input.client_id || code.redirectUri !== input.redirect_uri ||
          code.resource !== resource || code.challenge !== pkce(input.code_verifier) ||
          code.revision !== (current?.revision || 0)) throw new OAuthError("invalid_grant");
      const grant = {
        uid, enabled: true, recentAssertions, issuer: origin, resource, clientId: code.clientId, scope: code.scope,
        accessHash: hash(access), accessExpiresAt: now + ACCESS_MS,
        refreshHash: hash(refresh), refreshExpiresAt: now + REFRESH_MS,
        previousRefreshHash: null, revision: (current?.revision || 0) + 1, updatedAt: now,
      };
      tx.set(ref(uid), grant);
      tx.delete(codeRef(uid));
      return { scope: code.scope, replay: false };
    }
    if (!current?.enabled || current.uid !== uid || current.issuer !== origin ||
        current.resource !== resource || current.clientId !== input.client_id || current.refreshExpiresAt <= now)
      throw new OAuthError("invalid_grant");
    if (current.previousRefreshHash && equal(current.previousRefreshHash, hash(input.refresh_token))) {
      tx.update(ref(uid), { enabled: false, accessHash: null, refreshHash: null, revision: current.revision + 1 });
      tx.delete(codeRef(uid));
      return { scope: "", replay: true };
    }
    if (!equal(current.refreshHash, hash(input.refresh_token))) throw new OAuthError("invalid_grant");
    if (input.scope && scopes(input.scope) !== current.scope) throw new OAuthError("invalid_scope");
    tx.update(ref(uid), {
      accessHash: hash(access), accessExpiresAt: now + ACCESS_MS,
      refreshHash: hash(refresh), previousRefreshHash: current.refreshHash, updatedAt: now, recentAssertions,
    });
    return { scope: current.scope, replay: false };
  });
  // Throw after commit so reuse detection actually revokes the grant.
  if (result.replay) throw new OAuthError("invalid_grant");
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_MS / 1000,
    refresh_token: refresh, scope: result.scope };
}
export async function authenticateMcp(req: Request) {
  const { origin, resource } = mcpConfig();
  const supplied = req.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!supplied) throw new OAuthError("invalid_token", 401);
  const uid = process.env.OWNER_UID;
  if (!uid) throw new OAuthError("invalid_token", 401);
  const grant = (await ref(uid).get()).data();
  if (!grant?.enabled || grant.uid !== uid || grant.issuer !== origin || grant.resource !== resource ||
      grant.accessExpiresAt <= Date.now() || !equal(grant.accessHash, hash(supplied)))
    throw new OAuthError("invalid_token", 401);
  await owner();
  return { uid, scope: grant.scope as string };
}
export async function revoke(uid: string) {
  // Called only from the Firebase-authenticated owner endpoint; invalidate pending codes too.
  if (uid !== process.env.OWNER_UID) throw new HttpError(403, "소유자만 연결을 해제할 수 있습니다");
  await admin().db.runTransaction(async tx => {
    const current = (await tx.get(ref(uid))).data();
    tx.set(ref(uid), { uid, enabled: false, recentAssertions: current?.recentAssertions || [], revision: (current?.revision || 0) + 1, updatedAt: Date.now() });
    tx.delete(codeRef(uid));
  });
}
export async function connectionStatus(uid: string) {
  const configured = enabled();
  const grant = (await ref(uid).get()).data();
  return { configured, connected: configured && grant?.uid === uid && grant.enabled === true &&
    grant.refreshExpiresAt > Date.now(), url: configured ? mcpConfig().resource : null,
    expiresAt: grant?.enabled ? grant.refreshExpiresAt : null };
}

