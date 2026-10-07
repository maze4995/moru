import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import { generateKeyPair, exportJWK, SignJWT, type JWK } from "jose";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { admin } from "../src/server/firebase";
import { consent, exchange, authenticateMcp, revoke } from "../src/server/mcp-oauth";
import { pkce } from "../src/server/mcp-protocol";
import { POST as mcpPOST } from "../src/app/api/mcp/route";
import { GET as consentGET, POST as consentPOST } from "../src/app/api/mcp/consent/route";
import { POST as tokenPOST } from "../src/app/oauth/token/route";
import { POST as revokePOST } from "../src/app/api/mcp/connection/route";
import { GET as metadata } from "../src/app/.well-known/oauth-authorization-server/route";
const uid="mcp-test-owner", origin="https://moru-test.example", resource=origin+"/api/mcp";
const client="https://chatgpt.com/oauth/client.json", redirect="https://chatgpt.com/connector_platform/oauth/callback";
const verifier="v".repeat(43);
let env:RulesTestEnvironment, ownerToken:string, strangerToken:string;
let signingKey: CryptoKey, publicJwk:JWK;
const parameters=(scope="moru:read moru:write") => ({response_type:"code",client_id:client,redirect_uri:redirect,
  resource,scope,state:"test-state",code_challenge:pkce(verifier),code_challenge_method:"S256"});
