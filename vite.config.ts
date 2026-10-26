import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// `--mode desktop` builds the bundle that Tauri wraps into the Mac app.
// The default build is the PWA served from GitHub Pages (BASE_PATH is set by the deploy workflow).
export default defineConfig(({ mode }) => {
  const desktop = mode === 'desktop';
  return {
    base: desktop ? './' : process.env.BASE_PATH ?? '/',
    plugins: [
      react(),
      !desktop &&
        VitePWA({
          registerType: 'autoUpdate',
          includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
          manifest: {
            name: 'OrgMap',
            short_name: 'OrgMap',
            description: 'Map the people, teams and organizations you know.',
            theme_color: '#3A6EA5',
            background_color: '#F5F8FC',
            display: 'standalone',
            orientation: 'any',
            icons: [
              { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
              { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
              { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            ],
          },
          workbox: { globPatterns: ['**/*.{js,css,html,svg,png}'] },
        }),
    ],
    clearScreen: false,
    server: { port: 5173, strictPort: true },
    test: { environment: 'node' },
  };
});
