import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // reachable from a phone on the same Wi-Fi
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
