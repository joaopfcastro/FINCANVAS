import { AIProvider, AIResponse, AITask } from './types';
import { isLocalBaseUrl } from './providerRegistry';

interface GenerateAIContentOptions {
  provider: AIProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  task: AITask;
  contents: any;
  config?: any;
}

export async function generateAIContent(options: GenerateAIContentOptions): Promise<AIResponse> {
  const { provider, apiKey, baseUrl, model, task, contents, config } = options;

  switch (provider) {
    case 'gemini':
      return callGemini({ apiKey, baseUrl, model, task, contents, config });
    case 'openai':
      return callOpenAI({ apiKey, baseUrl, model, task, contents, config });
    case 'anthropic':
      return callAnthropic({ apiKey, baseUrl, model, task, contents, config });
    case 'openrouter':
      return callOpenRouter({ apiKey, baseUrl, model, task, contents, config });
    case 'ollama':
      return callOllama({ apiKey, baseUrl, model, task, contents, config });
    case 'custom_openai_compatible':
      return callCustomOpenAICompatible({ apiKey, baseUrl, model, task, contents, config });
    case 'opencode_api':
      return callOpenCodeAPI({ apiKey, baseUrl, model, task, contents, config });
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

async function callGemini(options: any): Promise<AIResponse> {
  // Safe Phase 1 Stub
  return {
    text: 'Gemini adapter stub response. Phase 1 active.',
    provider: 'gemini',
    model: options.model || 'gemini-3.5-flash',
  };
}

async function callOpenAI(options: any): Promise<AIResponse> {
  // Safe Phase 1 Stub
  return {
    text: 'OpenAI adapter stub response. Phase 1 active.',
    provider: 'openai',
    model: options.model || 'gpt-4o-mini',
  };
}

async function callAnthropic(options: any): Promise<AIResponse> {
  // Safe Phase 1 Stub
  return {
    text: 'Anthropic adapter stub response. Phase 1 active.',
    provider: 'anthropic',
    model: options.model || 'claude-3-5-haiku-latest',
  };
}

async function callOpenRouter(options: any): Promise<AIResponse> {
  // Safe Phase 1 Stub
  return {
    text: 'OpenRouter adapter stub response. Phase 1 active.',
    provider: 'openrouter',
    model: options.model || 'google/gemini-flash-1.5',
  };
}

async function callOllama(options: any): Promise<AIResponse> {
  // Safe Phase 1 Stub
  return {
    text: 'Ollama adapter stub response. Phase 1 active.',
    provider: 'ollama',
    model: options.model || 'llama3.1',
  };
}

async function callCustomOpenAICompatible(options: any): Promise<AIResponse> {
  // Safe Phase 1 Stub
  return {
    text: 'Custom OpenAI-compatible adapter stub response. Phase 1 active.',
    provider: 'custom_openai_compatible',
    model: options.model || 'custom-model',
  };
}

export async function callOpenCodeAPI(options: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  task?: AITask;
  contents: any;
  config?: any;
}): Promise<AIResponse> {
  const { apiKey, baseUrl, model, contents, config } = options;

  if (!baseUrl) {
    throw new Error('Base URL is required for OpenCode API.');
  }

  const cleanBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  const cleanApiKey = apiKey ? apiKey.trim() : '';

  // se apiKey não existir, só permitir baseUrl local:
  if (!cleanApiKey && !isLocalBaseUrl(cleanBaseUrl)) {
    throw new Error('OpenCode API without API key is only allowed if baseUrl is local.');
  }

  const requestUrl = `${cleanBaseUrl}/v1/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (cleanApiKey) {
    headers['Authorization'] = `Bearer ${cleanApiKey}`;
  }

  // contents mapping for OpenAI-compatible messages
  let messages: any[] = [];
  if (Array.isArray(contents)) {
    messages = contents;
  } else if (typeof contents === 'string') {
    messages = [{ role: 'user', content: contents }];
  } else if (contents && typeof contents === 'object') {
    if ('role' in contents && 'content' in contents) {
      messages = [contents];
    } else {
      messages = [{ role: 'user', content: JSON.stringify(contents) }];
    }
  } else {
    messages = [{ role: 'user', content: '' }];
  }

  const payload = {
    model: model || 'auto',
    messages,
    temperature: config?.temperature ?? 0.7,
  };

  try {
    const res = await fetch(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`HTTP Error ${res.status}`);
    }

    const data = await res.json();
    if (!data || !data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
      throw new Error('OPENCODE_API_RESPONSE_UNSUPPORTED');
    }

    const firstChoice = data.choices[0];
    if (!firstChoice.message || typeof firstChoice.message.content !== 'string') {
      throw new Error('OPENCODE_API_RESPONSE_UNSUPPORTED');
    }

    return {
      text: firstChoice.message.content,
      json: null,
      raw: data,
      provider: 'opencode_api',
      model: model || 'auto',
    };
  } catch (error: any) {
    if (error.message === 'OPENCODE_API_RESPONSE_UNSUPPORTED') {
      throw error;
    }
    throw new Error('OPENCODE_API_RESPONSE_UNSUPPORTED');
  }
}
