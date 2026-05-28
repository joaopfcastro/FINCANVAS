export type AIProvider =
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'ollama'
  | 'custom_openai_compatible'
  | 'opencode_api';

export type AITask =
  | 'ocr'
  | 'categoryFallback'
  | 'insight'
  | 'report'
  | 'general';

export interface AIUserSettings {
  aiEnabled: boolean;
  provider: AIProvider;
  model: string;
  baseUrl?: string;
  aiUseForOCR: boolean;
  aiUseForCategoryFallback: boolean;
  aiUseForInsights: boolean;
  aiUseForReports: boolean;
  aiAlwaysAskBeforeSending: boolean;
}

export interface AICredentialsStatus {
  configured: boolean;
  provider?: AIProvider;
  keyMasked?: string;
  model?: string;
  baseUrl?: string;
}

export interface AIRequestPayload {
  task: AITask;
  model?: string;
  contents: any;
  config?: any;
}

export interface AIResponse {
  text?: string;
  json?: any;
  raw?: any;
  provider: AIProvider;
  model: string;
}
