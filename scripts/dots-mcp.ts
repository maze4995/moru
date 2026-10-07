import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBridgeCall, createDotsMcp } from "../src/integrations/dots-mcp";
try {
  const call = createBridgeCall(
    process.env.APP_ORIGIN || "http://localhost:3000",
    process.env.MORU_DOTS_TOKEN || "",
  );
  const server = createDotsMcp(call);
  await server.connect(new StdioServerTransport());
} catch {
  console.error(
    "Moru MCP를 시작하지 못했습니다. 로컬 서버 연결 설정을 확인하세요. 비밀값은 출력하지 않습니다.",
  );
  process.exitCode = 1;
}
