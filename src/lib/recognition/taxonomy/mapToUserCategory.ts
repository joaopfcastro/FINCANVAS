export function mapToUserCategory(suggested: string, userCategories: string[]): string | null {
  if (!suggested) return null;
  const normalizedSuggested = suggested.trim().toLowerCase();
  
  // 1. Check direct exact or case-insensitive match
  const directMatch = userCategories.find(c => c.trim().toLowerCase() === normalizedSuggested);
  if (directMatch) {
    return directMatch;
  }
  
  // 2. Try some standard mappings/translations to standard categories if user has them
  const standardMappings: Record<string, string[]> = {
    'alimentação': ['comida', 'restaurante', 'lanche', 'refeição', 'padaria', 'mercado', 'supermercado'],
    'transporte': ['combustível', 'posto', 'gasolina', 'uber', 'táxi', 'ônibus', 'pedágio', 'estacionamento'],
    'saúde': ['medicação', 'farmácia', 'médico', 'hospital', 'dentista', 'remédio', 'farma'],
    'lazer': ['viagem', 'cinema', 'show', 'teatro', 'entretenimento', 'hospedagem', 'bar', 'restaurante'],
    'moradia': ['aluguel', 'condomínio', 'energia', 'água', 'luz', 'gás', 'internet', 'telefone', 'habitação'],
    'educação': ['curso', 'escola', 'faculdade', 'livro', 'mensalidade escolar', 'estudo'],
    'compras online': ['shopee', 'shein', 'mercado livre', 'compras', 'loja', 'vestuário', 'roupa'],
    'assinaturas': ['netflix', 'spotify', 'amazon prime', 'disney', 'youtube premium', 'streaming'],
    'salário': ['vencimento', 'rendimento', 'salario', 'pro-labore', 'prolabore'],
    'investimentos': ['cripto', 'ações', 'fii', 'dividendos', 'resgate', 'rendimento financeiro']
  };

  for (const [key, aliases] of Object.entries(standardMappings)) {
    const matchedUserCat = userCategories.find(c => c.trim().toLowerCase() === key);
    if (matchedUserCat) {
      if (aliases.some(alias => normalizedSuggested.includes(alias)) || normalizedSuggested.includes(key)) {
        return matchedUserCat;
      }
    }
  }

  return null;
}
