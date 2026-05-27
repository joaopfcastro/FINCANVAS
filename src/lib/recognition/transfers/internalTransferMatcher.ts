import { RawTransactionInput } from "../types";

export function detectTransferKeywords(description: string, operationType?: string | null): boolean {
  const descLower = (description || "").toLowerCase();
  
  const isTransferOp = operationType && [
    'TRANSFER', 'APPLICATION', 'REDEMPTION', 'INVESTMENT', 'INTERNAL_TRANSFER'
  ].includes(operationType.toUpperCase());

  if (isTransferOp) return true;

  const kw = [
    "transferencia entre contas",
    "transf entre contas",
    "transferência entre contas",
    "aplicação",
    "aplicacao",
    "resgate",
    "investimento",
    "previdência",
    "previdencia",
    "pagamento fatura",
    "pagto cartao",
    "pagamento de fatura",
    "pagamento cartão",
    "pagamento cartao",
    "pagamento crédito",
    "pagamento credito",
    "pagto fatur",
    "pago fatura",
    "fatura paga"
  ];

  return kw.some(k => descLower.includes(k));
}

export function detectInternalTransfer(input: RawTransactionInput): {
  isLikelyInternalTransfer: boolean;
  shouldIgnoreInTotals: boolean;
  evidence: string | null;
} {
  const { description, operationType, amount, detectedDirection } = input;
  const isKwMatched = detectTransferKeywords(description, operationType);

  if (isKwMatched) {
    const isCcPay = description.toLowerCase().includes("fatura") || description.toLowerCase().includes("cartão");
    return {
      isLikelyInternalTransfer: true,
      shouldIgnoreInTotals: true,
      evidence: isCcPay 
        ? "Identificado como pagamento de fatura ou transferência interna para evitar dupla contagem."
        : "Utilizou operação bancária ou termo indicativo de transferência interna/aplicação financeira."
    };
  }

  // Check matching pairs on the UI/db level is handled at list level, 
  // but we provide single transaction heuristics here.
  return {
    isLikelyInternalTransfer: false,
    shouldIgnoreInTotals: false,
    evidence: null
  };
}
