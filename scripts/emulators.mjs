import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const env = {
  ...process.env,
  XDG_CONFIG_HOME: resolve("work/config"),
  FIREBASE_EMULATORS_PATH: resolve("work/emulators"),
  CI: "true",
};
const bundled = "C:/Program Files/Android/Android Studio/jbr";
if (!env.JAVA_HOME && existsSync(`${bundled}/bin/java.exe`))
  env.JAVA_HOME = bundled;
if (env.JAVA_HOME)
  env.PATH = `${env.JAVA_HOME}/bin${process.platform === "win32" ? ";" : ":"}${env.PATH}`;
const args = process.argv.includes("--test")
  ? [
      "emulators:exec",
      "--config",
      "firebase.test.json",
      "--project",
      "demo-moru-tests",
      "--only",
      "auth,firestore",
      "npm run test:integration",
    ]
  : [
      "emulators:start",
      "--project",
      "demo-moru",
      "--only",
      "auth,firestore",
      "--export-on-exit=./work/emulator-data",
      ...(existsSync("work/emulator-data/firebase-export-metadata.json")
        ? ["--import=./work/emulator-data"]
        : []),
    ];
const child = spawn(
  process.execPath,
  ["node_modules/firebase-tools/lib/bin/firebase.js", ...args],
  { env, stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code || 0));
