import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { serverCredential } from "../src/server/credentials";
import { createBridgeCall } from "../src/integrations/dots-mcp";

afterEach(() => vi.unstubAllGlobals());

describe("production credential boundary", () => {
  it("accepts only a valid service credential belonging to the configured project", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const value = {
      type: "service_account",
      project_id: "moru-test-only",
      client_email: "server@moru-test-only.iam.gserviceaccount.com",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    };
    expect(serverCredential("moru-test-only", JSON.stringify(value)).getAccessToken).toBeTypeOf("function");
    for (const raw of ["sensitive-invalid-json", JSON.stringify({ ...value, project_id: "other" }), JSON.stringify({ ...value, client_email: "server@other.iam.gserviceaccount.com" }), JSON.stringify({ ...value, private_key: "sensitive-key-fragment" })]) {
      let message = "";
      try { serverCredential("moru-test-only", raw); } catch (error) { message = (error as Error).message; }
      expect(message).toContain("Firebase 서버 자격증명");
      expect(message).not.toContain("sensitive");
    }
  });

  it("sends production requests only to the explicitly pinned HTTPS origin without following redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const pinned = "https://moru-test.example";
    await createBridgeCall(pinned, "t".repeat(43), pinned)("moru_context", {});
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${pinned}/api/dots`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "error", headers: { Authorization: `Bearer ${"t".repeat(43)}` } });
    for (const [origin, trusted] of [
      ["https://attacker.example", pinned],
      [pinned, undefined],
      ["http://moru-test.example", "http://moru-test.example"],
      ["https://127.0.0.1", "https://127.0.0.1"],
      ["http://localhost:3000", pinned],
      [pinned, `${pinned}/api/dots`],
      [`${pinned}?redirect=evil`, pinned],
      ["https://user:password@moru-test.example", pinned],
    ]) expect(() => createBridgeCall(origin!, "t".repeat(43), trusted)).toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
