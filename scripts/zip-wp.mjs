// npm run zip:wp -> dist/azalea-ehelpdesk-<version>.zip, containing only the plugin folder.
// No dependencies: a small ZIP writer on node:zlib (deflate + crc32). Entry paths use forward slashes, so the
// archive unpacks correctly on Linux hosts and through wp-admin's plugin upload.
import { deflateRawSync, crc32 } from "node:zlib";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const PLUGIN = "azalea-ehelpdesk";
const pluginDir = join(root, PLUGIN);
const main = readFileSync(join(pluginDir, `${PLUGIN}.php`), "utf8");
const version = /^\s*\*\s*Version:\s*([\w.-]+)/m.exec(main)?.[1];
if (!version) throw new Error("No Version: line in the plugin header.");
if (!statSync(join(pluginDir, "assets", "desk", "manifest.json"), { throwIfNoEntry: false })) {
  throw new Error("assets/desk/manifest.json is missing. Run npm run build:wp first.");
}

/** Left out of the zip: development files only. */
const SKIP_DIRS = new Set(["node_modules", "tests", "test", ".git", ".github", "vendor-dev"]);
const skipFile = (name) => name.startsWith(".") || /\.test\.|^phpunit|^composer\.(json|lock)$|\.map$/i.test(name);

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name) && !name.startsWith(".")) walk(full, out);
    } else if (!skipFile(name)) out.push(full);
  }
  return out;
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const locals = [];
const centrals = [];
let offset = 0;
const files = walk(pluginDir);
for (const full of files) {
  const name = Buffer.from(`${PLUGIN}/${relative(pluginDir, full).split(sep).join("/")}`, "utf8");
  const data = readFileSync(full);
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const { time, date } = dosTime(statSync(full).mtime);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  locals.push(local, name, packed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);
  offset += local.length + name.length + packed.length;
}

const dir = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(dir.length, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(join(root, "dist"), { recursive: true });
const out = join(root, "dist", `${PLUGIN}-${version}.zip`);
writeFileSync(out, Buffer.concat([...locals, dir, end]));
console.log(`${relative(root, out)}: ${files.length} files`);
