export interface RawTransactionInput {
  description: string;
  amount: number;
  operationType?: string | null;
  mcc?: string | number | null;
  cnpj?: string | null;
  merchant?: string | null;
  pluggyId?: string;
  detectedDirection?: 'Receita' | 'Despesa';
}

export interface TransactionRecognitionResult {
  type: 'Receita' | 'Despesa';
  category: string;
  cleanDescription: string;
  confidence: number;
  method: 'LearnedRule' | 'LocalDatabase' | 'MCC' | 'LocalDictionary' | 'Heuristic' | 'AI';
  evidence: string;
  needsReview: boolean;
}

export interface LearnedRule {
  id?: string;
  userId: string;
  merchantKey: string;
  category: string;
  cleanDescription: string;
  type: 'Receita' | 'Despesa';
  createdAt: any;
  updatedAt: any;
}

export function generateMerchantKey(description: string): string {
  if (!description) return '';
  return description
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/\b(pix enviado|pix recebido|ted enviada|ted recebida|doc enviado|doc recebido|pagamento de|pagto|pgto|compra|compra no|tarifa|tarifa bancaria|transferencia enviada|transferencia recebida|pago|enviado|recebido|recebido de|enviado para)\b/gi, "")
    .replace(/[^a-z0-9\s]/g, "") // alphanumeric only
    .replace(/\s+/g, ' ')
    .trim();
}

export function isMerchantKeyReliable(merchantKey: string): boolean {
  if (!merchantKey) return false;
  const clean = merchantKey.trim();
  if (clean.length < 3) return false;

  // Exclude hex keys / UUID-like parts
  if (/^[0-9a-f]{10,}$/i.test(clean)) return false;

  // Exclude patterns that are mostly numbers
  const numbersCount = (clean.match(/\d/g) || []).length;
  if (numbersCount / clean.length > 0.4) return false;

  const words = clean.split(' ');
  // Exclude common personal Portuguese last names to avoid learning rules based on peer-to-peer personal transfers
  const personalFilter = [
    'silva', 'santos', 'oliveira', 'souza', 'rodrigues', 'ferreira', 'alves', 'pereira', 'lima', 'gomes', 'costa', 'ribeiro', 'martins', 'carvalho'
  ];
  if (words.length <= 3) {
    if (words.some(w => personalFilter.includes(w))) {
      return false;
    }
  }

  // Exclude matches containing only generic financial verb phrases
  const forbiddenExcludes = ['enviado', 'recebido', 'transferencia', 'ted', 'doc', 'chave', 'qr', 'qrcode', 'estatico', 'dinheiro', 'pix', 'pagamento'];
  if (words.every(w => forbiddenExcludes.includes(w))) {
    return false;
  }

  return true;
}

