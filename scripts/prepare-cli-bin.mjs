import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const cliPath = resolve(process.cwd(), "dist/cli.js");
const shebang = "#!/usr/bin/env node\n";
const source = readFileSync(cliPath, "utf8");

if (!source.startsWith(shebang)) {
  writeFileSync(cliPath, `${shebang}${source}`);
}

chmodSync(cliPath, 0o755);
