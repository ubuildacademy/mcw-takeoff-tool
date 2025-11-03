import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import fs from 'fs-extra';
import { projectRoutes } from './routes/projects';
import { fileRoutes } from './routes/files';
import { conditionRoutes } from './routes/conditions';
import { sheetRoutes } from './routes/sheets';
import takeoffMeasurementRoutes from './routes/takeoffMeasurements';
import { ocrRoutes } from './routes/ocr';
import ollamaRoutes from './routes/ollama';
import userRoutes from './routes/users';
import aiTakeoffRoutes from './routes/aiTakeoff';
import enhancedOcrRoutes from './routes/enhancedOcr';
import hybridDetectionRoutes from './routes/hybridDetection';
import playwrightTakeoffRoutes from './routes/playwrightTakeoff';
import ruleValidationRoutes from './routes/ruleValidation';
import visualSearchRoutes from './routes/visualSearch';
import settingsRoutes from './routes/settings';
import { livePreviewService } from './services/livePreviewService';

const app = express();
const PORT = parseInt(process.env.PORT || '4000', 10);

// CRITICAL: Handle OPTIONS FIRST - before any other middleware is registered
// Express processes middleware in order, so this MUST be first to catch preflight
// Railway's Caddy edge intercepts OPTIONS, so this needs to be extremely early
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    console.log('🚨 OPTIONS PREFLIGHT CAUGHT:', req.path, 'Origin:', req.headers.origin || 'none');
    // Set CORS headers immediately - allow all origins temporarily for testing
    const origin = req.headers.origin;
    
    // Always set CORS headers for OPTIONS to allow preflight
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
    
    console.log('✅ OPTIONS response sent with status 204');
    return res.status(204).end(); // Use end() instead of send() for OPTIONS
  }
  next();
});

// CORS configuration - allow Vercel deployments (define before middleware)
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = isProduction
  ? [
      'https://mcw-takeoff-tool.vercel.app',
      'https://mcw-takeoff-tool-d31u2woku-johnny-raffios-projects-1cedccfd.vercel.app',
      // Allow all *.vercel.app domains
      /^https:\/\/.*\.vercel\.app$/,
      // Allow custom origins from environment
      ...(process.env.ALLOWED_ORIGINS?.split(',').map((origin: string) => origin.trim()) || []),
      // Allow custom domain if set
      ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [])
    ]
  : true; // Allow all origins in development

// CRITICAL: Handle ALL OPTIONS requests FIRST - before ANY other middleware
// This MUST be the very first middleware to catch OPTIONS before CORS or routes
app.use((req, res, next) => {
  // Log all requests for debugging
  if (req.method === 'OPTIONS') {
    console.log('🔄 OPTIONS PREFLIGHT:', req.method, req.path, 'Origin:', req.headers.origin);
    const origin = req.headers.origin;
    
    // Always allow OPTIONS in development
    if (!isProduction) {
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Max-Age', '86400');
      return res.status(204).send();
    }
    
    // Production mode - check origin
    if (typeof allowedOrigins !== 'boolean') {
      const isAllowed = allowedOrigins.some(allowed => {
        if (typeof allowed === 'string') {
          return allowed === origin;
        } else if (allowed instanceof RegExp) {
          return origin ? allowed.test(origin) : false;
        }
        return false;
      });
      
      if (origin && isAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Max-Age', '86400');
        return res.status(204).send();
      }
    }
    
    // Origin not allowed - reject but don't break
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  next();
});

// Configure helmet based on environment
if (isProduction) {
  app.use(helmet());
} else {
  // Less restrictive helmet for development
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
}

app.use(compression());


// CORS configuration with explicit OPTIONS handling
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  preflightContinue: false,
  optionsSuccessStatus: 204,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

fs.ensureDirSync(path.join(__dirname, '../uploads'));
fs.ensureDirSync(path.join(__dirname, '../data'));

// Health - explicitly allow OPTIONS
app.all('/api/health', (req, res) => {
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin;
    if (isProduction && typeof allowedOrigins !== 'boolean') {
      const isAllowed = allowedOrigins.some(allowed => {
        if (typeof allowed === 'string') return allowed === origin;
        if (allowed instanceof RegExp) return origin ? allowed.test(origin) : false;
        return false;
      });
      if (origin && isAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        return res.status(204).send();
      }
    } else if (!isProduction) {
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      return res.status(204).send();
    }
    return res.status(403).send();
  }
  console.log('✅ Health check hit');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Debug endpoint - explicitly allow OPTIONS
app.all('/api/debug', (req, res) => {
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin;
    if (isProduction && typeof allowedOrigins !== 'boolean') {
      const isAllowed = allowedOrigins.some(allowed => {
        if (typeof allowed === 'string') return allowed === origin;
        if (allowed instanceof RegExp) return origin ? allowed.test(origin) : false;
        return false;
      });
      if (origin && isAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        return res.status(204).send();
      }
    } else if (!isProduction) {
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      return res.status(204).send();
    }
    return res.status(403).send();
  }
  console.log('🔍 Debug endpoint hit:', req.method, req.path, req.headers);
  res.json({ 
    method: req.method,
    path: req.path,
    headers: req.headers,
    timestamp: new Date().toISOString()
  });
});

// API routes
app.use('/api/projects', projectRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/conditions', conditionRoutes);
app.use('/api/sheets', sheetRoutes);
app.use('/api/takeoff-measurements', takeoffMeasurementRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/ollama', ollamaRoutes);
app.use('/api/users', userRoutes);
app.use('/api/ai-takeoff', aiTakeoffRoutes);
app.use('/api/enhanced-ocr', enhancedOcrRoutes);
app.use('/api/hybrid-detection', hybridDetectionRoutes);
app.use('/api/playwright-takeoff', playwrightTakeoffRoutes);
app.use('/api/rule-validation', ruleValidationRoutes);
app.use('/api/visual-search', visualSearchRoutes);
app.use('/api/settings', settingsRoutes);

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Start server with Socket.IO
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Takeoff API server running on port ${PORT}`);
  console.log(`🌐 Server accessible at http://0.0.0.0:${PORT}`);
  console.log(`📝 NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📝 Allowed origins configured: ${isProduction ? 'Production mode' : 'Development mode (all allowed)'}`);
});

// Initialize live preview service
livePreviewService.initialize(server);
console.log(`📡 Live preview service initialized`);