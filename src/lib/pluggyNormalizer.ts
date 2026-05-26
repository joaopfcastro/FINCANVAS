const BANK_ALIASES: Array<{ match: RegExp; canonical: string }> = [
  { match: /\b(nu pagamentos|nubank|nu bank|nu\b)/i, canonical: "Nubank" },
  { match: /\b(itau|itaú|itaú unibanco|itau unibanco)\b/i, canonical: "Itaú" },
  { match: /\b(banco do brasil|bb)\b/i, canonical: "Banco do Brasil" },
  { match: /\b(bradesco)\b/i, canonical: "Bradesco" },
  { match: /\b(santander)\b/i, canonical: "Santander" },
  { match: /\b(inter|banco inter)\b/i, canonical: "Inter" },
  { match: /\b(caixa|caixa economica|caixa econômica)\b/i, canonical: "Caixa" },
  { match: /\b(c6|c6 bank)\b/i, canonical: "C6 Bank" },
  { match: /\b(btgpactual|btg pactual|btg)\b/i, canonical: "BTG Pactual" },
  { match: /\b(xp investimentos|xp)\b/i, canonical: "XP" },
  { match: /\b(picpay)\b/i, canonical: "PicPay" },
  { match: /\b(mercado pago|mercadopago)\b/i, canonical: "Mercado Pago" },
  { match: /\b(pagseguro|pagbank)\b/i, canonical: "PagBank" },
  { match: /\b(stone)\b/i, canonical: "Stone" },
  { match: /\b(sicoob)\b/i, canonical: "Sicoob" },
  { match: /\b(sicredi)\b/i, canonical: "Sicredi" },
  { match: /\b(asaas)\b/i, canonical: "Asaas" },
  { match: /\b(pan|banco pan)\b/i, canonical: "Banco Pan" },
  { match: /\b(neon)\b/i, canonical: "Neon" },
  { match: /\b(next)\b/i, canonical: "Next" },
  { match: /\b(original|banco original)\b/i, canonical: "Original" },
  { match: /\b(rico)\b/i, canonical: "Rico" },
  { match: /\b(celcoin)\b/i, canonical: "Celcoin" },
  { match: /\b(dock)\b/i, canonical: "Dock" }
];

