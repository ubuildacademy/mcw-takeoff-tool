import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { Plugin } from 'vite'
import fs from 'fs'

// Plugin to handle SPA routing - serves index.html for all routes
function spaFallback(): Plugin {
  return {
    name: 'spa-fallback',
    configureServer(server) {
      // Add middleware that will catch SPA routes
      // We'll add it directly, but it should run after Vite's static file serving
      const spaMiddleware = (req: any, res: any, next: any) => {
        // Only handle GET requests
        if (req.method !== 'GET') {
          return next()
        }
        
        const url = req.url || '/'
        
        // Debug logging
        if (process.env.DEBUG) {
          console.log('[SPA Fallback] Intercepting:', url, 'Headers sent:', res.headersSent)
        }
        
        // Skip API requests (these are proxied)
        if (url.startsWith('/api')) {
          return next()
        }
        
        // Skip Vite HMR and other internal requests
        if (url.startsWith('/@') || url.startsWith('/node_modules/')) {
          return next()
        }
        
        // Skip if it's already index.html or root
        if (url === '/index.html' || url === '/') {
          return next()
        }
        
        // Extract pathname (remove query string and hash)
        const pathname = url.split('?')[0].split('#')[0]
        
        // Skip static assets - check for file extensions
        const hasExtension = /\.(js|css|json|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map|mjs|html|pdf|wasm)$/i.test(pathname)
        if (hasExtension) {
          return next()
        }
        
        // Skip requests for source files (Vite handles these)
        if (pathname.startsWith('/src/') || pathname.startsWith('/@id/') || pathname.startsWith('/@fs/')) {
          return next()
        }
        
        // For all SPA routes, serve index.html directly
        // Check if response has already been sent
        if (res.headersSent) {
          return next()
        }
        
        // Read the file and serve it to ensure it works even if Vite's middleware already ran
        const indexHtmlPath = path.resolve(process.cwd(), 'index.html')
        try {
          if (fs.existsSync(indexHtmlPath)) {
            const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8')
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.statusCode = 200
            return res.end(indexHtml)
          }
        } catch (error) {
          console.error('Error serving index.html:', error)
        }
        
        // Fallback: try rewriting the URL
        req.url = '/index.html'
        next()
      }
      
      // Return a function that adds the middleware after server setup
      // This ensures it runs after Vite's static file middleware
      return () => {
        server.middlewares.use(spaMiddleware)
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
