// Backward compatible wrapper over the new modular src/lib/recognition engine.
import {
  RawTransactionInput as NewRawInput,
  UserRecognitionRule,
  RecognitionMethod
} from "./recognition/types";
import { runLocalRecognition } from "./recognition/engine/recognitionEngine";
import {
  cleanDescription as newCleanDescription,
  generateMerchantKey as newGenerateMerchantKey,
  isMerchantKeyReliable as newIsMerchantKeyReliable
} from "./recognition/normalize/text";

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
  return newGenerateMerchantKey(description);
}

export function isMerchantKeyReliable(merchantKey: string): boolean {
  return newIsMerchantKeyReliable(merchantKey);
}

export function cleanDescriptionLocally(desc: string): string {
  return newCleanDescription(desc);
}

export function localRecognize(
  input: RawTransactionInput,
  learnedRules: LearnedRule[],
  userCategories: string[]
): TransactionRecognitionResult {
  // Translate LearnedRule to the new UserRecognitionRule format
  const transformedRules: UserRecognitionRule[] = (learnedRules || []).map((lr, idx) => ({
    id: lr.id || `learnt-${lr.merchantKey}-${idx}`,
    userId: lr.userId,
    name: `Aprendizado: ${lr.merchantKey}`,
    enabled: true,
    priority: 1000 + idx,
    scope: 'all',
    conditions: [
      { field: 'merchantKey', operator: 'equals', value: lr.merchantKey }
    ],
    actions: [
      { type: 'setCategory', value: lr.category },
      { type: 'setDescription', value: lr.cleanDescription },
      { type: 'setType', value: lr.type }
    ],
    stopProcessing: true,
    createdAt: lr.createdAt,
    updatedAt: lr.updatedAt,
    usageCount: 0
  }));

  // Adapt raw input
  const rawInput: NewRawInput = {
    description: input.description,
    amount: input.amount,
    operationType: input.operationType,
    mcc: input.mcc,
    cnpj: input.cnpj,
    merchant: input.merchant,
    pluggyId: input.pluggyId,
    detectedDirection: input.detectedDirection
  };

  const newResult = runLocalRecognition(rawInput, transformedRules, [], userCategories);

  // Map recognition methods back to legacy names to prevent UI typing or parsing exceptions
  let legacyMethod: 'LearnedRule' | 'LocalDatabase' | 'MCC' | 'LocalDictionary' | 'Heuristic' | 'AI' = 'Heuristic';
  
  if (newResult.method === 'USER_RULE') {
    legacyMethod = 'LearnedRule';
  } else if (newResult.method === 'MERCHANT_CNPJ') {
    legacyMethod = 'LocalDatabase';
  } else if (newResult.method === 'MCC') {
    legacyMethod = 'MCC';
  } else if (newResult.method === 'MERCHANT_ALIAS' || newResult.method === 'RECURRING_PATTERN') {
    legacyMethod = 'LocalDictionary';
  } else if (newResult.method === 'AI_FALLBACK') {
    legacyMethod = 'AI';
  }

  return {
    type: newResult.type,
    category: newResult.category,
    cleanDescription: newResult.cleanDescription,
    confidence: newResult.confidence,
    method: legacyMethod,
    evidence: newResult.evidence.join(' | '),
    needsReview: newResult.needsReview
  };
}
