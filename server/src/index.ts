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
import testingRoutes from './routes/testing';
import visualSearchRoutes from './routes/visualSearch';
import { livePreviewService } from './services/livePreviewService';

const app = express();
const PORT = parseInt(process.env.PORT || '4000', 10);

// Configure helmet based on environment
const isProduction = process.env.NODE_ENV === 'production';
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

// CORS configuration - allow Vercel deployments
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

// Handle OPTIONS requests FIRST, before CORS middleware
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  
  // Check if origin is allowed
  if (isProduction && typeof allowedOrigins !== 'boolean') {
    const isAllowed = allowedOrigins.some(allowed => {
      if (typeof allowed === 'string') {
        return allowed === origin;
      } else if (allowed instanceof RegExp) {
        return allowed.test(origin || '');
      }
      return false;
    });
    
    if (origin && isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
      return res.status(204).send();
    }
  } else {
    // Development mode - allow all
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).send();
  }
  
  // If origin not allowed, return 403
  res.status(403).send();
});

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

// Health
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
app.use('/api/testing', testingRoutes);
app.use('/api/visual-search', visualSearchRoutes);

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Start server with Socket.IO
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Takeoff API server running on port ${PORT}`);
});

// Initialize live preview service
livePreviewService.initialize(server);
console.log(`📡 Live preview service initialized`);