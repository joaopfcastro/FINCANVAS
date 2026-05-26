import { PluggyService } from "./src/lib/pluggyService";
import { 
  classifyPluggyDirection, 
  normalizeInstitutionName, 
  cleanDescriptionLocally 
} from "./src/lib/pluggyNormalizer";

import * as normalizer from "./src/lib/pluggyNormalizer";

async function runTests() {
  console.log("================================================");
  console.log("🕵️‍♂️ INICIANDO TRILHA DE TESTES UNITÁRIOS: PLUGGY");
  console.log("================================================");
  let failed = false;

  const assert = (condition: boolean, testName: string) => {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      failed = true;
    }
  };

  const assertThrows = async (fn: () => Promise<any>, expectedErrorMsgSubstring: string, testName: string) => {
    try {
      await fn();
      console.error(`❌ [FAIL] ${testName} (Não lançou erro esperado)`);
      failed = true;
    } catch (err: any) {
      const match = err.message.toLowerCase().includes(expectedErrorMsgSubstring.toLowerCase());
      if (match) {
        console.log(`✅ [PASS] ${testName} (Lançou erro correto: "${err.message}")`);
      } else {
        console.error(`❌ [FAIL] ${testName} (Lançou erro incoerente; Esperado contendo "${expectedErrorMsgSubstring}", Recebido: "${err.message}")`);
        failed = true;
      }
    }
  };

  // --- Teste 1: Limpeza / Sanitização de Chaves ---
  try {
    const rawInputWithNewlines = "\n\r  5e64ac32-f32a-43bb-aadc-720aeb5a22bb \r\n  ";
    const sanitizeFunc = (PluggyService as any).sanitize;
    const sanitized = sanitizeFunc(rawInputWithNewlines);
    assert(sanitized === "5e64ac32-f32a-43bb-aadc-720aeb5a22bb", "Higienização de credenciais remove espaços, tabs e line-breaks");
  } catch (err: any) {
    console.error("Erro no Teste 1:", err);
    failed = true;
  }

  // --- Teste 2: Rejeição de Credenciais Vazias ou Nulas ---
  await assertThrows(
    () => PluggyService.authenticate("", "some-secret"),
    "Client ID e Client Secret são campos obrigatórios",
    "Autenticação rejeita Client ID vazio"
  );

  // --- Testes de Normalização de Nomes de Instituições ---
  console.log("\n🧪 Testando Normalização de Bancos:");
  const testBankName = (raw: string, expected: string) => {
    const res = normalizer.normalizeInstitutionName({
      connectorName: raw,
      providerName: raw,
      itemName: raw,
      accountName: raw
    });
    assert(res.source === expected, `Normaliza "${raw}" -> "${expected}"`);
  };

  testBankName("MEU PUGGLY - NU PAGAMENTOS S.A.", "Nubank");
  testBankName("MEU PUGGLY - ITAU UNIBANCO S.A.", "Itaú");
  testBankName("MEU PUGGLY - BANCO BRADESCO S.A.", "Bradesco");
  testBankName("BANCO DO BRASIL S.A.", "Banco do Brasil");
  testBankName("CAIXA ECONOMICA FEDERAL", "Caixa");
  testBankName("INTER MEDIUM S.A.", "Inter");
  testBankName("CELCOIN IP S.A.", "Celcoin");
  testBankName("DOCK INSTITUICAO DE PAGAMENTO", "Dock");

  // --- Testes de Direção Financeira (Receita vs Despesa) ---
  console.log("\n🧪 Testando Direção Financeira (Cenários Críticos):");

  // Caso 1: Compra de Cartão de Crédito (Gasto)
  const ccExpense = normalizer.classifyPluggyDirection({
    amount: -89.90,
    pluggyType: "DEBIT",
    accountType: "CREDIT_CARD",
    description: "SUBSTANTIAL SUPERMARKET PURCHASE"
  });
  assert(ccExpense.detectedDirection === "Despesa", "Gasto em cartão de crédito (DEBIT) de -89.90 é Despesa");
  assert(ccExpense.normalizedAmount === 89.90, "Gasto em cartão de crédito tem valor absoluto correto de 89.90");

  // Caso 2: Pagamento/Fatura de Cartão de Crédito (Pagamento de fatura)
  const ccPayment = normalizer.classifyPluggyDirection({
    amount: 500.00,
    pluggyType: "CREDIT",
    accountType: "CREDIT_CARD",
    description: "PAGAMENTO CRÉDITO RECEBIDO"
  });
  assert(ccPayment.shouldIgnoreInTotals === true, "Pagamento de fatura de cartão de crédito é marcado para ser ignorado nos totais");

  // Caso 3: PIX Recebido (Receita)
  const pixReceived = normalizer.classifyPluggyDirection({
    amount: 150.00,
    pluggyType: "CREDIT",
    accountType: "CHECKING_ACCOUNT",
    description: "PIX RECEBIDO DE JOAO DA SILVA"
  });
  assert(pixReceived.detectedDirection === "Receita", "PIX Recebido (CREDIT, Checking) de 150.00 é Receita");

  // Caso 4: PIX Enviado (Despesa)
  const pixSent = normalizer.classifyPluggyDirection({
    amount: -75.00,
    pluggyType: "DEBIT",
    accountType: "CHECKING_ACCOUNT",
    description: "PIX ENVIADO PARA MARIA"
  });
  assert(pixSent.detectedDirection === "Despesa", "PIX Enviado (DEBIT, Checking) de -75.00 é Despesa");

  // Caso 5: Resgate de Investimento (Transferência Interna)
  const internalTrf = normalizer.classifyPluggyDirection({
    amount: 1000.00,
    pluggyType: "CREDIT",
    accountType: "CHECKING_ACCOUNT",
    description: "RESGATE AUTOMÁTICO DE INVESTIMENTO"
  });
  assert(internalTrf.isLikelyInternalTransfer === true, "Resgate de investimento é detectado como transferência interna");

  // --- Testes de Limpeza de Descrição ---
  console.log("\n🧪 Testando Limpeza de Descrição:");
  const testDescClean = (raw: string, expected: string) => {
    const res = normalizer.cleanDescriptionLocally(raw);
    assert(res === expected, `Limpa "${raw}" -> "${expected}"`);
  };

  testDescClean("IFOOD *RESTAURANTE SAO PAULO BR", "iFood");
  testDescClean("UBER *TRIP HELP RIDE", "Uber");
  testDescClean("99APP RIDE TAXI SEBASTIAO", "99");
  testDescClean("AUTOMOVEL CABIFY BILLING", "Cabify");
  testDescClean("COMPRA MERCADOLIVRE ELETRONICOS", "Mercado Livre");
  testDescClean("PAGAMENTO DE ASSINATURA NETFLIX BR", "Netflix");
  testDescClean("MANDATORIO SPOTIFY MUSIC PREMIUM", "Spotify");

  console.log("================================================");
  if (failed) {
    console.error("🚨 FALHA ENCONTRADA EM UMA OU MAIS ASSERÇÕES!");
    process.exit(1);
  } else {
    console.log("🎉 TODOS OS TESTES UNITÁRIOS PASSARAM COM EXTREMA PRECISÃO!");
    console.log("================================================");
  }
}

runTests().catch(err => {
  console.error("Erro catastrófico na execução dos testes:", err);
  process.exit(1);
});
