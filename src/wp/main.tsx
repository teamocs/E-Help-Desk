import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import { readConfig } from "./config";
import { WpApp, makeApi } from "./WpApp";

// Entry for the WordPress bundle (npm run build:wp). The plugin's /helpdesk/ page prints window.AZL and <div id="azl-root">.

const root = document.getElementById("azl-root");
if (root) {
  try {
    const cfg = readConfig(window as unknown as { AZL?: unknown });
    createRoot(root).render(
      <StrictMode>
        <WpApp cfg={cfg} api={makeApi(cfg)} />
      </StrictMode>,
    );
  } catch (e) {
    root.textContent = e instanceof Error ? e.message : "The help desk could not start.";
  }
}
