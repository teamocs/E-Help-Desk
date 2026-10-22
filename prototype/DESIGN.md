# Design system

Source of truth: `src/styles.css` (tokens), `src/lib/motion.ts`, `src/lib/haptics.ts`, `src/ui/kit.tsx`.

## World
Apple-inspired. iOS grouped lists on a quiet system background, large titles that collapse into a glass bar, a bottom tab bar on phones, a sidebar and inspector on larger screens. One accent (Azalea rose) carries action and selection. Glass is used only where content scrolls beneath it (nav bar, tab bar, toasts).

## Colour
Tokens: `--bg --surface --surface-2 --fg --fg-2 --fg-3 --sep --fill --fill-2 --accent --on-accent`, semantic `--ok --warn --bad` with `-soft` tints. Light: grey system background, white groups. Dark: true black background, `#1c1c1e` groups. Department colours `--d-<dept>` and `--d-<dept>-bg` for six departments. `data-contrast="more"` strengthens text and separators. The cover and the safety takeover are fixed dark-red worlds by design.

## Type
System stack first (`-apple-system`, SF Pro), Geist as the fallback on other platforms, Geist Mono only for console data. Scale uses iOS Dynamic Type names: large 34, title1 28, title2 22, title3 20, headline 17/600, body 17, subhead 15, footnote 13, caption 12. Everything is rem; `--ts` (0.9 to 1.48) scales the whole app. Numerals are tabular.

## Shape and depth
Radii 12 (controls), 16 (groups), 28 (sheets). Groups are flat surfaces separated by 0.5px inset hairlines. Shadows only on floating things (sheets, FAB, toasts).

## Motion
Tokens in `motion.ts`: durations instant 0.08 to crawl 1.0, springs snappy, gentle, sheet, instant, release. Transform and opacity only. Sheets drag to dismiss from the grabber. Rows swipe right to advance, left to hold. `MotionConfig` plus `data-motion="reduce"` honour reduced motion.

## Haptics
`haptic(kind)`: select, light, medium, heavy, success, warning, error. Vibrates where supported and emits a bus event that drives an on-screen indicator for desktops. Sound is limited to success and the safety alert.

## Components
Button (fill, tint, gray, plain, bad; lg, md, sm), IconButton, Segmented, Switch, Group and Row, Pill, DeptChip, Avatar, Ring (SLA), Sheet, Toasts, NetPill, Screen (large title). Layout tiers: phone under 768, tablet 768 to 1099, desktop 1100 to 1359 (inspector), wide 1360 and up (docked demo guide).

## Rules
Targets at least 44pt. No colour-only status: every ring has a pill or icon alongside. Routine events never make sound. No per-person rankings anywhere.
