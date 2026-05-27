export function cleanDescription(desc: string): string {
  if (!desc) return "";
  let cleaned = desc
    .replace(/\b(PIX ENVIADO|PIX RECEBIDO|TED ENVIADA|TED RECEBIDA|DOC ENVIADO|DOC RECEBIDO|TRANSFERENCIA ENVIADA|TRANSFERENCIA RECEBIDA|PAGAMENTO ENVIADO|PAGAMENTO RECEBIDO)\b/gi, "")
    .replace(/\b(PIX QR CODE ESTATICO|PIX QR CODE ESTATI|TARIFA BANCARIA COMPRA|DOC\/TED COMPRA NO CARTAO|COMPRA NO CARTAO|COMPRA CARTÃO|COMPRA CARTAO|PGTO COMPRA)\b/gi, "")
    .replace(/[\d]{13,}/g, "") // remove extremely long tracking numbers or order IDs
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  } else {
    cleaned = desc;
  }
  return cleaned;
}

export function generateMerchantKey(description: string): string {
  if (!description) return '';
  return description
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    // remove specific transaction noise
    .replace(/\b(pix enviado|pix recebido|ted enviada|ted recebida|doc enviado|doc recebido|pagamento de|pagto|pgto|compra|compra no|tarifa|tarifa bancaria|transferencia enviada|transferencia recebida|pago|enviado|recebido|recebido de|enviado para)\b/gi, "")
    .replace(/[^a-z0-9\s]/g, "") // alphanumeric only
    .replace(/\s+/g, ' ')
    .trim();
}

export function isMerchantKeyReliable(merchantKey: string): boolean {
  if (!merchantKey) return false;
  const clean = merchantKey.trim();
  if (clean.length < 3) return false;

  // Exclude hex keys / UUID-like parts
  if (/^[0-9a-f]{10,}$/i.test(clean)) return false;

  // Exclude patterns that are mostly numbers
  const numbersCount = (clean.match(/\d/g) || []).length;
  if (numbersCount / clean.length > 0.4) return false;

  const words = clean.split(' ');
  // Exclude common personal Portuguese last names to avoid learning rules based on peer-to-peer personal transfers
  const personalFilter = [
    'silva', 'santos', 'oliveira', 'souza', 'rodrigues', 'ferreira', 'alves', 'pereira', 'lima', 'gomes', 'costa', 'ribeiro', 'martins', 'carvalho'
  ];
  if (words.length <= 3) {
    if (words.some(w => personalFilter.includes(w))) {
      return false;
    }
  }

  // Exclude matches containing only generic financial verb phrases
  const forbiddenExcludes = ['enviado', 'recebido', 'transferencia', 'ted', 'doc', 'chave', 'qr', 'qrcode', 'estatico', 'dinheiro', 'pix', 'pagamento'];
  if (words.every(w => forbiddenExcludes.includes(w))) {
    return false;
  }

  return true;
}
