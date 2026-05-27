export type RecognitionMethod =
  | 'USER_RULE'
  | 'DESCRIPTION_MATCH'
  | 'MERCHANT_CNPJ'
  | 'MERCHANT_ALIAS'
  | 'MCC'
  | 'CNAE'
  | 'PLUGGY_CATEGORY'
  | 'OPERATION_TYPE'
  | 'RECURRING_PATTERN'
  | 'TRANSFER_MATCH'
  | 'TEXT_HEURISTIC'
  | 'AMOUNT_ACCOUNT_RULE'
  | 'AI_FALLBACK'
  | 'MANUAL'
  | 'REVIEW_REQUIRED';

export interface RawTransactionInput {
  description: string;
  amount: number;
  operationType?: string | null;
  mcc?: string | number | null;
  cnpj?: string | null;
  merchant?: string | null;
  pluggyId?: string;
  detectedDirection?: 'Receita' | 'Despesa';
  accountId?: string;
  itemId?: string;
  source?: string;
  bankRawName?: string;
  originalCategory?: string; // category returned by Pluggy/original bank API
}

export interface RecognitionResult {
  type: 'Receita' | 'Despesa';
  category: string;
  cleanDescription: string;
  confidence: number;
  method: RecognitionMethod;
  evidence: string[];
  needsReview: boolean;
  aiUsed: boolean;
  aiReason?: string;
  matchedRuleId?: string;
  merchantKey?: string;
  originalDescription?: string;
  isLikelyInternalTransfer: boolean;
  shouldIgnoreInTotals: boolean;
}

export interface RuleCondition {
  field:
    | 'merchantKey'
    | 'description'
    | 'originalDescription'
    | 'merchantName'
    | 'merchantCnpj'
    | 'amount'
    | 'absAmount'
    | 'accountId'
    | 'source'
    | 'bankRawName'
    | 'type'
    | 'operationType'
    | 'mcc'
    | 'pluggyCategory'
    | 'isRecurring';
  operator:
    | 'equals'
    | 'contains'
    | 'startsWith'
    | 'endsWith'
    | 'regex'
    | 'between'
    | 'greaterThan'
    | 'lessThan'
    | 'in';
  value: any;
}

export interface RuleAction {
  type:
    | 'setCategory'
    | 'setDescription'
    | 'setType'
    | 'setSource'
    | 'addTag'
    | 'markInternalTransfer'
    | 'ignoreInTotals'
    | 'markNeedsReview';
  value: any;
}

export interface UserRecognitionRule {
  id: string;
  userId: string;
  name: string;
  enabled: boolean;
  priority: number;
  scope: 'all' | 'manual' | 'pluggy' | 'imported';
  conditions: RuleCondition[];
  actions: RuleAction[];
  stopProcessing: boolean;
  createdAt: any;
  updatedAt: any;
  usageCount: number;
  lastUsedAt?: any;
  createdFromTransactionId?: string;
}

export interface RecognitionStats {
  total: number;
  userRules: number;
  descriptionMatch: number;
  localAuto: number;
  localProbable: number;
  aiFallback: number;
  needsReview: number;
  internalTransfers: number;
  ignoredInTotals: number;
}
