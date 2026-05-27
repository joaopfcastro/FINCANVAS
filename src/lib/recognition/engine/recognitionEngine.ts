import { RawTransactionInput, RecognitionResult, UserRecognitionRule, RecognitionMethod } from "../types";
import { cleanDescription, generateMerchantKey } from "../normalize/text";
import { resolveByNameDictionary } from "../merchants/brazilianMerchantDictionary";
import { mapMccToCategory } from "../taxonomy/mccCategoryMapper";
import { mapPluggyCategory } from "../taxonomy/pluggyCategoryMapper";
import { detectInternalTransfer } from "../transfers/internalTransferMatcher";
import { isKnownSubscription } from "../recurrence/recurringDetector";
import { matchRule, applyRuleActions } from "../rules/ruleMatcher";
import { matchDescriptionFromHistory, HistoricTransactionItem } from "../history/descriptionMatch";

// Static mapping of common CNPJ for instant matching
const CNPJ_MAP: Record<string, { category: string; cleanDescription: string }> = {
  '30058145000103': { category: 'Alimentação', cleanDescription: 'iFood' },
  '02185671000115': { category: 'Transporte', cleanDescription: 'Uber Brasil' },
  '06323132000114': { category: 'Lazer', cleanDescription: 'Netflix Brasil' },
  '14420847000109': { category: 'Compras Online', cleanDescription: 'Shopee' },
  '03007331000141': { category: 'Compras Online', cleanDescription: 'Mercado Livre' }
};

