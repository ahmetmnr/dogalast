import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  // Root directory
  root: 'public',
  
  // Path aliases configuration
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@public': path.resolve(__dirname, './public'),
      '@tests': path.resolve(__dirname, './tests'),
      '@controllers': path.resolve(__dirname, './src/controllers'),
      '@services': path.resolve(__dirname, './src/services'),
      '@middleware': path.resolve(__dirname, './src/middleware'),
      '@routes': path.resolve(__dirname, './src/routes'),
      '@types': path.resolve(__dirname, './src/types'),
      '@db': path.resolve(__dirname, './src/db'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@components': path.resolve(__dirname, './public/js/components'),
      '@core': path.resolve(__dirname, './public/js/core'),
      '@config': path.resolve(__dirname, './src/config')
    }
  },
  
  // Build configuration
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: true,
    outDir: 'dist/public',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'public/index.html'),
        quiz: path.resolve(__dirname, 'public/quiz.html'),
        register: path.resolve(__dirname, 'public/register.html'),
        admin: path.resolve(__dirname, 'public/admin.html'),
        'admin-login': path.resolve(__dirname, 'public/admin-login.html')
      },
      output: {
        manualChunks: {
          vendor: ['hono'],
          utils: ['zod', 'jose'],
          audio: ['@openai/realtime-api-beta'],
          charts: ['chart.js']
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    },
    // Performance budgets
    chunkSizeWarningLimit: 1000,
    assetsInlineLimit: 4096
  },
  
  // Development server configuration
  server: {
    port: 3000,
    host: '0.0.0.0',
    open: false,
    cors: true,
    // Proxy configuration for backend API
    proxy: {
      '/api': {
        target: 'http://localhost:8788',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path
      },
      '/ws': {
        target: 'ws://localhost:8788',
        ws: true,
        changeOrigin: true
      },
      // Admin routes
      '/admin/api': {
        target: 'http://localhost:8788',
        changeOrigin: true,
        secure: false
      }
    },
    // Hot reload configuration
    hmr: {
      port: 3001,
      overlay: true
    }
  },
  
  // Preview server configuration
  preview: {
    port: 3002,
    host: '0.0.0.0',
    cors: true
  },
  
  // CSS configuration
  css: {
    devSourcemap: true,
    preprocessorOptions: {
      scss: {
        additionalData: `@import "@/styles/variables.scss";`
      }
    }
  },
  
  // Environment variables
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV === 'development'),
    __PROD__: JSON.stringify(process.env.NODE_ENV === 'production'),
    __VERSION__: JSON.stringify(process.env['npm_package_version'] || '0.0.1')
  },
  
  // Optimization
  optimizeDeps: {
    include: ['zod', 'jose'],
    exclude: ['@openai/realtime-api-beta'],
    entries: [
      'public/**/*.html',
      'public/**/*.ts'
    ]
  },
  
  // Plugin configuration
  plugins: [
    // Add plugins as needed
  ],
  
  // Worker configuration
  worker: {
    format: 'es'
  }
})
