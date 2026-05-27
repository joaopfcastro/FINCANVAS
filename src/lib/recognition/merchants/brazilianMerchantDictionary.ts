export interface DictionaryEntry {
  pattern: RegExp;
  category: string;
  cleanDescription: string;
}

export const BRAZILIAN_MERCH_DICTIONARY: DictionaryEntry[] = [
  // Food & Restaurants
  { pattern: /\b(ifood|ifd)\b/i, category: 'Alimentação', cleanDescription: 'iFood' },
  { pattern: /\b(ubereats|uber\s*eats)\b/i, category: 'Alimentação', cleanDescription: 'Uber Eats' },
  { pattern: /\b(mcdonald|mcdonalds|mc\s*donalds|mc\s*donald)\b/i, category: 'Alimentação', cleanDescription: "McDonald's" },
  { pattern: /\b(burger\s*king|bk\b)/i, category: 'Alimentação', cleanDescription: 'Burger King' },
  { pattern: /\b(habib|habibs)\b/i, category: 'Alimentação', cleanDescription: "Habib's" },
  { pattern: /\b(starbucks|starbucks\s*coffee)\b/i, category: 'Alimentação', cleanDescription: 'Starbucks' },
  { pattern: /\b(subway)\b/i, category: 'Alimentação', cleanDescription: 'Subway' },
  { pattern: /\b(outback)\b/i, category: 'Alimentação', cleanDescription: 'Outback' },
  { pattern: /\b(pao de acucar|pao de acúcar|pão de açúcar)\b/i, category: 'Alimentação', cleanDescription: 'Pão de Açúcar' },
  { pattern: /\b(carrefour|carref)\b/i, category: 'Alimentação', cleanDescription: 'Carrefour' },
  { pattern: /\b(assai)\b/i, category: 'Alimentação', cleanDescription: 'Assaí Atacadista' },
  { pattern: /\b(atacadao|atacadão)\b/i, category: 'Alimentação', cleanDescription: 'Atacadão' },
  { pattern: /\b(bretas)\b/i, category: 'Alimentação', cleanDescription: 'Bretas Supermercado' },
  { pattern: /\b(pao\s*de\s*queijo|padaria|padocas?|panificadora|confeitaria)\b/i, category: 'Alimentação', cleanDescription: 'Padaria' },
  { pattern: /\b(bacio\s*di\s*latte|pizzaria|sushi|restaurante|churrascaria|lanchonete|bistr|choperia|bar\b|pub\b)\b/i, category: 'Alimentação', cleanDescription: 'Restaurante/Lazer' },
  { pattern: /\b(dia\b|muffato|gpa|zaffari|supermercado|mercado|minimercado|mercearia|hortifruti|obahortifruti|sacolao)\b/i, category: 'Alimentação', cleanDescription: 'Supermercado' },

  // Transport & Fuel
  { pattern: /\b(uber\s*trip|uber\s*rides?|uber\b)\b/i, category: 'Transporte', cleanDescription: 'Uber' },
  { pattern: /\b(99app|99taxis?|99\s*taxi|99ap)\b/i, category: 'Transporte', cleanDescription: '99' },
  { pattern: /\b(cabify|indrive|easytaxi)\b/i, category: 'Transporte', cleanDescription: 'Aplicativo de Transporte' },
  { pattern: /\b(posto\s*ipiranga|ipiranga)\b/i, category: 'Transporte', cleanDescription: 'Posto Ipiranga' },
  { pattern: /\b(posto\s*petrobras|br\s*mania|petrobras)\b/i, category: 'Transporte', cleanDescription: 'Posto Petrobras' },
  { pattern: /\b(posto\s*shell|shell\b)\b/i, category: 'Transporte', cleanDescription: 'Posto Shell' },
  { pattern: /\b(localiza|movida|unidas)\b/i, category: 'Transporte', cleanDescription: 'Aluguel de Carros' },
  { pattern: /\b(posto|combustivel|autoposto|auto\s*posto|gasolina|gasol)\b/i, category: 'Transporte', cleanDescription: 'Posto de Combustível' },
  { pattern: /\b(semparar|sem\s*parar|veloe|taggy)\b/i, category: 'Transporte', cleanDescription: 'Pedágio/Selo de Pedágio' },
  { pattern: /\b(metro|metrô|cptm|sptrans|bilhete\s*unico|passagem|rodoviaria|azul\s*linhas|latam|gol\b)\b/i, category: 'Transporte', cleanDescription: 'Viagem/Transporte Público' },

  // Subscriptions & Streaming
  { pattern: /\b(netflix|netflix\.com)\b/i, category: 'Assinaturas', cleanDescription: 'Netflix' },
  { pattern: /\b(spotify|spotify\s*finance)\b/i, category: 'Assinaturas', cleanDescription: 'Spotify' },
  { pattern: /\b(deezer|apple\s*music|youtube\s*premium|youtube\s*member)\b/i, category: 'Assinaturas', cleanDescription: 'Streaming de Música/Vídeo' },
  { pattern: /\b(disney\+|hbo\s*max|globoplay|prime\s*video|primevideo|twitch|youtube)\b/i, category: 'Assinaturas', cleanDescription: 'Streaming de Vídeo' },
  { pattern: /\b(claro|vivo|tim\b|oi\b|net\s*telecom|sky\b|gvt)\b/i, category: 'Moradia', cleanDescription: 'Internet & Telefonia' },

  // Health & Pharmacies
  { pattern: /\b(drogasil)\b/i, category: 'Saúde', cleanDescription: 'Drogasil' },
  { pattern: /\b(droga\s*raia|drogaraia)\b/i, category: 'Saúde', cleanDescription: 'Droga Raia' },
  { pattern: /\b(pague\s*menos)\b/i, category: 'Saúde', cleanDescription: 'Pague Menos' },
  { pattern: /\b(drogaria\s*sao\s*paulo|drogaria\s*sp|pacheco)\b/i, category: 'Saúde', cleanDescription: 'Drogaria Pacheco/São Paulo' },
  { pattern: /\b(farmacia|drogaria|medicamentos?|farma)\b/i, category: 'Saúde', cleanDescription: 'Farmácia' },
  { pattern: /\b(hospital|clinica|médico|medico|odonto|prevencao|laboratorio|fleury|einstein|unimed|bradesco\s*saude)\b/i, category: 'Saúde', cleanDescription: 'Serviços de Saúde' },

  // Education
  { pattern: /\b(udemy)\b/i, category: 'Educação', cleanDescription: 'Udemy' },
  { pattern: /\b(coursera|alura|kiwify)\b/i, category: 'Educação', cleanDescription: 'Educação Digital' },
  { pattern: /\b(hotmart|eduzz)\b/i, category: 'Educação', cleanDescription: 'Hotmart/Infoprodutos' },
  { pattern: /\b(escola|faculdade|universidade|colégio|colegio|mensalidade\s*escola|cursinho|idiomas|cultura\s*inglesa)\b/i, category: 'Educação', cleanDescription: 'Mensalidade de Ensino' },
  { pattern: /\b(livraria|saraiva|cultura\s*livros|kindle|livros)\b/i, category: 'Educação', cleanDescription: 'Livros & Papelaria' },

  // Housing & Utilities
  { pattern: /\b(sabesp)\b/i, category: 'Moradia', cleanDescription: 'Sabesp (Água/Esgoto)' },
  { pattern: /\b(enel)\b/i, category: 'Moradia', cleanDescription: 'Enel (Energia)' },
  { pattern: /\b(saneago)\b/i, category: 'Moradia', cleanDescription: 'Saneago (Água/Esgoto)' },
  { pattern: /\b(comgas|light|copel|celg|neoenergia|coelba)\b/i, category: 'Moradia', cleanDescription: 'Água/Gás/Luz' },
  { pattern: /\b(aluguel|quinto\s*andar|loft|condominio|condomínio|imoveis)\b/i, category: 'Moradia', cleanDescription: 'Despesas de Moradia' },
  { pattern: /\b(leroy\s*merlin|telhanorte|c&c|madeira\s*madeira|tok\s*stok)\b/i, category: 'Moradia', cleanDescription: 'Móveis & Construção' },

  // Taxes & Duties
  { pattern: /\b(receita\s*federal|darf)\b/i, category: 'Outros', cleanDescription: 'DARF / Receita Federal' },
  { pattern: /\b(ipva)\b/i, category: 'Transporte', cleanDescription: 'IPVA' },
  { pattern: /\b(iptu)\b/i, category: 'Moradia', cleanDescription: 'IPTU' },

  // Salary
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
  { pattern: /\b(casas\s*bahia|ponto\s*frio|rener|renner|riachuelo|c&a|zara|h&m|centauro|decathlon)\b/i, category: 'Compras Online', cleanDescription: 'Varejo & Moda' },

  // Google & Apple Digital Store / Purchases
  { pattern: /\b(google\s*\*|g\.co\b)/i, category: 'Assinaturas', cleanDescription: 'Google Services' },
  { pattern: /\b(apple\.com|itunes)\b/i, category: 'Assinaturas', cleanDescription: 'Apple Services' },

  // Bank Fees & Interest (Heuristics for generic accounts)
  { pattern: /\b(iof)\b/i, category: 'Outros', cleanDescription: 'Imposto IOF' },
  { pattern: /\b(tarifa|anuidade|juros|mensalidade\s*banc|tar\b|tarifas\b)/i, category: 'Outros', cleanDescription: 'Tarifas Bancárias e Juros' },

  // Leisure & Entertainment General
  { pattern: /\b(cinemark|cinepolis|kinoplex|cinema)\b/i, category: 'Lazer', cleanDescription: 'Cinema' },
  { pattern: /\b(eventim|sympla|ingresso|tickets?|ticket360)\b/i, category: 'Lazer', cleanDescription: 'Shows & Eventos' },
  { pattern: /\b(steam|epic\s*games|playstation|xbox|nintendo|blizzard|riot\s*games)\b/i, category: 'Lazer', cleanDescription: 'Jogos/Games' },
  { pattern: /\b(parque|museu|teatro|clube|hotel|pousada|airbnb|booking)\b/i, category: 'Lazer', cleanDescription: 'Viagem/Lazer' }
];

export function resolveByNameDictionary(description: string, direction: 'Receita' | 'Despesa'): { category: string; cleanDescription: string } | null {
  for (const entry of BRAZILIAN_MERCH_DICTIONARY) {
    if (entry.pattern.test(description)) {
      // Overrides for specific combinations if needed (e.g. Google/Apple can be Compras instead of Assinaturas based on signals, but default is good)
      return {
        category: entry.category,
        cleanDescription: entry.cleanDescription
      };
    }
  }
  return null;
}
