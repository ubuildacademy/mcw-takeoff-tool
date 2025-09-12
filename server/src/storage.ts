import path from 'path';
import fs from 'fs-extra';

export interface StoredProject {
  id: string;
  name: string;
  client?: string;
  location?: string;
  status?: 'active' | 'completed' | 'on-hold';
  description?: string;
  projectType?: string;
  startDate?: string;
  estimatedValue?: number;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
  lastModified?: string;
  createdAt?: string;
}

export interface StoredFileMeta {
  id: string;
  projectId: string;
  originalName: string;
  filename: string;
  path: string;
  size: number;
  mimetype: string;
  uploadedAt: string;
}

export interface StoredCondition {
  id: string;
  projectId: string;
  name: string;
  type: 'area' | 'volume' | 'linear' | 'count';
  unit: string;
  wasteFactor: number;
  color: string;
  description?: string;
  laborCost?: number;
  materialCost?: number;
  createdAt: string;
}

export interface StoredTakeoffMeasurement {
  id: string;
  projectId: string;
  sheetId: string;
  conditionId: string;
  type: 'area' | 'volume' | 'linear' | 'count';
  points: Array<{ x: number; y: number }>;
  calculatedValue: number;
  unit: string;
  timestamp: string;
  pdfPage: number;
  pdfCoordinates: Array<{ x: number; y: number }>;
  conditionColor: string;
  conditionName: string;
  perimeterValue?: number;
}

class JsonStorage {
  private readonly dataDir: string;
  private readonly projectsFile: string;
  private readonly filesFile: string;
  private readonly conditionsFile: string;
  private readonly takeoffMeasurementsFile: string;

  constructor() {
    this.dataDir = path.join(__dirname, '../data');
    this.projectsFile = path.join(this.dataDir, 'projects.json');
    this.filesFile = path.join(this.dataDir, 'files.json');
    this.conditionsFile = path.join(this.dataDir, 'conditions.json');
    this.takeoffMeasurementsFile = path.join(this.dataDir, 'takeoffMeasurements.json');
    fs.ensureDirSync(this.dataDir);
    if (!fs.existsSync(this.projectsFile)) fs.writeJsonSync(this.projectsFile, []);
    if (!fs.existsSync(this.filesFile)) fs.writeJsonSync(this.filesFile, []);
    if (!fs.existsSync(this.conditionsFile)) fs.writeJsonSync(this.conditionsFile, []);
    if (!fs.existsSync(this.takeoffMeasurementsFile)) fs.writeJsonSync(this.takeoffMeasurementsFile, []);
  }

  // Projects
  getProjects(): StoredProject[] {
    return fs.readJsonSync(this.projectsFile);
  }

  saveProjects(projects: StoredProject[]): void {
    fs.writeJsonSync(this.projectsFile, projects, { spaces: 2 });
  }

  // Files
  getFiles(): StoredFileMeta[] {
    return fs.readJsonSync(this.filesFile);
  }

  saveFiles(files: StoredFileMeta[]): void {
    fs.writeJsonSync(this.filesFile, files, { spaces: 2 });
  }

  // Conditions
  getConditions(): StoredCondition[] {
    return fs.readJsonSync(this.conditionsFile);
  }

  saveConditions(conditions: StoredCondition[]): void {
    fs.writeJsonSync(this.conditionsFile, conditions, { spaces: 2 });
  }

  // Takeoff Measurements
  getTakeoffMeasurements(): StoredTakeoffMeasurement[] {
    return fs.readJsonSync(this.takeoffMeasurementsFile);
  }

  saveTakeoffMeasurements(measurements: StoredTakeoffMeasurement[]): void {
    fs.writeJsonSync(this.takeoffMeasurementsFile, measurements, { spaces: 2 });
  }

  // Seed initial data if empty
  seedInitialData(): void {
    // Don't seed placeholder conditions - let users create their own
    console.log('✅ No placeholder conditions seeded');
  }
}

export const storage = new JsonStorage();

// Seed initial data
storage.seedInitialData();
