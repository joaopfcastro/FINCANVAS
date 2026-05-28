import { AIProvider, AIUserSettings } from './types';

export interface AIProviderConfig {
  id: AIProvider;
  name: string;
  defaultModel: string;
  defaultBaseUrl?: string;
  requiresApiKey: boolean | 'optional';
  supportsCustomBaseUrl: boolean;
  description?: string;
}

export const PROVIDER_REGISTRY: Record<AIProvider, AIProviderConfig> = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    defaultModel: 'gemini-3.5-flash',
    requiresApiKey: true,
    supportsCustomBaseUrl: false,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    requiresApiKey: true,
    supportsCustomBaseUrl: false,
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    defaultModel: 'claude-3-5-haiku-latest',
    requiresApiKey: true,
    supportsCustomBaseUrl: false,
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    defaultModel: 'google/gemini-flash-1.5',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    requiresApiKey: true,
    supportsCustomBaseUrl: true,
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama / Local',
    defaultModel: 'llama3.1',
    defaultBaseUrl: 'http://localhost:11434',
    requiresApiKey: false,
    supportsCustomBaseUrl: true,
  },
  custom_openai_compatible: {
    id: 'custom_openai_compatible',
    name: 'Custom OpenAI-compatible',
    defaultModel: 'custom-model',
    requiresApiKey: 'optional',
    supportsCustomBaseUrl: true,
  },
  opencode_api: {
    id: 'opencode_api',
    name: 'OpenCode API',
    defaultModel: 'auto',
    defaultBaseUrl: '',
    requiresApiKey: 'optional',
    supportsCustomBaseUrl: true,
    description: 'OpenCode API, OpenCode Zen, OpenCode Go, self-hosted OpenCode gateway or OpenAI-compatible OpenCode endpoint.',
  },
};

export function getProviderConfig(provider: AIProvider): AIProviderConfig | undefined {
  return PROVIDER_REGISTRY[provider];
}

export function isValidProvider(provider: any): provider is AIProvider {
  const validProviders: AIProvider[] = [
    'gemini',
    'openai',
    'anthropic',
    'openrouter',
    'ollama',
    'custom_openai_compatible',
    'opencode_api',
  ];
  return validProviders.includes(provider);
}

export function getDefaultModel(provider: AIProvider): string {
  const config = getProviderConfig(provider);
  return config ? config.defaultModel : '';
}

export function maskApiKey(apiKey: string): string {
  if (!apiKey) return '';
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) {
    return '••••••••';
  }
  const showLen = trimmed.toLowerCase().startsWith('sk-') ? 5 : 4;
  return trimmed.substring(0, showLen) + '••••••••';
}

export function getDefaultAISettings(): AIUserSettings {
  return {
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
}

export function isLocalBaseUrl(baseUrl: string): boolean {
  if (!baseUrl) return false;
  try {
    let urlString = baseUrl.trim();
    if (!/^https?:\/\//i.test(urlString)) {
      urlString = 'http://' + urlString;
    }
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') {
      return true;
    }

    // Check private IP ranges
    // 192.168.x.x
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return true;
    }
    // 10.x.x.x
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return true;
    }
    // 172.16.x.x to 172.31.x.x
    const match172 = /^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(hostname);
    if (match172) {
      const secondOctet = parseInt(match172[1], 10);
      if (secondOctet >= 16 && secondOctet <= 31) {
        return true;
      }
    }

    return false;
  } catch (e) {
    const lower = baseUrl.toLowerCase();
    return lower.includes('localhost') || lower.includes('127.0.0.1') || lower.includes('0.0.0.0');
  }
}

export function isSecureRemoteBaseUrl(baseUrl: string): boolean {
  if (!baseUrl) return false;
  return baseUrl.trim().toLowerCase().startsWith('https://');
}

export function validateProviderConnectionConfig(
  provider: any,
  baseUrl: string | undefined,
  apiKey: string | undefined,
  nodeEnv: string
): { isValid: boolean; error?: string } {
  if (!isValidProvider(provider)) {
    return { isValid: false, error: 'Unknown or invalid provider.' };
  }

  const config = getProviderConfig(provider)!;
  const cleanApiKey = apiKey ? apiKey.trim() : '';
  const cleanBaseUrl = baseUrl ? baseUrl.trim() : '';

  // provider que requiresApiKey true sem apiKey: invalid.
  if (config.requiresApiKey === true && !cleanApiKey) {
    return { isValid: false, error: `Provider ${config.name} requires an API key.` };
  }

  // custom_openai_compatible sem baseUrl: invalid.
  if (provider === 'custom_openai_compatible' && !cleanBaseUrl) {
    return { isValid: false, error: 'Custom OpenAI-compatible provider requires a base URL.' };
  }

  // opencode_api sem baseUrl: invalid.
  if (provider === 'opencode_api' && !cleanBaseUrl) {
    return { isValid: false, error: 'OpenCode API requires a base URL.' };
  }

  // opencode_api sem apiKey só é válido se baseUrl for local.
  if (provider === 'opencode_api' && !cleanApiKey && !isLocalBaseUrl(cleanBaseUrl)) {
    return { isValid: false, error: 'OpenCode API without API key is only allowed if the base URL is local.' };
  }

  // opencode_api com baseUrl remoto em produção precisa usar https.
  if (provider === 'opencode_api' && nodeEnv === 'production') {
    if (!isLocalBaseUrl(cleanBaseUrl) && !isSecureRemoteBaseUrl(cleanBaseUrl)) {
      return { isValid: false, error: 'OpenCode API remote base URL must use HTTPS in production.' };
    }
  }

  // ollama sem apiKey é válido se baseUrl for local.
  if (provider === 'ollama' && !cleanApiKey) {
    if (!cleanBaseUrl || !isLocalBaseUrl(cleanBaseUrl)) {
      return { isValid: false, error: 'Ollama without API key is only allowed if the base URL is local.' };
    }
  }

  return { isValid: true };
}
