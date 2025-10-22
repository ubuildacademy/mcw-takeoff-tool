import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';

interface LivePreviewUpdate {
  type: 'page_analysis' | 'condition_created' | 'measurement_placed' | 'progress_update' | 'error' | 'ai_processing';
  data: any;
  timestamp: string;
  projectId: string;
  documentId?: string;
  pageNumber?: number;
  imageData?: string;
}

class LivePreviewService {
  private io: SocketIOServer | null = null;
  private connectedClients: Map<string, string> = new Map(); // clientId -> projectId

  initialize(httpServer: HTTPServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: ["http://localhost:3001", "http://localhost:3002"],
        methods: ["GET", "POST"]
      }
    });

    this.io.on('connection', (socket) => {
      console.log(`🔌 Live preview client connected: ${socket.id}`);

      socket.on('join_project', (projectId: string) => {
        this.connectedClients.set(socket.id, projectId);
        socket.join(`project_${projectId}`);
        console.log(`📁 Client ${socket.id} joined project ${projectId}`);
      });

      socket.on('disconnect', () => {
        this.connectedClients.delete(socket.id);
        console.log(`🔌 Live preview client disconnected: ${socket.id}`);
      });
    });
  }

  /**
   * Send page analysis update
   */
  sendPageAnalysisUpdate(
    projectId: string, 
    documentId: string, 
    pageNumber: number, 
    analysisData: any,
    imageData?: string
  ) {
    this.sendUpdate({
      type: 'page_analysis',
      data: {
        documentId,
        pageNumber,
        analysis: analysisData,
        message: `Page ${pageNumber} analysis complete: ${analysisData.conditions?.length || 0} conditions, ${analysisData.measurements?.length || 0} measurements`
      },
      timestamp: new Date().toISOString(),
      projectId,
      documentId,
      pageNumber,
      imageData
    });
  }

  /**
   * Send condition creation update
   */
  sendConditionCreatedUpdate(
    projectId: string,
    condition: any,
    documentId?: string,
    pageNumber?: number
  ) {
    this.sendUpdate({
      type: 'condition_created',
      data: {
        condition,
        message: `Created condition: ${condition.name}`
      },
      timestamp: new Date().toISOString(),
      projectId,
      documentId,
      pageNumber
    });
  }

  /**
   * Send measurement placement update
   */
  sendMeasurementPlacedUpdate(
    projectId: string,
    measurement: any,
    documentId?: string,
    pageNumber?: number
  ) {
    this.sendUpdate({
      type: 'measurement_placed',
      data: {
        measurement,
        message: `Placed measurement: ${measurement.conditionName}`
      },
      timestamp: new Date().toISOString(),
      projectId,
      documentId,
      pageNumber
    });
  }

  /**
   * Send progress update
   */
  sendProgressUpdate(
    projectId: string,
    progress: number,
    message: string,
    documentId?: string,
    pageNumber?: number
  ) {
    this.sendUpdate({
      type: 'progress_update',
      data: {
        progress,
        message
      },
      timestamp: new Date().toISOString(),
      projectId,
      documentId,
      pageNumber
    });
  }

  /**
   * Send AI processing update
   */
  sendAIProcessingUpdate(
    projectId: string,
    message: string,
    documentId?: string,
    pageNumber?: number
  ) {
    this.sendUpdate({
      type: 'ai_processing',
      data: {
        message
      },
      timestamp: new Date().toISOString(),
      projectId,
      documentId,
      pageNumber
    });
  }

  /**
   * Send error update
   */
  sendErrorUpdate(
    projectId: string,
    error: string,
    documentId?: string,
    pageNumber?: number
  ) {
    this.sendUpdate({
      type: 'error',
      data: {
        error,
        message: `Error: ${error}`
      },
      timestamp: new Date().toISOString(),
      projectId,
      documentId,
      pageNumber
    });
  }

  /**
   * Send update to all clients in a project
   */
  private sendUpdate(update: LivePreviewUpdate) {
    if (!this.io) {
      console.warn('Live preview service not initialized');
      return;
    }

    console.log(`📡 Sending live preview update: ${update.type} for project ${update.projectId}`);
    this.io.to(`project_${update.projectId}`).emit('takeoff_update', update);
  }

  /**
   * Get connected clients for a project
   */
  getConnectedClients(projectId: string): number {
    if (!this.io) return 0;
    
    const room = this.io.sockets.adapter.rooms.get(`project_${projectId}`);
    return room ? room.size : 0;
  }
}

export const livePreviewService = new LivePreviewService();
