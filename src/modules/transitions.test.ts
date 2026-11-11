// Every record's status rules live in one table per module, written twice: on the server (which enforces it) and on the
// desk (which decides the buttons and the optimistic change). This test reads the PHP and fails when the two differ.
// Work Orders and Cleaning have the same check in workorders/workorders.test.tsx.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ITEM_STEPS } from "../domain/rules";
import * as crisis from "./crisis/model";
import * as housestatus from "./housestatus/model";
import * as inquiries from "./inquiries/data";
import * as transport from "./transport/model";

const php = (f: string) => readFileSync(new URL(`../../azalea-ehelpdesk/includes/${f}`, import.meta.url), "utf8");

/** Reads `const NAME = array( 'x' => array( array( 'a', 'b' ), 'c' ), ... );` out of a PHP file. */
function phpTable(src: string, name = "TRANSITIONS"): Record<string, [string[], string | null]> {
  const block = new RegExp(`const ${name}\\s*=\\s*array\\(([\\s\\S]*?)\\r?\\n\\t\\);`).exec(src)![1];
  const out: Record<string, [string[], string | null]> = {};
  for (const m of block.matchAll(/'(\w+)'\s*=>\s*array\(\s*array\(([^)]*)\),\s*(null|'([^']*)')\s*\)/g)) {
    out[m[1]] = [[...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]), m[4] ?? null];
  }
  return out;
}

describe("status rules: the desk's tables are the server's", () => {
  const modules = { Transport: transport, HouseStatus: housestatus, Inquiries: inquiries, Crisis: crisis };
  for (const [file, desk] of Object.entries(modules)) {
    it(`${file}: TRANSITIONS match, and allows() follows them`, () => {
      const server = phpTable(php(`Modules/${file}.php`));
      expect(Object.keys(server).length).toBeGreaterThanOrEqual(3);
      expect(desk.TRANSITIONS).toEqual(server);
      for (const [cmd, [from]] of Object.entries(server)) for (const st of from) expect(desk.allows(cmd, st as never)).toBe(true);
    });
  }

  it("request items: ITEM_STEPS match Azl_Commands::ITEM_STEPS", () => {
    const server = phpTable(php("Commands.php"), "ITEM_STEPS");
    expect(Object.fromEntries(Object.entries(server).map(([k, [from]]) => [k, from]))).toEqual(ITEM_STEPS);
  });
});
