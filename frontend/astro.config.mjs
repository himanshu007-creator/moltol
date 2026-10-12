import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { localApi } from './scripts/local-api.mjs';

// MolTol frontend — static output (no runtime dynamic routes; ids travel via query params).
// When the backend lands, swap `output` to 'server' + add an adapter and the WS transport
// (see src/lib/ws.ts) will take over from the fixture player behind PUBLIC_USE_FIXTURE.
export default defineConfig({
  output: 'static',
  integrations: [react(), localApi(fileURLToPath(new URL('.', import.meta.url)))],
  vite: {
    plugins: [tailwindcss()],
    build: { target: 'es2022' },
  },
  prefetch: { prefetchAll: true, defaultStrategy: 'viewport' },
});
