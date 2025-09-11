import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ command, mode }) => {
  const isDev = mode === 'development';
  
  return {
    // Root directory for frontend files
    root: 'public',
    
    // Build configuration
    build: {
      target: 'es2022',
      outDir: '../dist/public',
      emptyOutDir: true,
      sourcemap: isDev,
      minify: isDev ? false : 'esbuild',
      
      // Bundle optimization
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'public/index.html'),
          quiz: resolve(__dirname, 'public/quiz.html'),
          register: resolve(__dirname, 'public/register.html'),
          admin: resolve(__dirname, 'public/admin.html'),
        },
        output: {
          manualChunks: {
            'api-client': ['./js/core/ApiClient.js'],
          },
          chunkFileNames: 'assets/[name]-[hash].js',
          entryFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
      
      // Asset handling
      assetsInlineLimit: 4096, // 4KB inline threshold
      cssCodeSplit: true,
    },
    
    // Development server
    server: {
      port: 3000,
      host: true,
      strictPort: true,
      
      // Backend API proxy
      proxy: {
        '/api': {
          target: 'http://localhost:8787',
          changeOrigin: true,
          secure: false,
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.log('Proxy error:', err);
            });
          },
        },
      },
      
      // CORS for development
      cors: true,
      
      // HMR configuration
      hmr: {
        overlay: true,
      },
    },
    
    // Path resolution for TypeScript files
    resolve: {
      alias: {
        '@': resolve(__dirname, 'public'),
      },
    },
    
    // CSS processing
    css: {
      devSourcemap: isDev,
    },
    
    // Environment variables
    define: {
      __DEV__: JSON.stringify(isDev),
    },
    
    // Preview server (for production testing)
    preview: {
      port: 3001,
      host: true,
      proxy: {
        '/api': {
          target: 'http://localhost:8787',
          changeOrigin: true,
        },
      },
    },
  };
});
