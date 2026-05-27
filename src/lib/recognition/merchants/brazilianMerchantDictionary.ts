export interface DictionaryEntry {
  pattern: RegExp;
  category: string;
  cleanDescription: string;
}

export const BRAZILIAN_MERCH_DICTIONARY: DictionaryEntry[] = [
  // Food, Restaurants & Delivery
  { pattern: /\b(ifood|ifd)\b/i, category: 'Alimentação', cleanDescription: 'iFood' },
  { pattern: /\b(rappi)\b/i, category: 'Alimentação', cleanDescription: 'Rappi' },
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
  { pattern: /\b(muffato)\b/i, category: 'Alimentação', cleanDescription: 'Muffato' },
  { pattern: /\b(zaffari)\b/i, category: 'Alimentação', cleanDescription: 'Zaffari Supermercados' },
  { pattern: /\b(sonda\s*supermercados|sonda)\b/i, category: 'Alimentação', cleanDescription: 'Sonda Supermercado' },
  { pattern: /\b(supermercado\s*zona\s*sul|zona\s*sul)\b/i, category: 'Alimentação', cleanDescription: 'Supermercado Zona Sul' },
  { pattern: /\b(guanabara)\b/i, category: 'Alimentação', cleanDescription: 'Supermercados Guanabara' },
  { pattern: /\b(mundial)\b/i, category: 'Alimentação', cleanDescription: 'Supermercados Mundial' },
  { pattern: /\b(pao\s*de\s*queijo|padaria|padocas?|panificadora|confeitaria)\b/i, category: 'Alimentação', cleanDescription: 'Padaria' },
  { pattern: /\b(bacio\s*di\s*latte|pizzaria|sushi|restaurante|churrascaria|lanchonete|bistr|choperia|bar\b|pub\b)\b/i, category: 'Alimentação', cleanDescription: 'Restaurante/Lazer' },
  { pattern: /\b(dia\b|gpa|minimercado|mercearia|hortifruti|obahortifruti|sacolao|supermercado|mercado|sacolão)\b/i, category: 'Alimentação', cleanDescription: 'Supermercado' },

  // Transport, Fuel & Toll Tags
  { pattern: /\b(uber\s*trip|uber\s*rides?|uber\b)\b/i, category: 'Transporte', cleanDescription: 'Uber' },
  { pattern: /\b(99app|99taxis?|99\s*taxi|99ap)\b/i, category: 'Transporte', cleanDescription: '99' },
  { pattern: /\b(cabify|indrive|easytaxi)\b/i, category: 'Transporte', cleanDescription: 'Aplicativo de Transporte' },
  { pattern: /\b(posto\s*ipiranga|ipiranga)\b/i, category: 'Transporte', cleanDescription: 'Posto Ipiranga' },
  { pattern: /\b(posto\s*petrobras|br\s*mania|petrobras)\b/i, category: 'Transporte', cleanDescription: 'Posto Petrobras' },
  { pattern: /\b(posto\s*shell|shell\b)\b/i, category: 'Transporte', cleanDescription: 'Posto Shell' },
  { pattern: /\b(localiza|movida|unidas)\b/i, category: 'Transporte', cleanDescription: 'Aluguel de Carros' },
  { pattern: /\b(posto|combustivel|autoposto|auto\s*posto|gasolina|gasol)\b/i, category: 'Transporte', cleanDescription: 'Posto de Combustível' },
  { pattern: /\b(semparar|sem\s*parar)\b/i, category: 'Transporte', cleanDescription: 'Sem Parar' },
  { pattern: /\b(veloe)\b/i, category: 'Transporte', cleanDescription: 'Veloe' },
  { pattern: /\b(conectcar|conect\s*car)\b/i, category: 'Transporte', cleanDescription: 'ConectCar' },
  { pattern: /\b(taggy|movemais|move\s*mais)\b/i, category: 'Transporte', cleanDescription: 'Selo de Pedágio / Teletag' },
  { pattern: /\b(metro|metrô|cptm|sptrans|bilhete\s*unico|passagem|rodoviaria|azul\s*linhas|latam|gol\b)\b/i, category: 'Transporte', cleanDescription: 'Viagem/Transporte Público' },

  // Subscriptions, Streaming & Telecommunications
  { pattern: /\b(netflix|netflix\.com)\b/i, category: 'Assinaturas', cleanDescription: 'Netflix' },
  { pattern: /\b(spotify|spotify\s*finance)\b/i, category: 'Assinaturas', cleanDescription: 'Spotify' },
  { pattern: /\b(deezer|apple\s*music|youtube\s*premium|youtube\s*member)\b/i, category: 'Assinaturas', cleanDescription: 'Streaming de Música/Vídeo' },
  { pattern: /\b(disney\+|hbo\s*max|globoplay|prime\s*video|primevideo|twitch|youtube|crunchyroll|paramount)\b/i, category: 'Assinaturas', cleanDescription: 'Streaming de Vídeo' },
  { pattern: /\b(claro|vivo|tim\b|oi\b|net\s*telecom|sky\b|gvt|algar)\b/i, category: 'Moradia', cleanDescription: 'Internet & Telefonia' },

  // Health, Pharmacies & Insurance
  { pattern: /\b(drogasil)\b/i, category: 'Saúde', cleanDescription: 'Drogasil' },
  { pattern: /\b(droga\s*raia|drogaraia)\b/i, category: 'Saúde', cleanDescription: 'Droga Raia' },
  { pattern: /\b(pague\s*menos)\b/i, category: 'Saúde', cleanDescription: 'Pague Menos' },
  { pattern: /\b(drogaria\s*sao\s*paulo|drogaria\s*sp|pacheco)\b/i, category: 'Saúde', cleanDescription: 'Drogaria Pacheco/São Paulo' },
  { pattern: /\b(drogaria\s*araujo|araujo)\b/i, category: 'Saúde', cleanDescription: 'Drogaria Araujo' },
  { pattern: /\b(farmacia|drogaria|medicamentos?|farma|extrafarma|onofre)\b/i, category: 'Saúde', cleanDescription: 'Farmácia' },
  { pattern: /\b(hospital|clinica|médico|medico|odonto|prevencao|laboratorio|fleury|einstein|unimed|bradesco\s*saude|sulamerica|amil|notredame|intermedica)\b/i, category: 'Saúde', cleanDescription: 'Serviços de Saúde' },

  // Education
  { pattern: /\b(udemy)\b/i, category: 'Educação', cleanDescription: 'Udemy' },
  { pattern: /\b(coursera|alura|kiwify)\b/i, category: 'Educação', cleanDescription: 'Educação Digital' },
  { pattern: /\b(hotmart|eduzz)\b/i, category: 'Educação', cleanDescription: 'Hotmart/Infoprodutos' },
  { pattern: /\b(wizard|fisk|cna\b|kumon|cultura\s*inglesa)\b/i, category: 'Educação', cleanDescription: 'Cursos & Idiomas' },
  { pattern: /\b(escola|faculdade|universidade|colégio|colegio|mensalidade\s*escola|cursinho|mensalidade\s*ensino)\b/i, category: 'Educação', cleanDescription: 'Mensalidade de Ensino' },
  { pattern: /\b(livraria|saraiva|cultura\s*livros|kindle|livros)\b/i, category: 'Educação', cleanDescription: 'Livros & Papelaria' },

  // Housing, Utilities & Energy
  { pattern: /\b(sabesp)\b/i, category: 'Moradia', cleanDescription: 'Sabesp (Água/Esgoto)' },
  { pattern: /\b(enel)\b/i, category: 'Moradia', cleanDescription: 'Enel (Energia)' },
  { pattern: /\b(saneago)\b/i, category: 'Moradia', cleanDescription: 'Saneago (Água/Esgoto)' },
  { pattern: /\b(light)\b/i, category: 'Moradia', cleanDescription: 'Light (Energia)' },
  { pattern: /\b(copel)\b/i, category: 'Moradia', cleanDescription: 'Copel (Energia)' },
  { pattern: /\b(celg|neoenergia|coelba|cpfl|cemig|elektro|cedae|copasa|embasa|sanepar|casan)\b/i, category: 'Moradia', cleanDescription: 'Concessionárias de Água/Gás/Luz' },
  { pattern: /\b(comgas)\b/i, category: 'Moradia', cleanDescription: 'Comgás (Gás)' },
  { pattern: /\b(aluguel|quinto\s*andar|loft|condominio|condomínio|imoveis)\b/i, category: 'Moradia', cleanDescription: 'Despesas de Moradia' },
  { pattern: /\b(leroy\s*merlin|telhanorte|c&c|madeira\s*madeira|tok\s*stok)\b/i, category: 'Moradia', cleanDescription: 'Móveis & Construção' },

  // Taxes, Duties & Public Services
  { pattern: /\b(receita\s*federal|darf)\b/i, category: 'Outros', cleanDescription: 'DARF / Receita Federal' },
  { pattern: /\b(ipva)\b/i, category: 'Transporte', cleanDescription: 'IPVA' },
  { pattern: /\b(iptu)\b/i, category: 'Moradia', cleanDescription: 'IPTU' },
  { pattern: /\b(detran|licenciamento|multa\s*de\s*transito|multa|dpvat|prefeitura)\b/i, category: 'Outros', cleanDescription: 'Taxas Públicas / Prefeitura / Detran' },

  // Salary
  { pattern: /\b(salario|salário|folha\s*pagamento|paycheck|vencimento|pro-labore|prolabore|honorarios|recebimento\s*servico)\b/i, category: 'Salário', cleanDescription: 'Salário' },

  // Investments & Banks
  { pattern: /\b(tesouro\s*direto|rendimento|dividendos|jcp|cdb|lci|lca|poupanca|poupança|corretora|xp\s*investimentos|btg\s*pactual|rico\s*com|clear\s*corretora|nu\s*invest)\b/i, category: 'Investimentos', cleanDescription: 'Investimentos & Rendimentos' },
  { pattern: /\b(itau|itaucard|bradesco|santander|banco\s*do\s*brasil|bb\b|nubank|banco\s*inter|caixa\s*econ|cef\b)\b/i, category: 'Outros', cleanDescription: 'Instituição Financeira / Banco' },

  // Online Shopping, E-commerce, Fashion & Marketplaces
  { pattern: /\b(amazon|amzn|amazon\s*prime)\b/i, category: 'Compras Online', cleanDescription: 'Amazon' },
  { pattern: /\b(shopee)\b/i, category: 'Compras Online', cleanDescription: 'Shopee' },
  { pattern: /\b(mercado\s*livre|mercadolivre|mercado-livre|merpago|mercado\s*pago)\b/i, category: 'Compras Online', cleanDescription: 'Mercado Livre' },
  { pattern: /\b(aliexpress|ali\s*express)\b/i, category: 'Compras Online', cleanDescription: 'AliExpress' },
  { pattern: /\b(magalu|magazine\s*luiza)\b/i, category: 'Compras Online', cleanDescription: 'Magazine Luiza' },
  { pattern: /\b(shein)\b/i, category: 'Compras Online', cleanDescription: 'Shein' },
  { pattern: /\b(americanas|submarino|shoptime)\b/i, category: 'Compras Online', cleanDescription: 'Lojas Americanas/Submarino' },
  { pattern: /\b(casas\s*bahia|ponto\s*frio|rener|renner|riachuelo|c&a|zara|h&m|centauro|decathlon)\b/i, category: 'Compras Online', cleanDescription: 'Varejo & Moda' },
  { pattern: /\b(netshoes|kabum|pichau|terabyte|terabyteshop)\b/i, category: 'Compras Online', cleanDescription: 'E-commerce e Informática (Marketplace)' },

  // Google, Apple & App Store Purchases
  { pattern: /\b(google\s*\*|g\.co\b)/i, category: 'Assinaturas', cleanDescription: 'Google Services' },
  { pattern: /\b(apple\.com|itunes)\b/i, category: 'Assinaturas', cleanDescription: 'Apple Services' },

  // Bank Fees, Charges & Interests
  { pattern: /\b(iof)\b/i, category: 'Outros', cleanDescription: 'Imposto IOF' },
  { pattern: /\b(tarifa|anuidade|juros|mensalidade\s*banc|tar\b|tarifas\b)\b/i, category: 'Outros', cleanDescription: 'Tarifas Bancárias e Juros' },

  // Leisure, Entertainment & Games
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
