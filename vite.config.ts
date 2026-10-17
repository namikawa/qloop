/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

/** 配信時の応答ヘッダー（設計書 9.2 節）。全パスへの指定 1 つだけを受け付ける。 */
function readPreviewHeaders(): Record<string, string> {
  const [path, ...lines] = readFileSync(new URL('./public/_headers', import.meta.url), 'utf8')
    .replace(/\r?\n$/, '')
    .split(/\r?\n/);
  if (path !== '/*') throw new Error('_headers の先頭は /* にしてください');
  return Object.fromEntries(
    lines.map((line) => {
      if (!/^[ \t]+[A-Za-z0-9-]+: \S.*$/.test(line))
        throw new Error(`_headers の行が不正です: ${line}`);
      const separator = line.indexOf(': ');
      return [line.slice(0, separator).trim(), line.slice(separator + 2)];
    }),
  );
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'safari15',
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'decks', test: /[\\/]src[\\/]generated[\\/]decks\.json$/ }],
        },
      },
    },
  },
  // 開発サーバーは React Refresh のインラインスクリプトが CSP で止まるため、preview にだけ付ける。
  preview: {
    headers: readPreviewHeaders(),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['apple-touch-icon.png', 'qloop-logo.svg'],
      manifest: {
        name: 'QLoop',
        short_name: 'QLoop',
        lang: 'ja',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: '#f5f2eb',
        background_color: '#f5f2eb',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      injectManifest: {
        target: 'safari15',
        rollupFormat: 'iife',
        globPatterns: ['**/*.{js,css,html,webp}'],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
