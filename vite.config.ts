import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'apps/dashboard', plugins: [react()],
  // Existing browser tabs may still import chunks from the preceding build.
  build: { outDir: '../../dist/dashboard', emptyOutDir: false },
  server: { host: '127.0.0.1', port: 3001, strictPort: true },
});
