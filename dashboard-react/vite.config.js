import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/ringba-sync-dashboard/',
  build: {
    outDir: '../dashboard-build',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      '/ringba-sync-dashboard/api': {
        target: 'http://localhost:3000',
        rewrite: (path) => path.replace(/^\/ringba-sync-dashboard/, ''),
        changeOrigin: true
      }
    }
  }
});

