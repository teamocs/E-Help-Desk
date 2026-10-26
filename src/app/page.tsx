"use client";

import dynamic from "next/dynamic";

// The prototype is a client-only app with time-seeded demo data, so it skips server rendering.
// Phase 2 and 3 replace this with server-fetched data.
const App = dynamic(() => import("../App").then((m) => m.App), { ssr: false });

export default function Home() {
  return <App />;
}
