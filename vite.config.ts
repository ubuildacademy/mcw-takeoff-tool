import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { Plugin } from 'vite'

// Plugin to handle SPA routing - serves index.html for all routes
function spaFallback(): Plugin {
  return {
    name: 'spa-fallback',
    configureServer(server) {
      return () => {
        server.middlewares.use((req, res, next) => {
          // Skip if it's not a GET request
          if (req.method !== 'GET') {
            return next()
          }
          
          // Skip API requests
          if (req.url?.startsWith('/api')) {
            return next()
          }
          
          // Skip Vite HMR and other internal requests
          if (req.url?.startsWith('/@')) {
            return next()
          }
          
          // Skip static assets (check pathname only, not query string)
          // Extract pathname by removing query string and hash
          const pathname = req.url?.split('?')[0].split('#')[0] || '/'
          
          // If pathname has a file extension (and isn't a directory), it's a static asset
          if (pathname.includes('.') && !pathname.endsWith('/')) {
            return next()
          }
          
          // For all other GET requests, serve index.html
          req.url = '/index.html'
          next()
        })
      }
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), spaFallback()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3001,
    strictPort: true,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false
      }
    }
  },
  preview: {
    port: 3001,
    strictPort: true
  },
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      external: [],
      output: {
        manualChunks: {
          'pdfjs': ['pdfjs-dist']
        }
      }
    }
  },
  optimizeDeps: {
    include: ['pdfjs-dist']
  }
})
