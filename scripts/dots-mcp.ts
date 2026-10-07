import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBridgeCall, createDotsMcp } from "../src/integrations/dots-mcp";
try {
  const productionOrigin = process.env.MORU_DOTS_PRODUCTION_ORIGIN;
  if (!!productionOrigin !== !!process.env.MORU_DOTS_PRODUCTION_TOKEN)
    throw new Error("운영 origin과 운영 연결 키를 함께 설정하세요");
  const call = createBridgeCall(
    productionOrigin || process.env.APP_ORIGIN || "http://localhost:3000",
    (productionOrigin ? process.env.MORU_DOTS_PRODUCTION_TOKEN : process.env.MORU_DOTS_TOKEN) || "",
    productionOrigin,
  );
  const server = createDotsMcp(call);
  await server.connect(new StdioServerTransport());
} catch {
  console.error(
    "Moru MCP를 시작하지 못했습니다. 로컬 서버 연결 설정을 확인하세요. 비밀값은 출력하지 않습니다.",
  );
  process.exitCode = 1;
}
