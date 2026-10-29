// npm run lint:php -> `php -l` on every PHP file in the plugin. Set PHP=/path/to/php to pick a binary (e.g. 8.1).
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const php = process.env.PHP || "php";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "node_modules" && !name.startsWith(".")) walk(full, out);
    } else if (name.endsWith(".php")) out.push(full);
  }
  return out;
}

const files = walk(join(root, "azalea-ehelpdesk"));
let failed = 0;
for (const f of files) {
  const r = spawnSync(php, ["-l", f], { encoding: "utf8" });
  if (r.error) {
    console.error(`Could not run ${php}: ${r.error.message}`);
    process.exit(2);
  }
  if (r.status !== 0) {
    failed++;
    console.error((r.stdout + r.stderr).trim());
  }
}
console.log(`php -l: ${files.length - failed}/${files.length} files OK`);
process.exit(failed ? 1 : 0);
