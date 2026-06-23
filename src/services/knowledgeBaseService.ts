import { fileService, settingsService } from './apiService';
import { serverOcrService } from './serverOcrService';
import { projectService } from './apiService';

const KB_PROJECT_SETTING_KEY = 'knowledge-base-project-id';
const KB_CHAR_BUDGET = 25000;

export interface KbDocument {
  id: string;
  originalName: string;
  filename: string;
  size?: number;
  uploadedAt?: string;
}

class KnowledgeBaseService {
  private kbProjectId: string | null = null;

  async getProjectId(): Promise<string | null> {
    if (this.kbProjectId) return this.kbProjectId;
    try {
      const res = await settingsService.getSetting(KB_PROJECT_SETTING_KEY);
      if (res?.value) {
        this.kbProjectId = res.value;
        return this.kbProjectId;
      }
    } catch {
      // Not set yet
    }
    return null;
  }

  async getOrCreateProjectId(): Promise<string> {
    const existing = await this.getProjectId();
    if (existing) return existing;

    const project = await projectService.createProject({
      name: '__knowledge_base__',
      client: 'System',
      location: 'System',
      status: 'active',
      description: 'System knowledge base — managed by admin panel',
    });

    const id: string = project.project?.id ?? project.id;
    await settingsService.updateSetting(KB_PROJECT_SETTING_KEY, id);
    this.kbProjectId = id;
    return id;
  }

  async getDocuments(): Promise<KbDocument[]> {
    const projectId = await this.getProjectId();
    if (!projectId) return [];
    try {
      const res = await fileService.getProjectFiles(projectId);
      return (res.files ?? []).map((f: KbDocument) => ({
        id: f.id,
        originalName: f.originalName ?? f.filename,
        filename: f.filename,
        size: f.size,
        uploadedAt: f.uploadedAt,
      }));
    } catch {
      return [];
    }
  }

  async uploadDocument(file: File): Promise<KbDocument> {
    const projectId = await this.getOrCreateProjectId();
    const res = await fileService.uploadPDF(file, projectId);
    const f = res.file;
    return {
      id: f.id,
      originalName: f.originalName ?? f.filename ?? file.name,
      filename: f.filename ?? file.name,
      size: f.size,
      uploadedAt: f.uploadedAt,
    };
  }

  async deleteDocument(fileId: string): Promise<void> {
    await fileService.deletePDF(fileId);
  }

  // Build a context string from all KB documents, capped at KB_CHAR_BUDGET chars.
  // Truncates at page boundaries so the model never gets cut-off mid-page.
  async buildContext(): Promise<string> {
    const projectId = await this.getProjectId();
    if (!projectId) return '';

    const docs = await this.getDocuments();
    if (docs.length === 0) return '';

    let context = '';
    let charsUsed = 0;

    for (const doc of docs) {
      if (charsUsed >= KB_CHAR_BUDGET) break;
      try {
        const ocrData = await serverOcrService.getDocumentData(doc.id, projectId);
        if (!ocrData || !Array.isArray(ocrData.results) || ocrData.results.length === 0) continue;

        const docHeader = `[KB Document: ${doc.originalName}]\n`;
        context += docHeader;
        charsUsed += docHeader.length;

        for (const page of ocrData.results) {
          if (!page?.text) continue;
          const pageText = `Page ${page.pageNumber}:\n${page.text}\n\n`;
          if (charsUsed + pageText.length > KB_CHAR_BUDGET) {
            context += '[Knowledge base truncated to fit context window]\n';
            break;
          }
          context += pageText;
          charsUsed += pageText.length;
        }
      } catch {
        // Skip docs that fail to load OCR
      }
    }

    return context;
  }
}

export const knowledgeBaseService = new KnowledgeBaseService();