export function cleanBankName(rawName: string): string {
  if (!rawName) return "";
  let cleaned = rawName
    .replace(/\b(MEU PUGGLY|MEU\.PUGGLY|MEU\.PLUGGY|PUGGLY|PLUGGY|OPEN FINANCE|SANDBOX|API|BANCO TESTE|TEST|CONTA)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b(PAGAMENTOS S\.A\.|PAGAMENTOS S\/A|PAGAMENTOS LTDA|PAGAMENTOS S\.A|PAGAMENTOS|INSTITUIÇÃO DE PAGAMENTO|INSTITUICAO DE PAGAMENTO|S\.A\.|S\/A|LTDA)\b/gi, "")
    .replace(/[^a-zA-Z0-9à-úâ-ûã-õç\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    cleaned = rawName.replace(/[^a-zA-Z0-9à-úâ-ûã-õç\s-]/g, "").trim();
  }
  return cleaned;
}

export function normalizeInstitutionName(input: {
  connectorName?: string;
  providerName?: string;
  itemName?: string;
  accountName?: string;
  marketingName?: string;
}): {
  source: string;
  sourceRaw: string;
  bankRawName: string;
  confidence: number;
  reason: string;
} {
  const parts = [
    input.connectorName,
    input.providerName,
    input.itemName,
    input.accountName,
    input.marketingName
  ].filter(Boolean) as string[];

  const sourceRaw = parts.join(" - ");
  const primaryRaw = input.accountName || input.connectorName || input.providerName || input.itemName || "Desconhecido";
  const bankRawName = cleanBankName(primaryRaw);

  const testString = sourceRaw.toLowerCase();

  for (const alias of BANK_ALIASES) {
    if (alias.match.test(testString)) {
      return {
        source: alias.canonical,
        sourceRaw,
        bankRawName,
        confidence: 0.98,
        reason: `Alias ${alias.canonical} normalizado com base nos campos disponíveis.`
      };
    }
  }

  const sourceCleaned = cleanBankName(primaryRaw);
  return {
    source: sourceCleaned || "Banco",
    sourceRaw,
    bankRawName,
    confidence: 0.6,
    reason: "Heurística de limpeza básica de strings (Nenhum alias mapeado encontrado)."
  };
}

export function buildAccountLabel(account: any): string {
  if (!account) return "Conta";
  const subtype = (account.subtype || "").toUpperCase();
  
  if (subtype === "CREDIT_CARD") {
    return account.number ? `Cartão final ${account.number}` : "Cartão de crédito";
  }
  if (subtype === "CHECKING_ACCOUNT") {
    return "Conta corrente";
  }
  if (subtype === "SAVINGS_ACCOUNT") {
    return "Poupança";
  }

  return account.marketingName || account.name || "Conta";
}

export function cleanDescriptionLocally(desc: string): string {
  if (!desc) return "";
  const descLower = desc.toLowerCase();

  const MERCH_ALIASES = [
    { match: /\b(ifood|ifd)\b/i, canonical: "iFood" },
    { match: /\b(uber)\b/i, canonical: "Uber" },
    { match: /\b(99app|99\s*taxi|99ap)\b/i, canonical: "99" },
    { match: /\b(netflix)\b/i, canonical: "Netflix" },
    { match: /\b(spotify)\b/i, canonical: "Spotify" },
    { match: /\b(amazon|amzn)\b/i, canonical: "Amazon" },
    { match: /\b(mercado livre|mercadolivre|mercado-livre)\b/i, canonical: "Mercado Livre" },
    { match: /\b(cabify)\b/i, canonical: "Cabify" },
  ];

  for (const merch of MERCH_ALIASES) {
    if (merch.match.test(descLower)) {
      return merch.canonical;
    }
  }

  let cleaned = desc
    .replace(/\b(PIX ENVIADO|PIX RECEBIDO|TED ENVIADA|TED RECEBIDA|DOC ENVIADO|DOC RECEBIDO|TRANSFERENCIA ENVIADA|TRANSFERENCIA RECEBIDA|PAGAMENTO ENVIADO|PAGAMENTO RECEBIDO)\b/gi, "")
    .replace(/\b(PIX QR CODE ESTATICO|PIX QR CODE ESTATI|TARIFA BANCARIA COMPRA|DOC\/TED COMPRA NO CARTAO|COMPRA NO CARTAO|COMPRA CARTÃO|COMPRA CARTAO|PGTO COMPRA)\b/gi, "")
    .replace(/[\d]{13,}/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  } else {
    cleaned = desc;
  }
  return cleaned;
}

export function classifyPluggyDirection(input: {
  amount: number;
  pluggyType?: string;
  accountType?: string;
  accountSubtype?: string;
  description?: string;
  operationType?: string | null;
  originalCategory?: string | null;
  paymentData?: any;
}): {
  detectedDirection: "Despesa" | "Receita";
  normalizedAmount: number;
  confidence: number;
  reason: string;
  isLikelyInternalTransfer: boolean;
  shouldIgnoreInTotals: boolean;
} {
  const amountVal = input.amount;
  const absAmount = Math.abs(amountVal);
  const pluggyType = (input.pluggyType || "").toUpperCase();
  const accountType = (input.accountType || "").toUpperCase();
  const accountSubtype = (input.accountSubtype || "").toUpperCase();
  const descLower = (input.description || "").toLowerCase();

  const isInternalTransfer = () => {
    return (
      descLower.includes("transferência entre contas") ||
      descLower.includes("transf entre contas") ||
      descLower.includes("transferencia entre contas") ||
      descLower.includes("aplicação") ||
      descLower.includes("aplicacao") ||
      descLower.includes("resgate") ||
      descLower.includes("investimento") ||
      descLower.includes("previdência") ||
      descLower.includes("previdencia")
    );
  };

  const isBillPaymentPattern = () => {
    return (
      descLower.includes("pagamento fatura") ||
      descLower.includes("pagto cartao") ||
      descLower.includes("pagamento de fatura") ||
      descLower.includes("pagamento cartão") ||
      descLower.includes("pagamento cartao") ||
      descLower.includes("pagamento crédito") ||
      descLower.includes("pagamento credito") ||
      descLower.includes("pagto fatur") ||
      descLower.includes("pago fatura") ||
      descLower.includes("fatura paga")
    );
  };

  const isCreditCard = accountType === "CREDIT" || accountType === "CREDIT_CARD" || accountSubtype === "CREDIT_CARD";

  // 1. Explicit pluggy type (DEBIT/CREDIT) dominates, preserving card statement behaviors
  if (pluggyType === "DEBIT") {
    const internal = isCreditCard ? false : isInternalTransfer();
    return {
      detectedDirection: "Despesa",
      normalizedAmount: absAmount,
      confidence: 0.99,
      reason: "Tipo da transação explicitamente definido como DEBIT pela Pluggy.",
      isLikelyInternalTransfer: internal,
      shouldIgnoreInTotals: internal
    };
  }

  if (pluggyType === "CREDIT") {
    const isCcPayment = isCreditCard && (isBillPaymentPattern() || descLower.includes("pagamento") || descLower.includes("pago"));
    return {
      detectedDirection: "Receita",
      normalizedAmount: absAmount,
      confidence: 0.99,
      reason: isCcPayment 
        ? "Cartão de Crédito - Pagamento de fatura recebido (ignorado nos totais para evitar dupla contagem com o débito em conta)"
        : "Tipo da transação explicitamente definido como CREDIT pela Pluggy.",
      isLikelyInternalTransfer: isCcPayment ? true : isInternalTransfer(),
      shouldIgnoreInTotals: isCcPayment ? true : isInternalTransfer()
    };
  }

  // 2. Fallbacks when explicit pluggyType is not provided
  if (isCreditCard) {
    if (isBillPaymentPattern() || descLower.includes("pagamento") || descLower.includes("pago")) {
      return {
        detectedDirection: "Receita",
        normalizedAmount: absAmount,
        confidence: 0.95,
        reason: "Cartão de Crédito - Pagamento de fatura identificado (ignorado nos totais para evitar dupla contagem com o débito em conta)",
        isLikelyInternalTransfer: true,
        shouldIgnoreInTotals: true
      };
    }

    if (amountVal > 0) {
      return {
        detectedDirection: "Despesa",
        normalizedAmount: absAmount,
        confidence: 0.95,
        reason: "Cartão de Crédito - Compra / Gasto padrão (valor positivo aumenta o saldo devedor do cartão)",
        isLikelyInternalTransfer: false,
        shouldIgnoreInTotals: false
      };
    } else if (amountVal < 0) {
      return {
        detectedDirection: "Receita",
        normalizedAmount: absAmount,
        confidence: 0.90,
        reason: "Cartão de Crédito - Estorno, cashback ou ajuste de saldo (valor negativo diminui saldo devedor)",
        isLikelyInternalTransfer: false,
        shouldIgnoreInTotals: false
      };
    }
  }

  const despesaKeywords = [
    "pix enviado", "pix pago", "pagamento", "compra", "débito", "debito", "boleto pago",
    "tarifa", "saque", "transferência enviada", "ted enviada", "doc enviado", "cartão",
    "uber", "ifood", "mercado", "assinatura", "farmácia", "posto", "boleto", "mensalidade"
  ];

  const receitaKeywords = [
    "pix recebido", "transferência recebida", "ted recebida", "doc recebido", "salário",
    "salario", "folha pagamento", "rendimento", "resgate", "estorno", "cashback", "depósito", "deposito", "reembolso"
  ];

  for (const kw of despesaKeywords) {
    if (descLower.includes(kw)) {
      return {
        detectedDirection: "Despesa",
        normalizedAmount: absAmount,
        confidence: 0.85,
        reason: `Heurística de descrição combinou com palavra-chave de despesa: '${kw}'`,
        isLikelyInternalTransfer: isInternalTransfer(),
        shouldIgnoreInTotals: isInternalTransfer()
      };
    }
  }

  for (const kw of receitaKeywords) {
    if (descLower.includes(kw)) {
      return {
        detectedDirection: "Receita",
        normalizedAmount: absAmount,
        confidence: 0.85,
        reason: `Heurística de descrição combinou com palavra-chave de receita: '${kw}'`,
        isLikelyInternalTransfer: isInternalTransfer(),
        shouldIgnoreInTotals: isInternalTransfer()
      };
    }
  }

  const detected = amountVal < 0 ? "Despesa" : "Receita";
  const internal = isInternalTransfer();
  return {
    detectedDirection: detected,
    normalizedAmount: absAmount,
    confidence: 0.45,
    reason: `Heurística final de fallback baseada em sinal numérico (valor = ${amountVal})`,
    isLikelyInternalTransfer: internal,
    shouldIgnoreInTotals: internal
  };
}
