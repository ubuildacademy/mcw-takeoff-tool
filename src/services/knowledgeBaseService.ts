import { settingsService } from './apiService';
import { CHAT_PRESET_MAP, KB_CONTENT_SETTING_KEY } from '../constants/chatPresets';

class KnowledgeBaseService {
  async getContent(presetId: string): Promise<string> {
    const preset = CHAT_PRESET_MAP[presetId];
    if (!preset?.usesKnowledgeBase) return '';
    try {
      const res = await settingsService.getSetting(KB_CONTENT_SETTING_KEY(presetId));
      if (res?.value) return res.value;
    } catch {
      // No saved override — fall back to built-in seed content
    }
    return preset.defaultKnowledgeBaseContent?.trim() ?? '';
  }

  async saveContent(presetId: string, content: string): Promise<void> {
    await settingsService.updateSetting(KB_CONTENT_SETTING_KEY(presetId), content);
  }

  getDefaultContent(presetId: string): string {
    return CHAT_PRESET_MAP[presetId]?.defaultKnowledgeBaseContent?.trim() ?? '';
  }
}

export const knowledgeBaseService = new KnowledgeBaseService();
