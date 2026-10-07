import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDotsMcp, createBridgeCall } from "../src/integrations/dots-mcp";
import { createDotsValue, parseDotsInput } from "../src/domain/dots";

describe("dots contract", () => {
  it.each([".", ".."])("starts the real stdio launcher from %s without corrupting MCP stdout", async (cwd) => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("scripts/run-tool.mjs"), "dots-mcp"],
      cwd: resolve(cwd),
      env: {
        ...(process.env as Record<string, string>),
        APP_ORIGIN: "http://localhost:3000",
        MORU_DOTS_TOKEN: "test-credential-only-" + "a".repeat(32),
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools).toHaveLength(9);
    } finally {
      await client.close();
    }
  });
  it("keeps candidates and date-only deadlines without inventing times", () => {
    expect(
      createDotsValue("plans", { title: "검토할 시험", category: "자격증" }),
    ).toMatchObject({ status: "검토 중", targetDate: null });
    expect(
      createDotsValue("tasks", {
        title: "접수",
        category: "자격증",
        dueDate: "2026-10-09",
      }),
    ).toMatchObject({ dueDate: "2026-10-09", startAt: null, endAt: null });
    expect(() =>
      createDotsValue("tasks", {
        title: "접수",
        category: "자격증",
        startAt: "2026-10-08T14:00:00+09:00",
      }),
    ).toThrow();
  });
  it("rejects implicit category, ownership fields and ambiguous/non-date deadlines", () => {
    for (const data of [
      { title: "할 일" },
      { title: "할 일", category: "학습", uid: "another" },
      { title: "할 일", category: "학습", dueDate: "다음 주" },
    ])
      expect(() => createDotsValue("tasks", data)).toThrow();
    expect(() =>
      parseDotsInput("moru_update_task", {
        requestId: randomUUID(),
        id: "../other",
        version: 1,
        changes: { status: "완료" },
      }),
    ).toThrow();
    expect(() =>
      parseDotsInput("moru_update_task", {
        requestId: randomUUID(),
        id: "x",
        version: 1,
        changes: {},
      }),
    ).toThrow();
  });
  it("restricts credential delivery to a fixed loopback origin", () => {
    for (const origin of [
      "https://example.com",
      "http://evil.localhost.test",
      "http://localhost/path",
      "http://user:pass@localhost",
      "http://localhost?redirect=evil",
    ])
      expect(() => createBridgeCall(origin, "a".repeat(43))).toThrow();
    expect(() => createBridgeCall("http://localhost:3000", "")).toThrow();
  });
  it("exposes real MCP tools, accurate write annotations, validated inputs and no secret errors", async () => {
    const call = vi.fn().mockResolvedValue({ today: "2026-10-07" });
    const server = createDotsMcp(call);
    const client = new Client({ name: "test", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(9);
      expect(
        tools.find((t) => t.name === "moru_update_task")!.annotations,
      ).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      });
      expect(
        (await client.callTool({ name: "moru_context", arguments: {} }))
          .structuredContent,
      ).toEqual({ today: "2026-10-07" });
      expect(
        (
          await client.callTool({
            name: "moru_create_task",
            arguments: { data: { title: "missing fields" } },
          })
        ).isError,
      ).toBe(true);
      expect(call).toHaveBeenCalledTimes(1);
      call.mockRejectedValue(new Error("secret-key-should-not-leak"));
      const error = await client.callTool({
        name: "moru_context",
        arguments: {},
      });
      expect(error.isError).toBe(true);
      expect(JSON.stringify(error)).not.toContain("secret-key");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
