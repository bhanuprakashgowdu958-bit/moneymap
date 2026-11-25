import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { computeWebBuildMeta } from './scripts/otaMeta.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildMeta = computeWebBuildMeta(__dirname);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_MONEYMAP_WEB_VERSION': JSON.stringify(buildMeta.version),
    'import.meta.env.VITE_MONEYMAP_BUILD_TIME': JSON.stringify(String(buildMeta.buildTime)),
  },
});
