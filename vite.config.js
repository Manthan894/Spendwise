import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    // Arena previews use a generated e2b.app hostname.
    allowedHosts: true,
  },
});
