import { RawTransactionInput, RuleCondition, RuleAction, RecognitionResult, UserRecognitionRule } from "../types";
import { generateMerchantKey } from "../normalize/text";

export function matchCondition(input: RawTransactionInput, cond: RuleCondition): boolean {
  let fieldValue: any;

  switch (cond.field) {
    case 'merchantKey':
      fieldValue = generateMerchantKey(input.merchant || input.description);
      break;
    case 'description':
      fieldValue = input.description;
      break;
    case 'originalDescription':
      fieldValue = input.description; // We might not have distinct descriptionRaw here, fallback to description
      break;
    case 'merchantName':
      fieldValue = input.merchant || '';
      break;
    case 'merchantCnpj':
      fieldValue = input.cnpj || '';
      break;
    case 'amount':
      fieldValue = input.amount;
      break;
    case 'absAmount':
      fieldValue = Math.abs(input.amount);
      break;
    case 'accountId':
      fieldValue = input.accountId || '';
      break;
    case 'source':
      fieldValue = input.source || '';
      break;
    case 'bankRawName':
      fieldValue = input.bankRawName || '';
      break;
    case 'type':
      fieldValue = input.detectedDirection || '';
      break;
    case 'operationType':
      fieldValue = input.operationType || '';
      break;
    case 'mcc':
      fieldValue = input.mcc ? String(input.mcc) : '';
      break;
    case 'pluggyCategory':
      fieldValue = input.originalCategory || '';
      break;
    case 'isRecurring':
      fieldValue = false; // Resolved in engine or recurrence matcher
      break;
    default:
      return false;
  }

  const cleanVal = (val: any) => typeof val === 'string' ? val.toLowerCase().trim() : val;
  const targetVal = cond.value;

  const fv = typeof fieldValue === 'string' ? cleanVal(fieldValue) : fieldValue;
  const tv = typeof targetVal === 'string' ? cleanVal(targetVal) : targetVal;

  switch (cond.operator) {
    case 'equals':
      return fv === tv;
    case 'contains':
      if (typeof fv !== 'string' || typeof tv !== 'string') return false;
      return fv.includes(tv);
    case 'startsWith':
      if (typeof fv !== 'string' || typeof tv !== 'string') return false;
      return fv.startsWith(tv);
    case 'endsWith':
      if (typeof fv !== 'string' || typeof tv !== 'string') return false;
      return fv.endsWith(tv);
    case 'regex':
      try {
        const regex = new RegExp(String(targetVal), 'i');
        return regex.test(String(fieldValue));
      } catch (e) {
        return false;
      }
    case 'between':
      if (!Array.isArray(targetVal) || targetVal.length !== 2) return false;
      const numFv = Number(fieldValue);
      return numFv >= Number(targetVal[0]) && numFv <= Number(targetVal[1]);
    case 'greaterThan':
      return Number(fieldValue) > Number(targetVal);
    case 'lessThan':
      return Number(fieldValue) < Number(targetVal);
    case 'in':
      if (Array.isArray(targetVal)) {
        return targetVal.map(cleanVal).includes(fv);
      }
      if (typeof targetVal === 'string') {
        return targetVal.split(',').map(s => s.toLowerCase().trim()).includes(fv);
      }
      return false;
    default:
      return false;
  }
}

export function matchRule(input: RawTransactionInput, rule: UserRecognitionRule): boolean {
  if (!rule.enabled) return false;

  // Enforce scope constraints
  if (rule.scope !== 'all') {
    // scope: 'manual' | 'pluggy' | 'imported';
    const isPluggy = !!input.pluggyId;
    const isImported = !input.pluggyId && input.source === 'Importado'; // Custom tag for imported transactions
    const isManual = !input.pluggyId && !isImported;

    if (rule.scope === 'manual' && !isManual) return false;
    if (rule.scope === 'pluggy' && !isPluggy) return false;
    if (rule.scope === 'imported' && !isImported) return false;
  }

  if (!rule.conditions || rule.conditions.length === 0) return false;

  // Monarch and standard Tiller engines match ALL conditions (AND)
  return rule.conditions.every(cond => matchCondition(input, cond));
}

export function applyRuleActions(actions: RuleAction[], result: Partial<RecognitionResult>): void {
  for (const action of actions) {
    switch (action.type) {
      case 'setCategory':
        result.category = String(action.value);
        break;
      case 'setDescription':
        result.cleanDescription = String(action.value);
        break;
      case 'setType':
        result.type = action.value === 'Receita' ? 'Receita' : 'Despesa';
        break;
      case 'markInternalTransfer':
        result.isLikelyInternalTransfer = !!action.value;
        if (result.isLikelyInternalTransfer) {
          result.category = 'Transferências Internas';
        }
        break;
      case 'ignoreInTotals':
        result.shouldIgnoreInTotals = !!action.value;
        break;
      case 'markNeedsReview':
        result.needsReview = !!action.value;
        break;
      default:
        break;
    }
  }
}
