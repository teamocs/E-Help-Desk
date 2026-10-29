import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The fallback colours in styles.css (the second value of each var(--azl-*, …)) are the Baguio tokens, used when the
// plugin's <style> is missing. They must pass WCAG AA (4.5:1) for the pairs the desk uses for text.

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function fallbacks(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of source.matchAll(/var\(--azl-([a-z-]+),\s*(#[0-9a-f]{6})\)/gi)) out[m[1]!] = m[2]!.toLowerCase();
  return out;
}

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a) + 0.05, lum(b) + 0.05];
  return Math.max(x, y) / Math.min(x, y);
};

const PAIRS: [fg: string, bg: string][] = [
  ["ink", "bg"],
  ["ink", "surface"],
  ["on-accent", "accent-strong"],
  ["on-deep", "deep"],
  ["on-gold", "gold"],
  ["ok", "ok-soft"],
  ["warn", "warn-soft"],
  ["bad", "bad-soft"],
  ["muted", "surface"],
  ["muted", "bg"],
  ["accent-strong", "accent-soft"],
  ["accent-strong", "surface"],
];

describe("theme fallbacks", () => {
  const t = fallbacks(css);

  it("defines every colour token the desk reads", () => {
    for (const [a, b] of PAIRS) {
      expect(t[a], a).toMatch(/^#/);
      expect(t[b], b).toMatch(/^#/);
    }
    expect(t.bg).toBe("#f6f2e9");
    expect(t.accent).toBe("#3f7052");
  });

  it.each(PAIRS)("%s on %s passes WCAG AA", (fg, bg) => {
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it("has no dark mode left", () => {
    expect(css).not.toMatch(/prefers-color-scheme|data-theme|color-scheme:\s*dark/);
  });
});
