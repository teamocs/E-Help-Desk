import { createElement, lazy, type ComponentType } from 'react';
import type { UI } from '../domain/store';
import type { State } from '../domain/types';
import type { Kind, Level } from './access';

/** One sidebar module. Each lives in src/modules/<id>/index.tsx and is listed once in registry.ts. */
export interface ModuleDef {
  /** The module id: the same id as the server's (Azl_Access::LABELS, Azl_Module::id()). */
  id: string;
  /** The sidebar label, exactly as the client's prototype writes it. */
  label: string;
  /** An icon name from src/ui/icons.ts (add new ones in scripts/icons.mjs). */
  icon: string;
  /** The sidebar count, from the desk's state. Leave out for no badge. */
  badge?: (s: State) => number;
  /** What the count means, for screen readers ("4 open"). Default "open". */
  badgeLabel?: string;
  /**
   * How roles see it when the server's matrix has no row for this id (a module the server does not know yet):
   * actor kind => level. The 11 sidebar modules take their row from the server (window.AZL.access).
   */
  access?: Partial<Record<Kind, Level>>;
  /** The screen, usually React.lazy(() => import('./MyScreen')). Rendered inside Suspense. */
  Screen: ComponentType;
  /** In the phone's bottom bar (at most four; the rest go in More). */
  phoneTab?: boolean;
  /** On phones, the floating "New request" button shows on this screen. */
  fab?: boolean;
  /** A detail pane: beside the list on wide screens, a sheet on phones. `selected` picks the open record's id. */
  detail?: { title: string; selected: (ui: UI) => string | undefined; View: ComponentType<{ id: string }> };
}

/**
 * A module screen loaded with a dynamic import. The import starts at once and the screen renders directly once it
 * has arrived, so switching modules never waits on Suspense (the WordPress build inlines every import; a split
 * build would still load it lazily, showing the Loading state until it arrives).
 */
export function lazyScreen(load: () => Promise<ComponentType>): ComponentType {
  let loaded: ComponentType | null = null;
  const ready = load().then((c) => (loaded = c));
  const Lazy = lazy(() => ready.then((c) => ({ default: c })));
  return function ModuleScreen() {
    return createElement(loaded ?? Lazy);
  };
}
