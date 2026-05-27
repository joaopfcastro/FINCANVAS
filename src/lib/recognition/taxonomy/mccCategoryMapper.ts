export interface MccMappingResult {
  category: string;
  evidence: string;
}

export function mapMccToCategory(mcc: string | number | null): MccMappingResult | null {
  if (!mcc) return null;
  const mccCode = Number(mcc);

  // Supermercados & Mercearias (Supermercados)
  if ([5411, 5422, 5499, 5451, 5462].includes(mccCode)) {
    return {
      category: 'Alimentação',
      evidence: `MCC ${mcc} refere-se a Mercearias, Padarias ou Supermercados.`
    };
  }

  // Restaurantes, Bares, Fast-Foods, Delivery (Delivery)
  if ([5812, 5813, 5814, 5811].includes(mccCode)) {
    return {
      category: 'Alimentação',
      evidence: `MCC ${mcc} refere-se a Restaurantes, Delivery, Fast-Foods ou Bares.`
    };
  }

  // Táxis, Caronas, Pedágio, Apps de Transporte, Combustível (Transporte)
  if ([4121, 4111, 4789, 5541, 5542, 4784].includes(mccCode)) {
    return {
      category: 'Transporte',
      evidence: `MCC ${mcc} refere-se a Serviços de Táxi, Apps de Transporte, Combustível ou Pedágio.`
    };
  }

  // Entretenimento, Recreação, Shows, Cinemas (Lazer)
  if ([7832, 7997, 7922, 7996, 7991].includes(mccCode)) {
    return {
      category: 'Lazer',
      evidence: `MCC ${mcc} refere-se a Espetáculos, Cinemas, Parques ou Recreação.`
    };
  }

  // Farmácias, Consultórios Médicos, Planos de Saúde (Saúde)
  if ([5912, 8011, 8021, 8099, 8043, 8062, 8071, 6300].includes(mccCode)) {
    return {
      category: 'Saúde',
      evidence: `MCC ${mcc} refere-se a Farmácias, Consultórios Médicos, Clínicas ou Seguros de Saúde.`
    };
  }

  // Escolas, Universidades, Educação Continuada (Educação)
  if ([8211, 8221, 8299, 8244, 8249, 8215].includes(mccCode)) {
    return {
      category: 'Educação',
      evidence: `MCC ${mcc} refere-se a Escolas, Universidades ou Treinamentos.`
    };
  }

  // Concessionárias Essenciais - Gás, Luz, Água, Coleta de Lixo (Energia / Água / Moradia)
  if ([4900].includes(mccCode)) {
    return {
      category: 'Moradia',
      evidence: `MCC ${mcc} refere-se a Serviços Públicos Essenciais (Água, Energia, Gás, Saneamento).`
    };
  }

  // Telecomunicações - Telefone, Internet, Provedores (Telecom / Moradia)
  if ([4814, 4812, 4816, 4821].includes(mccCode)) {
    return {
      category: 'Moradia',
      evidence: `MCC ${mcc} refere-se a Serviços de Internet, Provedores, Telefonia ou Comunicação.`
    };
  }

  // Lojas de Conveniência, Departamento, E-commerce, Marketplaces (Marketplaces / Compras Online)
  if ([5311, 5964, 5300, 5331, 5965, 5262, 5399, 5942].includes(mccCode)) {
    return {
      category: 'Compras Online',
      evidence: `MCC ${mcc} refere-se a Lojas de Departamento, E-commerce, Marketplaces ou Varejo.`
    };
  }

  // Streaming de Áudio/Vídeo, Tv por Assinatura, Recorrências Digitais (Streaming)
  if ([4899, 5968, 4841, 5815, 7372].includes(mccCode)) {
    return {
      category: 'Assinaturas',
      evidence: `MCC ${mcc} refere-se a Serviços Digitais de Assinatura, Streaming de Vídeo/Música ou Softwares.`
    };
  }

  // Taxas, Impostos e Licenciamentos Governamentais (Impostos)
  if ([9311, 9399].includes(mccCode)) {
    return {
      category: 'Impostos e Taxas',
      evidence: `MCC ${mcc} refere-se a Taxas Administrativas, Impostos Estaduais ou Federais e Serviços do Governo.`
    };
  }

  // Serviços e Tarifas de Instituições Financeiras (Tarifas / Bancos)
  if ([6010, 6011, 6012, 6051].includes(mccCode)) {
    return {
      category: 'Tarifas Bancárias',
      evidence: `MCC ${mcc} refere-se a Instituições Financeiras, Saques, Câmbio ou Tarifas de Serviços.`
    };
  }

  return null;
}