const BRAZILIAN_DICTIONARY: Array<{ pattern: RegExp | string; category: string; cleanDescription: string }> = [
  // Food & Resturants
  { pattern: /\b(ifood|ifd)\b/i, category: 'Alimentação', cleanDescription: 'iFood' },
  { pattern: /\b(ubereats|uber\s*eats)\b/i, category: 'Alimentação', cleanDescription: 'Uber Eats' },
  { pattern: /\b(mcdonald|mcdonalds|mc\s*donalds|mc\s*donald)\b/i, category: 'Alimentação', cleanDescription: 'McDonald\'s' },
  { pattern: /\b(burger\s*king|bk\b)/i, category: 'Alimentação', cleanDescription: 'Burger King' },
  { pattern: /\b(habib|habibs)\b/i, category: 'Alimentação', cleanDescription: 'Habib\'s' },
  { pattern: /\b(starbucks|starbucks\s*coffee)\b/i, category: 'Alimentação', cleanDescription: 'Starbucks' },
  { pattern: /\b(subway)\b/i, category: 'Alimentação', cleanDescription: 'Subway' },
  { pattern: /\b(outback)\b/i, category: 'Alimentação', cleanDescription: 'Outback' },
  { pattern: /\b(pao de acucar|pao de acúcar|pão de açúcar)\b/i, category: 'Alimentação', cleanDescription: 'Pão de Açúcar' },
  { pattern: /\b(carrefour|carref)\b/i, category: 'Alimentação', cleanDescription: 'Carrefour' },
  { pattern: /\b(pao\s*de\s*queijo|padaria|padocas?|panificadora|confeitaria)\b/i, category: 'Alimentação', cleanDescription: 'Padaria' },
  { pattern: /\b(bacio\s*di\s*latte|pizzaria|sushi|restaurante|churrascaria|lanchonete|bistr|choperia|bar\b|pub\b)\b/i, category: 'Alimentação', cleanDescription: 'Restaurante/Lazer' },
  { pattern: /\b(dia\b|assai|atacadão|atacadao|muffato|gpa|zaffari|supermercado|mercado|minimercado|mercearia|hortifruti|obahortifruti|sacolao)\b/i, category: 'Alimentação', cleanDescription: 'Supermercado' },

  // Transport & Gasoline
  { pattern: /\b(uber\s*trip|uber\s*rides?|uber\b)\b/i, category: 'Transporte', cleanDescription: 'Uber' },
  { pattern: /\b(99app|99taxis?|99\s*taxi|99ap)\b/i, category: 'Transporte', cleanDescription: '99' },
  { pattern: /\b(cabify|indrive|easytaxi)\b/i, category: 'Transporte', cleanDescription: 'Aplicativo de Transporte' },
  { pattern: /\b(posto\s*ipiranga|ipiranga)\b/i, category: 'Transporte', cleanDescription: 'Posto Ipiranga' },
  { pattern: /\b(posto\s*petrobras|br\s*mania|petrobras)\b/i, category: 'Transporte', cleanDescription: 'Posto Petrobras' },
  { pattern: /\b(posto\s*shell|shell\b)\b/i, category: 'Transporte', cleanDescription: 'Posto Shell' },
  { pattern: /\b(localiza|movida|unidas)\b/i, category: 'Transporte', cleanDescription: 'Aluguel de Carros' },
  { pattern: /\b(posto|combustivel|autoposto|auto\s*posto|gasolina|gasol)\b/i, category: 'Transporte', cleanDescription: 'Posto de Combustível' },
  { pattern: /\b(semparar|sem\s*parar|veloe|taggy)\b/i, category: 'Transporte', cleanDescription: 'Pedágio/Veloe/SemParar' },
  { pattern: /\b(metro|metrô|cptm|sptrans|bilhete\s*unico|passagem|rodoviaria|azul\s*linhas|latam|gol\b)\b/i, category: 'Transporte', cleanDescription: 'Viagem/Transporte Público' },

  // Leisure & Entertainment
  { pattern: /\b(netflix|netflix\.com)\b/i, category: 'Assinaturas', cleanDescription: 'Netflix' },
  { pattern: /\b(spotify|spotify\s*finance)\b/i, category: 'Assinaturas', cleanDescription: 'Spotify' },
  { pattern: /\b(deezer|apple\s*music|youtube\s*premium|youtube\s*member)\b/i, category: 'Assinaturas', cleanDescription: 'Streaming de Música/Vídeo' },
  { pattern: /\b(disney\+|hbo\s*max|globoplay|prime\s*video|primevideo|twitch)\b/i, category: 'Assinaturas', cleanDescription: 'Streaming de Vídeo' },
  { pattern: /\b(cinemark|cinepolis|kinoplex|cinema)\b/i, category: 'Lazer', cleanDescription: 'Cinema' },
  { pattern: /\b(eventim|sympla|ingresso|tickets?|ticket360)\b/i, category: 'Lazer', cleanDescription: 'Shows & Eventos' },
  { pattern: /\b(steam|epic\s*games|playstation|xbox|nintendo|blizzard|riot\s*games)\b/i, category: 'Lazer', cleanDescription: 'Jogos/Games' },
  { pattern: /\b(parque|museu|teatro|clube|hotel|pousada|airbnb|booking)\b/i, category: 'Lazer', cleanDescription: 'Viagem/Lazer' },

  // Health
  { pattern: /\b(drogasil)\b/i, category: 'Saúde', cleanDescription: 'Drogasil' },
  { pattern: /\b(droga\s*raia|drogaraia)\b/i, category: 'Saúde', cleanDescription: 'Droga Raia' },
  { pattern: /\b(pague\s*menos)\b/i, category: 'Saúde', cleanDescription: 'Pague Menos' },
  { pattern: /\b(drogaria\s*sao\s*paulo|drogaria\s*sp)\b/i, category: 'Saúde', cleanDescription: 'Drogaria São Paulo' },
  { pattern: /\b(farmacia|drogaria|medicamentos?|farma)\b/i, category: 'Saúde', cleanDescription: 'Farmácia' },
  { pattern: /\b(hospital|clinica|médico|medico|odonto|prevencao|laboratorio|fleury|einstein|unimed|bradesco\s*saude)\b/i, category: 'Saúde', cleanDescription: 'Serviços de Saúde' },

  // Education
  { pattern: /\b(udemy|coursera|alura|hotmart|eduzz|kiwify)\b/i, category: 'Educação', cleanDescription: 'Cursos & Treinamentos' },
  { pattern: /\b(escola|faculdade|universidade|colégio|colegio|mensalidade\s*escola|cursinho|idiomas|cultura\s*inglesa)\b/i, category: 'Educação', cleanDescription: 'Mensalidade de Ensino' },
  { pattern: /\b(livraria|saraiva|cultura\s*livros|kindle|livros)\b/i, category: 'Educação', cleanDescription: 'Livros & Papelaria' },

  // Housing & Utilities
  { pattern: /\b(sabesp|comgas|enel|light|copel|celg|neoenergia|coelba)\b/i, category: 'Moradia', cleanDescription: 'Água/Gás/Luz' },
  { pattern: /\b(aluguel|quinto\s*andar|loft|condominio|condomínio|imoveis|iptu)\b/i, category: 'Moradia', cleanDescription: 'Despesas de Moradia' },
  { pattern: /\b(leroy\s*merlin|telhanorte|c&c|madeira\s*madeira|tok\s*stok)\b/i, category: 'Moradia', cleanDescription: 'Móveis & Construção' },
  { pattern: /\b(claro|vivo|tim\b|oi\b|net\s*telecom|sky\b|gvt)\b/i, category: 'Moradia', cleanDescription: 'Internet & Telefonia' },

  // Salary & Job Benefits
  { pattern: /\b(salario|salário|folha\s*pagamento|paycheck|vencimento|pro-labore|prolabore|honorarios|recebimento\s*servico)\b/i, category: 'Salário', cleanDescription: 'Salário' },

  // Investments
  { pattern: /\b(tesouro\s*direto|rendimento|dividendos|jcp|cdb|lci|lca|poupanca|poupança|corretora|xp\s*investimentos|btg\s*pactual|rico\s*com|clear\s*corretora|nu\s*invest)\b/i, category: 'Investimentos', cleanDescription: 'Investimentos & Rendimentos' },

  // Online Shopping & Marketplaces
  { pattern: /\b(amazon|amzn|amazon\s*prime)\b/i, category: 'Compras Online', cleanDescription: 'Amazon' },
  { pattern: /\b(shopee)\b/i, category: 'Compras Online', cleanDescription: 'Shopee' },
  { pattern: /\b(mercado\s*livre|mercadolivre|mercado-livre|merpago|mercado\s*pago)\b/i, category: 'Compras Online', cleanDescription: 'Mercado Livre' },
  { pattern: /\b(aliexpress|ali\s*express)\b/i, category: 'Compras Online', cleanDescription: 'AliExpress' },
  { pattern: /\b(magalu|magazine\s*luiza)\b/i, category: 'Compras Online', cleanDescription: 'Magazine Luiza' },
  { pattern: /\b(shein)\b/i, category: 'Compras Online', cleanDescription: 'Shein' },
  { pattern: /\b(americanas|submarino|shoptime)\b/i, category: 'Compras Online', cleanDescription: 'Lojas Americanas/Submarino' },
  { pattern: /\b(casas\s*bahia|ponto\s*frio|rener|renner|riachuelo|c&a|zara|h&m|centauro|decathlon)\b/i, category: 'Compras Online', cleanDescription: 'Varejo & Moda' }
];

