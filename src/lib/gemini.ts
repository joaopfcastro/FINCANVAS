export enum Type {
  ARRAY = 'ARRAY',
  OBJECT = 'OBJECT',
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  INTEGER = 'INTEGER',
  BOOLEAN = 'BOOLEAN',
}

export interface GenerateContentParams {
  model: string;
  contents: any;
  config?: any;
}

export const secureGenerateContent = async (params: GenerateContentParams) => {
  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Falha na comunicação com o servidor de IA.');
  }

  return response.json();
};
