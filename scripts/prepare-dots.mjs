import { randomBytes } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
const path = new URL("../.env.local", import.meta.url);
const text = await readFile(path, "utf8");
if (/^MORU_DOTS_TOKEN=\S+/m.test(text)) {
  console.log(
    "이미 dots 서버 키가 있습니다. 키를 출력하거나 덮어쓰지 않았습니다.",
  );
} else {
  const key = randomBytes(32).toString("base64url");
  const content =
    text.replace(/^MORU_DOTS_TOKEN=.*\r?\n?/gm, "").trimEnd() +
    `\nMORU_DOTS_TOKEN=${key}\n`;
  const temporary = new URL("../.env.local.dots-pending", import.meta.url);
  await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
  console.log(
    "서버 전용 키를 .env.local에 저장했습니다. 앱을 재시작한 뒤 설정에서 dots 접근을 허용하세요. 키를 채팅에 붙여넣지 마세요.",
  );
}