export function runLocalRecognition(
  input: RawTransactionInput,
  userRules: UserRecognitionRule[] = [],
  userHistory: HistoricTransactionItem[] = [],
  userCategories: string[] = []
): RecognitionResult {
  const { description, amount, detectedDirection, operationType, mcc, cnpj, merchant } = input;

  const selectCategory = (choices: string[], fallback: string): string => {
    for (const choice of choices) {
      const found = userCategories.find(c => c.trim().toLowerCase() === choice.trim().toLowerCase());
      if (found) return found;
    }
    const foundFallback = userCategories.find(c => c.trim().toLowerCase() === fallback.trim().toLowerCase());
    if (foundFallback) return foundFallback;
    
    const foundOutros = userCategories.find(c => c.trim().toLowerCase() === 'outros' || c.trim().toLowerCase() === 'outras');
    return foundOutros || 'Outros';
  };

  // 1. Normalize Description & Amount signs
  const originalDescription = description;
  const cleanedDesc = cleanDescription(description);

  const isDespesa = detectedDirection === 'Despesa' || (detectedDirection !== 'Receita' && amount < 0);
  const direction: 'Receita' | 'Despesa' = isDespesa ? 'Despesa' : 'Receita';

  // Prep default structures
  let result: Partial<RecognitionResult> = {
    type: direction,
    category: 'Outros',
    cleanDescription: cleanedDesc,
    confidence: 0.30,
    evidence: [],
    needsReview: true,
    aiUsed: false,
    isLikelyInternalTransfer: false,
    shouldIgnoreInTotals: false,
    merchantKey: generateMerchantKey(merchant || description),
    originalDescription: originalDescription
  };

  // 2. Pre-step: Detect transfer patterns immediately
  const transferCheck = detectInternalTransfer(input);
  if (transferCheck.isLikelyInternalTransfer) {
    result.isLikelyInternalTransfer = true;
    result.shouldIgnoreInTotals = transferCheck.shouldIgnoreInTotals;
    result.category = 'Transferências Internas';
    result.cleanDescription = cleanedDesc;
    result.method = 'TRANSFER_MATCH';
    result.confidence = 0.95;
    result.needsReview = false;
    result.evidence = [transferCheck.evidence || "Transferência ou aplicação detectada."];
    return result as RecognitionResult;
  }

  // 3. Apply Explicit User-configured Monarch/Tiller Priority Rules
  const sortedUserRules = [...userRules].sort((a, b) => b.priority - a.priority);
  for (const rule of sortedUserRules) {
    if (matchRule(input, rule)) {
      result.matchedRuleId = rule.id;
      result.method = 'USER_RULE';
      result.confidence = 1.0;
      result.needsReview = false;
      result.evidence = [`Combinação com a regra de prioridade do usuário "${rule.name}"`];
      
      // Mutates type, category, cleanDescription, ignoreInTotals, needsReview etc on result
      applyRuleActions(rule.actions, result);
      return result as RecognitionResult;
    }
  }

  // 3.5. Operation Details/Types + heuristics (banking explicit metadata takes high priority)
  if (operationType) {
    const opUpper = operationType.toUpperCase();
    const typeLower = operationType.toLowerCase();

    if (opUpper === 'FOLHA_PAGAMENTO' || opUpper === 'PORTABILIDADE_SALARIO') {
      result.category = 'Salário';
      result.cleanDescription = 'Salário Recebido';
      result.confidence = 0.95;
      result.method = 'OPERATION_TYPE';
      result.type = 'Receita';
      result.needsReview = false;
      result.evidence = [`Operação bancária expressamente registrada como recebimento de salário (${operationType}).`];
      return result as RecognitionResult;
    }

    if (opUpper === 'RENDIMENTO_APLIC_FINANCEIRA') {
      result.category = 'Investimentos';
      result.cleanDescription = 'Rendimento de Aplicação Financeira';
      result.confidence = 0.95;
      result.method = 'OPERATION_TYPE';
      result.type = 'Receita';
      result.needsReview = false;
      result.evidence = ['Rendimento de aplicação financeira recebido.'];
      return result as RecognitionResult;
    }

    if (opUpper === 'RESGATE_APLIC_FINANCEIRA') {
      result.category = 'Investimentos';
      result.cleanDescription = 'Resgate de Aplicação Financeira';
      result.confidence = 0.95;
      result.method = 'OPERATION_TYPE';
      result.type = 'Receita';
      result.needsReview = false;
      result.evidence = ['Resgate de aplicação financeira efetuado.'];
      return result as RecognitionResult;
    }

    if (opUpper === 'APLICACAO_FINANCEIRA') {
      result.category = 'Investimentos';
      result.cleanDescription = 'Aplicação Financeira';
      result.confidence = 0.95;
      result.method = 'OPERATION_TYPE';
      result.type = 'Despesa';
      result.needsReview = false;
      result.evidence = ['Aplicação de recursos em investimento financeiro.'];
      return result as RecognitionResult;
    }

    if (opUpper === 'PACOTE_TARIFA_SERVICOS' || opUpper === 'TARIFA_SERVICOS_AVULSOS') {
      result.category = selectCategory(['Tarifas Bancárias'], 'Tarifas Bancárias');
      result.cleanDescription = 'Tarifa de Serviços Bancários';
      result.confidence = 0.95;
      result.method = 'OPERATION_TYPE';
      result.type = 'Despesa';
      result.needsReview = false;
      result.evidence = [`Cobrança de tarifa bancária (${operationType}).`];
      return result as RecognitionResult;
    }

    if (opUpper === 'ENCARGOS_JUROS_CHEQUE_ESPECIAL') {
      result.category = selectCategory(['Tarifas Bancárias'], 'Tarifas Bancárias');
      result.cleanDescription = 'Juros de Cheque Especial';
      result.confidence = 0.95;
      result.method = 'OPERATION_TYPE';
      result.type = 'Despesa';
      result.needsReview = false;
      result.evidence = ['Cobrança de juros de cheque especial.'];
      return result as RecognitionResult;
    }

    if (opUpper === 'IOF') {
      result.category = selectCategory(['Impostos e Taxas', 'Tarifas Bancárias'], 'Impostos e Taxas');
      result.cleanDescription = 'Imposto IOF';
      result.confidence = 0.95;
      result.method = 'OPERATION_TYPE';
      result.type = 'Despesa';
      result.needsReview = false;
      result.evidence = ['Imposto sobre Operações Financeiras (IOF).'];
      return result as RecognitionResult;
    }

    if (opUpper === 'SAQUE') {
      result.category = selectCategory(['Transferências Internas'], 'Transferências Internas');
      result.cleanDescription = 'Saque em Dinheiro';
      result.confidence = 0.60; // Lower confidence to avoid being treated with absolute automatic certainty
      result.method = 'OPERATION_TYPE';
      result.needsReview = true; // Needs review in case it is spent or moved as cash
      result.evidence = ['Saque de recursos em espécie (não é necessariamente uma despesa final direta).'];
      return result as RecognitionResult;
    }

    if (opUpper === 'TRANSFERENCIA_MESMA_INSTITUICAO') {
      result.category = selectCategory(['Transferências Internas'], 'Transferências Internas');
      result.cleanDescription = cleanedDesc || 'Trf. mesma instituição';
      result.confidence = 0.95;
      result.method = 'OPERATION_TYPE';
      result.needsReview = false;
      result.isLikelyInternalTransfer = true;
      result.shouldIgnoreInTotals = true;
      result.evidence = ['Transferência entre contas de mesma titularidade na mesma instituição. Tratada como transferência interna.'];
      return result as RecognitionResult;
    }

    if (['PIX', 'TED', 'DOC', 'BOLETO'].includes(opUpper)) {
      // PIX/TED/DOC/BOLETO sozinhos não devem gerar categoria de alta confiança sem contraparte/histórico/merchant
      result.method = 'OPERATION_TYPE';
      result.confidence = 0.35;
      result.needsReview = true;
      result.evidence = [`Meio de pagamento genérico (${operationType}) sem identificação conclusiva do estabelecimento.`];
    } else if (typeLower.includes('salary') || typeLower.includes('salario')) {
      result.category = 'Salário';
      result.cleanDescription = 'Salário Recebido';
      result.confidence = 0.90;
      result.method = 'OPERATION_TYPE';
      result.type = 'Receita';
      result.needsReview = false;
      result.evidence = ['Operação bancária expressamente registrada como faturamento salarial.'];
      return result as RecognitionResult;
    } else if (typeLower.includes('juros') || typeLower.includes('interest')) {
      const targetCat = selectCategory(['Tarifas Bancárias'], 'Tarifas Bancárias');
      const hasCompatible = userCategories.some(c => c.trim().toLowerCase() === 'tarifas bancárias');

      result.category = targetCat;
      result.cleanDescription = 'Juros / Encargos';
      result.confidence = 0.75;
      result.method = 'OPERATION_TYPE';
      result.needsReview = !hasCompatible;
      result.evidence = [`Cobrança genérica de juros ou encargos bancários (${operationType}).` + (!hasCompatible ? ' Usuário não possui categoria de Tarifas Bancárias cadastrada.' : '')];
      return result as RecognitionResult;
    }
  }

  // 4. Description Match (learn from user verified past transactions)
  const historyMatch = matchDescriptionFromHistory(description, merchant, userHistory);
  if (historyMatch) {
    result.category = historyMatch.category;
    result.cleanDescription = historyMatch.cleanDescription;
    result.confidence = historyMatch.confidence;
    result.method = 'DESCRIPTION_MATCH';
    result.needsReview = historyMatch.confidence < 0.75;
    result.evidence = [historyMatch.evidence];
    return result as RecognitionResult;
  }

  // 5. CNPJ identification match
  if (cnpj) {
    const cleanCnpj = cnpj.replace(/\D/g, '');
    if (CNPJ_MAP[cleanCnpj]) {
      const match = CNPJ_MAP[cleanCnpj];
      result.category = match.category;
      result.cleanDescription = match.cleanDescription;
      result.confidence = 0.98;
      result.method = 'MERCHANT_CNPJ';
      result.needsReview = false;
      result.evidence = [`CNPJ Mapeado: ${cnpj} correspondente à marca "${match.cleanDescription}".`];
      return result as RecognitionResult;
    }
  }

  // 6. Natural Brazilian Language Dictionary patterns match
  const dictMatch = resolveByNameDictionary(merchant || description, direction);
  if (dictMatch) {
    result.category = dictMatch.category;
    result.cleanDescription = dictMatch.cleanDescription;
    result.confidence = 0.95;
    result.method = 'MERCHANT_ALIAS';
    result.needsReview = false;
    result.evidence = [`Identificado no dicionário financeiro local como "${dictMatch.cleanDescription}".`];
    return result as RecognitionResult;
  }

  // 7. MCC Codes Mapper
  if (mcc) {
    const mappedMcc = mapMccToCategory(mcc);
    if (mappedMcc) {
      result.category = selectCategory([mappedMcc.category], mappedMcc.category);
      result.confidence = 0.85;
      result.method = 'MCC';
      result.needsReview = false;
      result.evidence = [mappedMcc.evidence];
      return result as RecognitionResult;
    }
  }

  // 8. Pluggy's Raw Category mappings (Pluggy Category Mapper)
  if (input.originalCategory) {
    const mappedPluggy = mapPluggyCategory(input.originalCategory);
    if (mappedPluggy) {
      result.category = mappedPluggy;
      result.confidence = 0.78;
      result.method = 'PLUGGY_CATEGORY';
      result.needsReview = false;
      result.evidence = [`Originalmente categorizado pela Pluggy como "${input.originalCategory}".`];
      return result as RecognitionResult;
    }
  }

  // 10. Check known digital subscription brands
  if (isKnownSubscription(description)) {
    result.category = 'Assinaturas';
    result.confidence = 0.90;
    result.method = 'RECURRING_PATTERN';
    result.needsReview = false;
    result.evidence = ['Assinatura ou mensalidade digital reconhecida heuristicamente na descrição.'];
    return result as RecognitionResult;
  }

  // 11. Text salary heuristics (check salary keywords)
  const descLower = description.toLowerCase();
  if (descLower.includes('salario') || descLower.includes('salário') || descLower.includes('pro labore') || descLower.includes('prolabore')) {
    result.type = 'Receita';
    result.category = 'Salário';
    result.cleanDescription = 'Salário Recebido';
    result.confidence = 0.85;
    result.method = 'TEXT_HEURISTIC';
    result.needsReview = false;
    result.evidence = ['Histórico de palavra-chave correspondendo a rendimento salarial ou pró-labore.'];
    return result as RecognitionResult;
  }

  // 12. Fallback default Outros category
  result.method = 'REVIEW_REQUIRED';
  result.confidence = 0.30;
  result.needsReview = true;
  result.evidence = ['Sem correspondências de alta confiança no motor de reconhecimento determinístico.'];

  return result as RecognitionResult;
}
