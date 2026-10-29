import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Builds the desk for the WordPress plugin: one ES module script (no imports, single chunk) and one stylesheet, hashed, in
// azalea-ehelpdesk/assets/desk/, plus manifest.json. The plugin reads the manifest entry "src/wp/main.tsx"
// ({ file, css[] }) to print the <script> and <link> tags. Run with `npm run build:wp`.

export default defineConfig({
  base: "./",
  publicDir: false,
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "azalea-ehelpdesk/assets/desk",
    emptyOutDir: true,
    manifest: "manifest.json",
    sourcemap: false,
    target: "es2020",
    // react-dom and motion are most of it; icons are pre-extracted to src/ui/icons.ts (npm run icons).
    chunkSizeWarningLimit: 600,
    assetsDir: "",
    rolldownOptions: {
      input: fileURLToPath(new URL("./src/wp/main.tsx", import.meta.url)),
      output: {
        format: "es",
        entryFileNames: "desk-[hash].js",
        assetFileNames: "desk-[hash][extname]",
      },
    },
  },
});
