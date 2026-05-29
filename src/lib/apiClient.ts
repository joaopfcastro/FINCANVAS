export type ApiErrorCode =
  | 'API_UNAVAILABLE'
  | 'API_TIMEOUT'
  | 'API_UNAUTHORIZED'
  | 'API_FORBIDDEN'
  | 'API_VALIDATION'
  | 'API_NON_JSON'
  | 'API_UNKNOWN';

export interface ApiResult<T> {
  ok: boolean;
  status?: number;
  data?: T;
  code?: ApiErrorCode | string;
  message?: string;
  rawError?: unknown;
}

function isRelativeApiRequest(input: string): boolean {
  return input === '/api' || input.startsWith('/api/');
}

function isKnownFrontendOnlyPreviewHost(): boolean {
  if (typeof window === 'undefined') return false;

  const location = window.location;
  const hostname = location?.hostname?.toLowerCase() || '';
  const pathname = location?.pathname?.toLowerCase() || '';

  return (
    hostname === 'aistudio.google.com' ||
    hostname.endsWith('.aistudio.googleusercontent.com') ||
    (hostname.includes('aistudio') && pathname.startsWith('/apps/'))
  );
}

function shouldSkipBackendRequest(input: string): boolean {
  return isRelativeApiRequest(input) && isKnownFrontendOnlyPreviewHost();
}

function getApiUnavailableMessage(): string {
  return 'API do FINCANVAS indisponível neste ambiente de preview. Rode npm run dev ou publique o backend Express para usar esta função.';
}

export async function apiFetchJson<T>(
  input: string,
  init?: RequestInit,
  options?: { timeoutMs?: number }
): Promise<ApiResult<T>> {
  if (shouldSkipBackendRequest(input)) {
    return {
      ok: false,
      code: 'API_UNAVAILABLE',
      message: getApiUnavailableMessage(),
    };
  }

  const timeoutMs = options?.timeoutMs ?? 10000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const status = response.status;

    if (status === 401) {
      return {
        ok: false,
        status,
        code: 'API_UNAUTHORIZED',
        message: 'Não autorizado. Faça login novamente.',
      };
    }
    if (status === 403) {
      return {
        ok: false,
        status,
        code: 'API_FORBIDDEN',
        message: 'Acesso negado.',
      };
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await response.text().catch(() => '');
      if (!response.ok) {
        return {
          ok: false,
          status,
          code: 'API_NON_JSON',
          message: text ? text.substring(0, 300) : `Ocorreu um erro (Status ${status}).`,
        };
      }
      return {
        ok: false,
        status,
        code: 'API_NON_JSON',
        message: 'Resposta do servidor não está no formato JSON esperado.',
      };
    }

    const json = await response.json();
    if (!response.ok) {
      return {
        ok: false,
        status,
        code: 'API_VALIDATION',
        message: json.error || json.message || `Erro no processamento (Status ${status}).`,
        data: json,
      };
    }

    return {
      ok: true,
      status,
      data: json,
    };

  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      return {
        ok: false,
        code: 'API_TIMEOUT',
        message: 'A requisição demorou muito para responder (Timeout).',
        rawError: error,
      };
    }

    const errMessage = String(error.message || error).toLowerCase();
    const isNetworkError =
      errMessage.includes('failed to fetch') ||
      errMessage.includes('load failed') ||
      errMessage.includes('networkerror') ||
      errMessage.includes('typeerror') ||
      errMessage.includes('failed') ||
      error.name === 'TypeError';

    if (isNetworkError) {
      return {
        ok: false,
        code: 'API_UNAVAILABLE',
        message: getApiUnavailableMessage(),
        rawError: error,
      };
    }

    return {
      ok: false,
      code: 'API_UNKNOWN',
      message: error.message || 'Erro de conexão ou erro desconhecido.',
      rawError: error,
    };
  }
}
