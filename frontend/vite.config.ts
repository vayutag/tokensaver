import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vite.dev/config/
export default defineConfig({
  // Public base path. Defaults to '/' for root deployments on Vercel/Netlify;
  // override with VITE_BASE_PATH when hosting under a sub-path.
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
      '@services': fileURLToPath(new URL('./src/services', import.meta.url)),
      '@types': fileURLToPath(new URL('./src/types', import.meta.url)),
      '@utils': fileURLToPath(new URL('./src/utils', import.meta.url)),
      '@styles': fileURLToPath(new URL('./src/styles', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL ?? 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // Hidden source maps: generated for error tooling but not referenced from
    // the shipped bundles, keeping production assets lean.
    sourcemap: 'hidden',
    // Use esbuild minification (default) for fast, effective compression.
    minify: 'esbuild',
    // Warn if any single chunk grows beyond 600kB so regressions are visible.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Carve out a single, self-contained long-lived vendor chunk for the
        // React + React Router runtime so browsers can cache it independently
        // of frequently-changing app code.
        //
        // Important: we deliberately isolate ONLY the React ecosystem (whose
        // entire transitive subtree is grouped together here, including
        // @remix-run/router). Everything else — most notably the large
        // markdown / syntax-highlighting stack — is left to Rollup's automatic
        // chunking. Combined with route-level `React.lazy` splitting in
        // App.tsx, this keeps the markdown vendor code out of the initial load
        // and avoids the circular-chunk warnings that arise when shared
        // transitive dependencies get forced into a catch-all `vendor` chunk
        // that both imports and is imported by the isolated vendor chunks.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (
            /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run[\\/]router)[\\/]/.test(
              id,
            )
          ) {
            return 'react-vendor';
          }
          return undefined;
        },
        // Content-hashed filenames enable aggressive, immutable CDN caching.
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
      },
    },
  },
});
