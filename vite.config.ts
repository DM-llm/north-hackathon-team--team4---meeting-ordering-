import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const nexauTarget = process.env.VITE_NEXAU_HTTP_URL || 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api/agent': {
        target: nexauTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/agent/, '/query'),
      },
      '/api/agent-stream': {
        target: nexauTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/agent-stream/, '/stream'),
      },
    },
  },
});
