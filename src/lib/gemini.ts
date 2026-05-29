import { auth } from '../firebase';
import { apiFetchJson } from './apiClient';

export enum Type {
  ARRAY = 'ARRAY',
  OBJECT = 'OBJECT',
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  INTEGER = 'INTEGER',
  BOOLEAN = 'BOOLEAN',
}

export interface GenerateContentParams {
  model?: string;
  contents: any;
  config?: any;
  task?: string;
  timeoutMs?: number;
}

export const secureGenerateContent = async (params: GenerateContentParams) => {
  const user = auth.currentUser;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (user) {
    const token = await user.getIdToken();
    headers['Authorization'] = `Bearer ${token}`;
  }

  const result = await apiFetchJson<any>('/api/ai/generate', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      task: params.task || 'general',
      model: params.model,
      contents: params.contents,
      config: params.config,
    }),
  }, {
    timeoutMs: params.timeoutMs ?? 45000
  });

  if (!result.ok) {
    throw new Error(result.message || 'Falha na comunicação com o servidor de IA.');
  }

  return result.data;
};

export interface AIUserSettings {
  aiEnabled: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  aiUseForOCR: boolean;
  aiUseForCategoryFallback: boolean;
  aiUseForInsights: boolean;
  aiUseForReports: boolean;
  aiAlwaysAskBeforeSending: boolean;
}

export const DEFAULT_DISABLED_AI_SETTINGS: AIUserSettings = {
  aiEnabled: false,
  provider: 'gemini',
  model: 'gemini-3.5-flash',
  baseUrl: '',
  aiUseForOCR: false,
  aiUseForCategoryFallback: false,
  aiUseForInsights: false,
  aiUseForReports: false,
  aiAlwaysAskBeforeSending: true,
};

export const fetchAISettings = async (): Promise<AIUserSettings> => {
  const user = auth.currentUser;
  if (!user) return DEFAULT_DISABLED_AI_SETTINGS;

  try {
    const token = await user.getIdToken();
    const result = await apiFetchJson<any>('/api/ai/credentials/status', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (result.ok && result.data?.settings) {
      return {
        ...DEFAULT_DISABLED_AI_SETTINGS,
        ...result.data.settings,
      };
    }
  } catch (err) {
    console.error('Error fetching AI settings:', err);
  }

  return DEFAULT_DISABLED_AI_SETTINGS;
};
