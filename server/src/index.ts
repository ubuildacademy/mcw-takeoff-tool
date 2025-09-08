import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import fs from 'fs-extra';
import { projectRoutes } from './routes/projects';
import { fileRoutes } from './routes/files';
import { conditionRoutes } from './routes/conditions';

const app = express();
const PORT = parseInt(process.env.PORT || '4000', 10);

app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourcompany.com'] 
    : ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true
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

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Takeoff API server running on port ${PORT}`);
});
