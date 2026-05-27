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
      result.category = mappedMcc.category;
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

  // 9. Operation Details/Types + heuristics
  if (operationType) {
    const typeLower = operationType.toLowerCase();
    if (typeLower.includes('salary') || typeLower.includes('salario')) {
      result.category = 'Salário';
      result.cleanDescription = 'Salário Recebido';
      result.confidence = 0.90;
      result.method = 'OPERATION_TYPE';
      result.type = 'Receita';
      result.needsReview = false;
      result.evidence = ['Operação bancária expressamente registrada como faturamento salarial.'];
      return result as RecognitionResult;
    }
    if (typeLower.includes('juros') || typeLower.includes('interest')) {
      result.category = 'Outros';
      result.cleanDescription = 'Juros / Encargos';
      result.confidence = 0.85;
      result.method = 'OPERATION_TYPE';
      result.evidence = ['Registrado no faturamento ou despesa de juros bancários.'];
      result.needsReview = false;
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