export function cleanDescriptionLocally(desc: string): string {
  if (!desc) return "";
  let cleaned = desc
    .replace(/\b(PIX ENVIADO|PIX RECEBIDO|TED ENVIADA|TED RECEBIDA|DOC ENVIADO|DOC RECEBIDO|TRANSFERENCIA ENVIADA|TRANSFERENCIA RECEBIDA|PAGAMENTO ENVIADO|PAGAMENTO RECEBIDO)\b/gi, "")
    .replace(/\b(PIX QR CODE ESTATICO|PIX QR CODE ESTATI|TARIFA BANCARIA COMPRA|DOC\/TED COMPRA NO CARTAO|COMPRA NO CARTAO|COMPRA CARTÃO|COMPRA CARTAO|PGTO COMPRA)\b/gi, "")
    .replace(/[\d]{13,}/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  } else {
    cleaned = desc;
  }
  return cleaned;
}

export function localRecognize(
  input: RawTransactionInput,
  learnedRules: LearnedRule[],
  userCategories: string[]
): TransactionRecognitionResult {
  const { description, amount, operationType, mcc, cnpj, merchant, detectedDirection } = input;
  
  // Clean elements
  const cleanDesc = description || '';
  const isDespesa = detectedDirection === 'Despesa' || (detectedDirection !== 'Receita' && amount < 0);
  const currentDirection: 'Receita' | 'Despesa' = isDespesa ? 'Despesa' : 'Receita';

  // 1. Highest priority: User Learned Rules matching
  const merchantKey = generateMerchantKey(merchant || cleanDesc);
  const matchedUserRule = learnedRules.find(r => generateMerchantKey(r.merchantKey) === merchantKey);
  
  if (matchedUserRule) {
    return {
      type: matchedUserRule.type,
      category: matchedUserRule.category,
      cleanDescription: matchedUserRule.cleanDescription,
      confidence: 1.0,
      method: 'LearnedRule',
      evidence: `Regra personalizada aprendida pelo usuário para o termo "${matchedUserRule.merchantKey}"`,
      needsReview: false
    };
  }

  // 2. Local Database / CNPJ Mapper matching
  if (cnpj) {
    const cleanCnpj = cnpj.replace(/\D/g, '');
    const cnpjMap: Record<string, { category: string; cleanDescription: string }> = {
      '30058145000103': { category: 'Alimentação', cleanDescription: 'iFood' },
      '02185671000115': { category: 'Transporte', cleanDescription: 'Uber Brasil' },
      '06323132000114': { category: 'Lazer', cleanDescription: 'Netflix Brasil' },
      '14420847000109': { category: 'Compras Online', cleanDescription: 'Shopee' },
      '03007331000141': { category: 'Compras Online', cleanDescription: 'Mercado Livre' }
    };
    if (cnpjMap[cleanCnpj]) {
      const match = cnpjMap[cleanCnpj];
      return {
        type: currentDirection,
        category: match.category,
        cleanDescription: match.cleanDescription,
        confidence: 0.98,
        method: 'LocalDatabase',
        evidence: `CNPJ mapeado "${cnpj}" correspondente à marca "${match.cleanDescription}"`,
        needsReview: false
      };
    }
  }

  // 3. MCC Code Mapping
  if (mcc) {
    const mccCode = Number(mcc);
    let category = '';
    let evidence = '';
    
    if ([5812, 5813, 5814].includes(mccCode)) {
      category = 'Alimentação';
      evidence = `MCC ${mcc} indica locais de refeição, fast food ou bares`;
    } else if ([5411, 5422, 5499].includes(mccCode)) {
      category = 'Alimentação';
      evidence = `MCC ${mcc} indica mercearias ou supermercados`;
    } else if ([4121, 4111, 4789, 5541, 5542].includes(mccCode)) {
      category = 'Transporte';
      evidence = `MCC ${mcc} indica táxi, postos de combustíveis ou serviços de transporte`;
    } else if ([7832, 7997, 7922, 7996].includes(mccCode)) {
      category = 'Lazer';
      evidence = `MCC ${mcc} indica cinema, clubes, teatros ou recreação`;
    } else if ([5912, 8011, 8021, 8099].includes(mccCode)) {
      category = 'Saúde';
      evidence = `MCC ${mcc} indica drogarias, médicos, dentistas ou serviços odontológicos`;
    } else if ([8211, 8221, 8299].includes(mccCode)) {
      category = 'Educação';
      evidence = `MCC ${mcc} indica educação básica, ensino superior ou cursos de extensão`;
    } else if ([4900].includes(mccCode)) {
      category = 'Moradia';
      evidence = `MCC ${mcc} indica concessionárias de serviços públicos essenciais`;
    } else if ([5311, 5964, 5300].includes(mccCode)) {
      category = 'Compras Online';
      evidence = `MCC ${mcc} indica lojas de departamento ou e-commerce direct`;
    } else if ([4899, 5968].includes(mccCode)) {
      category = 'Assinaturas';
      evidence = `MCC ${mcc} indica canais por assinatura ou cobranças recorrentes de periódicos`;
    }

    if (category) {
      // Find clean description helper from dictionary or clean the default one
      let mappedDesc = cleanDesc;
      for (const entry of BRAZILIAN_DICTIONARY) {
        if (typeof entry.pattern === 'string' && cleanDesc.toLowerCase().includes(entry.pattern.toLowerCase())) {
          mappedDesc = entry.cleanDescription;
          break;
        } else if (entry.pattern instanceof RegExp && entry.pattern.test(cleanDesc)) {
          mappedDesc = entry.cleanDescription;
          break;
        }
      }
      return {
        type: currentDirection,
        category: category,
        cleanDescription: mappedDesc !== cleanDesc ? mappedDesc : cleanDescriptionLocally(cleanDesc),
        confidence: 0.85,
        method: 'MCC',
        evidence: evidence,
        needsReview: false
      };
    }
  }

  // 4. Local Dictionary mapping (Brazilian Dictionary)
  for (const entry of BRAZILIAN_DICTIONARY) {
    let matched = false;
    if (typeof entry.pattern === 'string') {
      matched = cleanDesc.toLowerCase().includes(entry.pattern.toLowerCase());
    } else if (entry.pattern instanceof RegExp) {
      matched = entry.pattern.test(cleanDesc);
    }

    if (matched) {
      return {
        type: currentDirection,
        category: entry.category,
        cleanDescription: entry.cleanDescription,
        confidence: 0.95,
        method: 'LocalDictionary',
        evidence: `Termo localizado no dicionário brasileiro para: "${entry.cleanDescription}"`,
        needsReview: false
      };
    }
  }

  // 5. Direct Heuristic words (Salary check etc.)
  const descLower = cleanDesc.toLowerCase();
  if (descLower.includes('salario') || descLower.includes('salário') || descLower.includes('pro labore') || descLower.includes('prolabore')) {
    return {
      type: 'Receita',
      category: 'Salário',
      cleanDescription: 'Salário Recebido',
      confidence: 0.90,
      method: 'Heuristic',
      evidence: 'Palavra-chave salarial encontrada na descrição',
      needsReview: false
    };
  }

  // Default block: Never invent category with low confidence, suggest default Reviewable Outros
  return {
    type: currentDirection,
    category: 'Outros',
    cleanDescription: cleanDescriptionLocally(cleanDesc),
    confidence: 0.30,
    method: 'Heuristic',
    evidence: 'Sem correspondências de alta confiança no motor de regras locais. Categoria de fallback "Outros" aplicada.',
    needsReview: true
  };
}
