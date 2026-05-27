export interface MccMappingResult {
  category: string;
  evidence: string;
}

export function mapMccToCategory(mcc: string | number | null): MccMappingResult | null {
  if (!mcc) return null;
  const mccCode = Number(mcc);

  if ([5411, 5422, 5499].includes(mccCode)) {
    return {
      category: 'Alimentação',
      evidence: `MCC ${mcc} refere-se a Mercearias / Supermercados.`
    };
  }

  if ([5812, 5813, 5814].includes(mccCode)) {
    return {
      category: 'Alimentação',
      evidence: `MCC ${mcc} refere-se a Restaurantes, Fast-Foods ou Bares.`
    };
  }

  if ([4121, 4111, 4789, 5541, 5542].includes(mccCode)) {
    return {
      category: 'Transporte',
      evidence: `MCC ${mcc} refere-se a Serviços de Táxi, Combustível ou Transporte público.`
    };
  }

  if ([7832, 7997, 7922, 7996].includes(mccCode)) {
    return {
      category: 'Lazer',
      evidence: `MCC ${mcc} refere-se a Espetáculos, Cinemas, Clubes ou Recreação.`
    };
  }

  if ([5912, 8011, 8021, 8099, 8043, 8062, 8071].includes(mccCode)) {
    return {
      category: 'Saúde',
      evidence: `MCC ${mcc} refere-se a Farmácias, Consultórios Médicos ou Laboratórios.`
    };
  }

  if ([8211, 8221, 8299, 8244, 8249].includes(mccCode)) {
    return {
      category: 'Educação',
      evidence: `MCC ${mcc} refere-se a Escolas, Universidades ou Treinamentos.`
    };
  }

  if ([4900].includes(mccCode)) {
    return {
      category: 'Moradia',
      evidence: `MCC ${mcc} refere-se a Contas Públicas Essenciais (Luz, Gás, Água).`
    };
  }

  if ([5311, 5964, 5300, 5331, 5965].includes(mccCode)) {
    return {
      category: 'Compras Online',
      evidence: `MCC ${mcc} refere-se a Lojas de Departamento, Varejo ou E-commerce.`
    };
  }

  if ([4899, 5968, 4841].includes(mccCode)) {
    return {
      category: 'Assinaturas',
      evidence: `MCC ${mcc} refere-se a Serviços de TV por assinatura ou Cobranças Recorrentes.`
    };
  }

  return null;
}
