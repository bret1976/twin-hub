import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const names = [
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "TWIN_MODE",
  "AUTH_SECRET",
  "PUBLIC_URL",
  "LLM_MODEL",
];

const lines = names
  .filter((name) => process.env[name])
  .map((name) => `${name}=${process.env[name]}`);
writeFileSync(".dev.vars", `${lines.join("\n")}\n`);

const port = process.env.PORT || "45454";
const child = spawn("npx", ["vite", "--host", "0.0.0.0", "--port", port], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
