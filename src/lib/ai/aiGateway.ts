import { GoogleGenAI } from '@google/genai';
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

// === SAFE HELPERS EXPORTED / DEFINED ===

export function normalizeAIContentsToMessages(contents: any): any[] {
  if (!contents) {
    return [{ role: 'user', content: '' }];
  }

  // If already an array, check if it's messages or parts
  if (Array.isArray(contents)) {
    if (contents.length > 0 && typeof contents[0] === 'object' && 'role' in contents[0]) {
      return contents;
    }
    const messages: any[] = [];
    for (const item of contents) {
      if (item && item.parts && Array.isArray(item.parts)) {
        const parts = item.parts.map((p: any) => {
          if (p.text) {
            return { type: 'text', text: p.text };
          }
          if (p.inlineData) {
            return {
              type: 'image_url',
              image_url: {
                url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`
              }
            };
          }
          return null;
        }).filter(Boolean);

        const textOnly = parts.every((p: any) => p.type === 'text');
        if (textOnly) {
          const contentStr = parts.map((p: any) => p.text).join('\n');
          messages.push({ role: item.role || 'user', content: contentStr });
        } else {
          messages.push({ role: item.role || 'user', content: parts });
        }
      } else {
        messages.push({ role: 'user', content: typeof item === 'string' ? item : JSON.stringify(item) });
      }
    }
    return messages;
  }

  // If object with parts (Gemini style)
  if (typeof contents === 'object' && contents.parts && Array.isArray(contents.parts)) {
    const parts = contents.parts.map((p: any) => {
      if (p.text) {
        return { type: 'text', text: p.text };
      }
      if (p.inlineData) {
        return {
          type: 'image_url',
          image_url: {
            url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`
          }
        };
      }
      return null;
    }).filter(Boolean);

    const textOnly = parts.every((p: any) => p.type === 'text');
    if (textOnly) {
      const contentStr = parts.map((p: any) => p.text).join('\n');
      return [{ role: contents.role || 'user', content: contentStr }];
    } else {
      return [{ role: contents.role || 'user', content: parts }];
    }
  }

  // If a simple string
  if (typeof contents === 'string') {
    return [{ role: 'user', content: contents }];
  }

  // Fallback
  return [{ role: 'user', content: JSON.stringify(contents) }];
}

export function normalizeAIContentsToAnthropicMessages(contents: any): any[] {
  const messages = normalizeAIContentsToMessages(contents);
  return messages.map((m: any) => {
    if (Array.isArray(m.content)) {
      const content = m.content.map((item: any) => {
        if (item.type === 'image_url') {
          const matched = item.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
          if (matched) {
            return {
              type: 'image',
              source: {
                type: 'base64',
                media_type: matched[1],
                data: matched[2],
              },
            };
          }
        }
        return item;
      });
      return { role: m.role, content };
    }
    return m;
  });
}

export function extractTextFromOpenAIResponse(data: any): string {
  if (!data || !data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
    throw new Error('Resposta inválida ou vazia do OpenAI.');
  }
  const content = data.choices[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('Conteúdo textual não encontrado na resposta do OpenAI.');
  }
  return content;
}

export function extractTextFromAnthropicResponse(data: any): string {
  if (!data || !data.content || !Array.isArray(data.content)) {
    throw new Error('Resposta inválida ou vazia de Anthropic.');
  }
  const textParts = data.content
    .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
    .map((c: any) => c.text);
  if (textParts.length === 0) {
    throw new Error('Mapeamento textual não encontrado na resposta de Anthropic.');
  }
  return textParts.join('\n');
}

export function extractTextFromGeminiResponse(response: any): string {
  if (!response) {
    throw new Error('Resposta nula ou inválida do Gemini.');
  }
  const text = response.text;
  if (typeof text !== 'string') {
    throw new Error('Nenhum conteúdo textual retornado pelo Gemini.');
  }
  return text;
}

export function buildOpenAICompatibleUrl(baseUrl: string): string {
  if (!baseUrl) {
    throw new Error('Base URL é obrigatória para este provedor.');
  }
  const cleanUrl = baseUrl.trim().replace(/\/+$/, '');
  if (cleanUrl.endsWith('/chat/completions')) {
    return cleanUrl;
  }
  if (cleanUrl.endsWith('/v1')) {
    return `${cleanUrl}/chat/completions`;
  }
  return `${cleanUrl}/v1/chat/completions`;
}

// === REAL PROVIDER IMPLEMENTATIONS ===

export async function callGemini(options: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  task?: AITask;
  contents: any;
  config?: any;
}): Promise<AIResponse> {
  const { apiKey, model, contents, config } = options;
  if (!apiKey) {
    throw new Error('Chave de API do Gemini não configurada.');
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  try {
    const response = await ai.models.generateContent({
      model: model || 'gemini-3.5-flash',
      contents,
      config: config || undefined
    });

    const text = extractTextFromGeminiResponse(response);

    return {
      text,
      raw: response,
      provider: 'gemini',
      model: model || 'gemini-3.5-flash'
    };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    if (errMsg.includes("5 NOT_FOUND") || errMsg.includes("notFound") || errMsg.includes("NOT_FOUND")) {
      throw new Error(`Chave de API ou recurso não encontrado (Gemini return: 5 NOT_FOUND). Verifique se o modelo selecionado está disponível e se sua API key possui as permissões corretas.`);
    }
    throw err;
  }
}

export async function callOpenAI(options: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  task?: AITask;
  contents: any;
  config?: any;
}): Promise<AIResponse> {
  const { apiKey, model, contents, config } = options;
  if (!apiKey) {
    throw new Error('Chave de API do OpenAI não configurada.');
  }

  const messages = normalizeAIContentsToMessages(contents);
  const selectedModel = model || 'gpt-4o-mini';

  const payload: any = {
    model: selectedModel,
    messages,
    temperature: config?.temperature ?? 0.7,
  };

  if (config?.responseMimeType === 'application/json') {
    payload.response_format = { type: 'json_object' };
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI HTTP error! Status: ${res.status}. Response: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  const text = extractTextFromOpenAIResponse(data);

  return {
    text,
    raw: data,
    provider: 'openai',
    model: selectedModel
  };
}

export async function callAnthropic(options: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  task?: AITask;
  contents: any;
  config?: any;
}): Promise<AIResponse> {
  const { apiKey, model, contents, config } = options;
  if (!apiKey) {
    throw new Error('Chave de API do Anthropic não configurada.');
  }

  const messages = normalizeAIContentsToAnthropicMessages(contents);
  const selectedModel = model || 'claude-3-5-haiku-latest';

  let systemInstr = config?.systemInstruction;
  let cleanMessages = messages;
  const userSys = messages.find((m: any) => m.role === 'system');
  if (userSys) {
    systemInstr = systemInstr ? `${systemInstr}\n${userSys.content}` : userSys.content;
    cleanMessages = messages.filter((m: any) => m.role !== 'system');
  }

  const payload: any = {
    model: selectedModel,
    messages: cleanMessages,
    max_tokens: config?.maxOutputTokens || 4096,
    temperature: config?.temperature ?? 0.7,
  };

  if (systemInstr) {
    payload.system = systemInstr;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Anthropic HTTP error! Status: ${res.status}. Response: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  const text = extractTextFromAnthropicResponse(data);

  return {
    text,
    raw: data,
    provider: 'anthropic',
    model: selectedModel
  };
}

export async function callOpenRouter(options: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  task?: AITask;
  contents: any;
  config?: any;
}): Promise<AIResponse> {
  const { apiKey, model, contents, config } = options;
  if (!apiKey) {
    throw new Error('Chave de API do OpenRouter não configurada.');
  }

  const messages = normalizeAIContentsToMessages(contents);
  const selectedModel = model || 'google/gemini-flash-1.5';

  const payload: any = {
    model: selectedModel,
    messages,
    temperature: config?.temperature ?? 0.7,
  };

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://ai.studio/build',
      'X-Title': 'FINCANVAS'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenRouter HTTP error! Status: ${res.status}. Response: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  const text = extractTextFromOpenAIResponse(data);

  return {
    text,
    raw: data,
    provider: 'openrouter',
    model: selectedModel
  };
}

export async function callOllama(options: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  task?: AITask;
  contents: any;
  config?: any;
}): Promise<AIResponse> {
  const { baseUrl, model, contents, config } = options;
  const cleanBaseUrl = (baseUrl || 'http://localhost:11434').trim().replace(/\/+$/, '');
  
  const messages = normalizeAIContentsToMessages(contents);
  const selectedModel = model || 'llama3.1';

  try {
    const res = await fetch(`${cleanBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: selectedModel,
        messages,
        temperature: config?.temperature ?? 0.7,
        stream: false
      })
    });

    if (res.ok) {
      const data = await res.json();
      const text = extractTextFromOpenAIResponse(data);
      return {
        text,
        raw: data,
        provider: 'ollama',
        model: selectedModel
      };
    }
  } catch (err) {
    // Failover
  }

  const res = await fetch(`${cleanBaseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: selectedModel,
      messages,
      options: {
        temperature: config?.temperature ?? 0.7
      },
      stream: false
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Ollama HTTP error! Status: ${res.status}. Response: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  if (data && data.message && typeof data.message.content === 'string') {
    return {
      text: data.message.content,
      raw: data,
      provider: 'ollama',
      model: selectedModel
    };
  }

  throw new Error('Formato de resposta não suportado pelo Ollama.');
}

export async function callCustomOpenAICompatible(options: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  task?: AITask;
  contents: any;
  config?: any;
}): Promise<AIResponse> {
  const { apiKey, baseUrl, model, contents, config } = options;
  if (!baseUrl) {
    throw new Error('Base URL é obrigatória para o provedor Custom OpenAI-compatible.');
  }

  const requestUrl = buildOpenAICompatibleUrl(baseUrl);
  const messages = normalizeAIContentsToMessages(contents);
  const selectedModel = model || 'custom-model';

  const payload: any = {
    model: selectedModel,
    messages,
    temperature: config?.temperature ?? 0.7,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const res = await fetch(requestUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Custom OpenAI-Compatible HTTP error! Status: ${res.status}. Response: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  const text = extractTextFromOpenAIResponse(data);

  return {
    text,
    raw: data,
    provider: 'custom_openai_compatible',
    model: selectedModel
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
