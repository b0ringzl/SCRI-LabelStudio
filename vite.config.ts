import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { handleRegistration } from './scripts/registrationGateway.mjs';
import { handleDepth } from './scripts/depthGateway.mjs';

export default defineConfig({
  plugins: [react(), { name: 'local-registration-gateway', configureServer(server) {
    server.middlewares.use('/api/registration/automatic', (request, response) => { void handleRegistration(request, response); });
    server.middlewares.use('/api/registration/depth', (request, response) => { void handleDepth(request, response); });
  } }],
  server: { host: '127.0.0.1', port: 43127, strictPort: false },
  preview: { host: '127.0.0.1', port: 43127, strictPort: false },
});