beforeAll(async () => {
  Object.assign(process.env,{FIREBASE_PROJECT_ID:"demo-moru-tests",FIRESTORE_EMULATOR_HOST:"127.0.0.1:8088",
    FIREBASE_AUTH_EMULATOR_HOST:"127.0.0.1:9098",OWNER_UID:uid,APP_ORIGIN:origin,MORU_MCP_ENABLED:"true"});
  env=await initializeTestEnvironment({projectId:"demo-moru-tests",firestore:{host:"127.0.0.1",port:8088,rules:readFileSync("firestore.rules","utf8")}});
  const pair=await generateKeyPair("RS256"); signingKey=pair.privateKey; publicJwk={...await exportJWK(pair.publicKey),kid:"test",alg:"RS256"};
  await env.clearFirestore();
  const {db,auth}=admin();
  await db.doc("access/owner").set({uid});
  const tokens=[];
  for(const id of [uid,"mcp-stranger"]) {
    await auth.deleteUser(id).catch(()=>{});
    await auth.createUser({uid:id,email:id+"@example.test",emailVerified:true,password:"testing-only"});
    const r=await fetch("http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:id+"@example.test",password:"testing-only",returnSecureToken:true}),
    });
    tokens.push((await r.json()).idToken);
  }
  [ownerToken,strangerToken]=tokens;
});
beforeEach(() => {
  const native=globalThis.fetch;
  vi.stubGlobal("fetch",vi.fn((input:RequestInfo|URL, init?:RequestInit) => {
    if(String(input)===client) return Promise.resolve(new Response(JSON.stringify({client_id:client,redirect_uris:[redirect],token_endpoint_auth_method:"private_key_jwt",token_endpoint_auth_methods_supported:["none","private_key_jwt"],jwks_uri:"https://chatgpt.com/oauth/jwks.json"})));
    if(String(input)==="https://chatgpt.com/oauth/jwks.json") return Promise.resolve(new Response(JSON.stringify({keys:[publicJwk]})));
    return native(input,init);
  }));
});
afterEach(()=>vi.unstubAllGlobals());
afterAll(async()=>{delete process.env.MORU_MCP_ENABLED;await env.cleanup();});
function browserRequest(path:string,body?:unknown,token=ownerToken,from=origin) {
  return new Request(origin+path,{method:body?"POST":"GET",headers:{Authorization:"Bearer "+token,Origin:from,"Content-Type":"application/json"},
    ...(body?{body:JSON.stringify(body)}:{})});
}
async function code(scope?:string) {
  return new URL(await consent(uid,parameters(scope),true)).searchParams.get("code")!;
}
function exchangeInput(c:string) {return {grant_type:"authorization_code",client_id:client,resource,redirect_uri:redirect,code:c,code_verifier:verifier};}
async function tokens(scope?:string) {return exchange(exchangeInput(await code(scope)));}
function refreshInput(refresh:string) {return {grant_type:"refresh_token",client_id:client,resource,refresh_token:refresh};}
function bearer(token:string) {return new Request(resource,{headers:{Authorization:"Bearer "+token}});}
async function rpc(token:string,method:string,params:unknown={}) {
  return mcpPOST(new Request(resource,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",
    Accept:"application/json, text/event-stream","MCP-Protocol-Version":"2025-03-26"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})}));
}
describe("direct MCP and OAuth on Firebase Emulator",()=>{
  it("blocks anonymous, other UID and cross-origin consent; metadata advertises PKCE and CIMD",async()=>{
    const query=new URLSearchParams(parameters()).toString();
    expect((await consentGET(browserRequest("/api/mcp/consent?"+query,undefined,"forged"))).status).toBe(401);
    expect((await consentPOST(browserRequest("/api/mcp/consent",{parameters:parameters(),allow:true},strangerToken))).status).toBe(403);
    expect((await consentPOST(browserRequest("/api/mcp/consent",{parameters:parameters(),allow:true},ownerToken,"https://evil.test"))).status).toBe(403);
    expect((await consentGET(browserRequest("/api/mcp/consent?"+query))).status).toBe(200);
    const m=await metadata().json();expect(m.code_challenge_methods_supported).toEqual(["S256"]);
    expect(m.client_id_metadata_document_supported).toBe(true);
  });
  it("returns the state and issuer on denial without issuing credentials",async()=>{
    const result=new URL(await consent(uid,parameters(),false));
    expect(result.searchParams.get("error")).toBe("access_denied");expect(result.searchParams.get("state")).toBe("test-state");
    expect(result.searchParams.get("iss")).toBe(origin);expect(result.searchParams.has("code")).toBe(false);
  });
  it("binds codes to PKCE, client, redirect and audience and consumes them once atomically",async()=>{
    const c=await code();
    for(const patch of [{code_verifier:"x".repeat(43)},{redirect_uri:redirect+"/bad"},{resource:"https://evil.test"},
      {client_id:"https://chatgpt.com/oauth/other/client.json"}]) await expect(exchange({...exchangeInput(c),...patch})).rejects.toThrow();
    const results=await Promise.allSettled([exchange(exchangeInput(c)),exchange(exchangeInput(c))]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    await expect(exchange(exchangeInput(c))).rejects.toThrow();
  });
  it("verifies signed client assertions and rejects wrong audience, expiry and replay",async()=>{
    const c=await code();
    const assertion=async(audience=origin+"/oauth/token",expiry="5m") => new SignJWT({})
      .setProtectedHeader({alg:"RS256",kid:"test"}).setIssuer(client).setSubject(client)
      .setAudience(audience).setIssuedAt().setExpirationTime(expiry).setJti(randomUUID()).sign(signingKey);
    const fields=(jwt:string)=>({client_assertion:jwt,client_assertion_type:"urn:ietf:params:oauth:client-assertion-type:jwt-bearer"});
    await expect(exchange({...exchangeInput(c),...fields(await assertion("https://evil.test/token"))})).rejects.toThrow();
    await expect(exchange({...exchangeInput(c),...fields(await assertion(origin+"/oauth/token","-1m"))})).rejects.toThrow();
    const jwt=await assertion();
    const grant=await exchange({...exchangeInput(c),...fields(jwt)});
    await expect(exchange({...refreshInput(grant.refresh_token),...fields(jwt)})).rejects.toThrow();
    const rotated=await exchange({...refreshInput(grant.refresh_token),...fields(await assertion())});
    expect((await authenticateMcp(bearer(rotated.access_token))).uid).toBe(uid);
  });
  it("rotates refresh credentials, rejects escalation and revokes the family on previous-token reuse",async()=>{
    const first=await tokens("moru:read");
    await expect(exchange({...refreshInput(first.refresh_token),scope:"moru:read moru:write"})).rejects.toThrow();
    const second=await exchange(refreshInput(first.refresh_token));
    await expect(authenticateMcp(bearer(first.access_token))).rejects.toThrow();
    expect((await authenticateMcp(bearer(second.access_token))).uid).toBe(uid);
    await expect(exchange(refreshInput(first.refresh_token))).rejects.toThrow();
    await expect(authenticateMcp(bearer(second.access_token))).rejects.toThrow();
  });
  it("enforces expiry, owner policy, disabled users and revocation of pending codes",async()=>{
    const grant=await tokens();
    const root=admin().db.doc("privateMcp/"+uid);
    await root.update({accessExpiresAt:0});await expect(authenticateMcp(bearer(grant.access_token))).rejects.toThrow();
    await root.update({refreshExpiresAt:0});await expect(exchange(refreshInput(grant.refresh_token))).rejects.toThrow();
    const c=await code();await admin().db.doc("privateMcp/"+uid+"/codes/pending").update({expiresAt:0});
    await expect(exchange(exchangeInput(c))).rejects.toThrow();
    const active=await tokens();
    await admin().auth.updateUser(uid,{disabled:true});await expect(authenticateMcp(bearer(active.access_token))).rejects.toThrow();
    await admin().auth.updateUser(uid,{disabled:false});
    await admin().db.doc("access/owner").set({uid:"someone-else"});
    await expect(authenticateMcp(bearer(active.access_token))).rejects.toThrow();
    await admin().db.doc("access/owner").set({uid});
    const pending=await code();
    expect((await revokePOST(browserRequest("/api/mcp/connection",{action:"revoke"}))).status).toBe(200);
    await expect(exchange(exchangeInput(pending))).rejects.toThrow();
    await expect(authenticateMcp(bearer(active.access_token))).rejects.toThrow();
  });
  it("keeps all auth documents inaccessible from client Firestore, including the owner",async()=>{
    await tokens();
    for(const actor of [env.unauthenticatedContext(),env.authenticatedContext(uid),env.authenticatedContext("mcp-stranger")]) {
      await assertFails(getDoc(doc(actor.firestore(),"privateMcp/"+uid)));
      await assertFails(setDoc(doc(actor.firestore(),"privateMcp/"+uid),{enabled:true}));
      await assertFails(getDoc(doc(actor.firestore(),"privateMcp/"+uid+"/codes/pending")));
    }
  });
  it("rejects malformed token requests and advertises a canonical 401 challenge",async()=>{
    const bad=await tokenPOST(new Request(origin+"/oauth/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=authorization_code&client_id=x&client_id=y"}));
    expect(bad.status).toBe(400);expect(bad.headers.get("Cache-Control")).toBe("no-store");
    const response=await rpc("invalid","tools/list");
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(origin+"/.well-known/oauth-protected-resource");
  });
  it("serves MCP discovery and read tools but refuses writes under read-only consent",async()=>{
    const grant=await tokens("moru:read");
    const init=await rpc(grant.access_token,"initialize",{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"test",version:"1"}});
    expect(init.status).toBe(200);expect((await init.json()).result.serverInfo.name).toBe("moru-planner");
    const listed=await rpc(grant.access_token,"tools/list");expect((await listed.json()).result.tools).toHaveLength(9);
    const read=await rpc(grant.access_token,"tools/call",{name:"moru_context",arguments:{}});
    expect((await read.json()).result.structuredContent.timezone).toBe("Asia/Seoul");
    const denied=await rpc(grant.access_token,"tools/call",{name:"moru_create_task",arguments:{requestId:randomUUID(),data:{title:"denied",category:"생활"}}});
    expect((await denied.json()).result.isError).toBe(true);
  });
  it("creates, updates and retries through direct MCP without duplicate writes",async()=>{
    const grant=await tokens(), requestId=randomUUID();
    const args={name:"moru_create_task",arguments:{requestId,data:{title:"가상 MCP 검증",category:"학습",dueDate:"2026-10-10"}}};
    const first=(await (await rpc(grant.access_token,"tools/call",args)).json()).result.structuredContent;
    const retry=(await (await rpc(grant.access_token,"tools/call",args)).json()).result.structuredContent;
    expect(first.saved).toBe(true);expect(first.item.id).toBe(retry.item.id);
    expect(first.item.startAt).toBe(null);expect(first.item.dueDate).toBe("2026-10-10");
    const edited=(await (await rpc(grant.access_token,"tools/call",{name:"moru_update_task",arguments:{
      requestId:randomUUID(),id:first.item.id,version:first.item.version,changes:{status:"완료"},
    }})).json()).result.structuredContent;
    expect(edited.item.status).toBe("완료");
    await revoke(uid);expect((await rpc(grant.access_token,"tools/list")).status).toBe(401);
  });
});

