import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
