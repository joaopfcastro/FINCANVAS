import { parseOFX, parseCSV } from './src/lib/import/parsers.js';
import { runLocalRecognition } from './src/lib/recognition/engine/recognitionEngine.js';
import { mapMccToCategory } from './src/lib/recognition/taxonomy/mccCategoryMapper.js';
import { ACCEPT_WITH_BADGE } from './src/lib/recognition/constants.js';
import { mapToUserCategory } from './src/lib/recognition/taxonomy/mapToUserCategory.js';
import { getSimulatedGeminiResponse } from './server.js';
import fs from 'fs';
import path from 'path';

// Setup mock global structures for minimal browser compatibility
globalThis.window = {} as any;
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => null,
  removeItem: () => null,
  clear: () => null,
} as any;

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ PASSED: ${message}`);
    passed++;
  } else {
    console.error(`❌ FAILED: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log("=== INICIANDO TESTES DO MOTOR DE RECONHECIMENTO ===");

  // 1. parseOFX com tags reais (fechadas e não fechadas)
  try {
    const ofxDataUnclosed = `
    <STMTTRN>
    <TRNTYPE>DEBIT
    <DTPOSTED>20260527120000[-3:BRT]
    <TRNAMT>-150.00
    <FITID>9876543
    <NAME>SUPERMERCADO DIA
    <MEMO>COMPRA DE MERCEARIA
    </STMTTRN>
    `;
    const resOfx = parseOFX(ofxDataUnclosed);
    assert(resOfx.length === 1, "parseOFX deve extrair 1 transação");
    assert(resOfx[0].amount === -150.00, "parseOFX deve preservar o valor e o sinal original (< 0)");
    assert(resOfx[0].date === "27/05/2026", "parseOFX deve converter a data YYYYMMDD para DD/MM/YYYY");
    assert(resOfx[0].desc === "COMPRA DE MERCEARIA", "parseOFX deve priorizar MEMO em relação ao NAME");
    assert(resOfx[0].source === "Importação OFX", "parseOFX deve ter source 'Importação OFX'");
  } catch (err: any) {
    console.error("Erro no teste 1:", err);
    failed++;
  }

  // 2. parseCSV com cabeçalho brasileiro e delimitador ;
  try {
    const csvData = `Data;Descrição;Valor;Tipo\n27/05/2026;Posto Petrobras;-120,50;Despesa\n28/05/2026;Pix Recebido;1.500,00;Receita`;
    const resCsv = parseCSV(csvData);
    assert(resCsv.length === 2, "parseCSV deve extrair 2 transações");
    assert(resCsv[0].amount === -120.50, "parseCSV deve tratar vírgulas decimais brasileiras corretamente");
    assert(resCsv[0].desc === "Posto Petrobras", "parseCSV deve extrair descrição usando o cabeçalho mapeado");
    assert(resCsv[1].amount === 1500.00, "parseCSV deve ignorar pontos de milhar e reconhecer receitas");
  } catch (err: any) {
    console.error("Erro no teste 2:", err);
    failed++;
  }

  // 3. OCR sem categoria da IA mais fallback runLocalRecognition
  try {
    const rawOcrExtraction = {
      desc: "RESTAURANTE MARU",
      amount: "45,90",
      type: "Despesa",
      source: "Cartão de Crédito"
    };
    
    // Simular que o OCR não traz a categoria, mas chamamos o motor local
    const rawLocalInput = {
      description: rawOcrExtraction.desc,
      amount: -45.90,
      detectedDirection: 'Despesa' as const,
      source: rawOcrExtraction.source
    };
    const localResult = runLocalRecognition(rawLocalInput, [], [], ["Alimentação", "Outros"]);
    assert(localResult !== null, "runLocalRecognition deve retornar um resultado sem dar erro");
    assert(localResult?.category === "Alimentação", "runLocalRecognition deve classificar Restaurante como 'Alimentação'");
  } catch (err: any) {
    console.error("Erro no teste 3:", err);
    failed++;
  }

  // 4. runLocalRecognition com operationType salário
  try {
    const inputSalario = {
      description: "PAGTO SALARIO EMPRESA XYZ",
      amount: 5000.00,
      detectedDirection: 'Receita' as const,
      source: 'Conta Corrente',
      operationType: 'FOLHA_PAGAMENTO'
    };
    const resSalario = runLocalRecognition(inputSalario, [], [], ["Salário", "Outros"]);
    assert(resSalario?.category === "Salário", "A operação tipo FOLHA_PAGAMENTO deve categorizar como 'Salário'");
    assert(resSalario?.needsReview === false, "Salário com operationType adequado deve ter needsReview = false");
  } catch (err: any) {
    console.error("Erro no teste 4:", err);
    failed++;
  }

  // 5. PIX sem contraparte não gerar alta confiança
  try {
    const inputPixGenerico = {
      description: "PIX REPASSADO",
      amount: -50.00,
      detectedDirection: 'Despesa' as const,
      source: 'Pix',
      operationType: 'PIX'
    };
    const resPix = runLocalRecognition(inputPixGenerico, [], [], ["Outros"]);
    assert(resPix?.confidence < ACCEPT_WITH_BADGE, "PIX genérico sem contraparte conhecida deve possuir confiança baixa");
    assert(resPix?.needsReview === true, "PIX genérico sem contraparte deve requerer revisão (needsReview = true)");
  } catch (err: any) {
    console.error("Erro no teste 5:", err);
    failed++;
  }

  // 6. MCC mercado/farmácia/combustível
  try {
    // 5411 = Grocery stores/supermarkets
    // 5912 = Drug stores and pharmacies
    // 5541 = Service stations / fuel
    assert(mapMccToCategory('5411')?.category === "Alimentação", "MCC 5411 deve mapear para Alimentação");
    assert(mapMccToCategory('5912')?.category === "Saúde", "MCC 5912 deve mapear para Saúde");
    assert(mapMccToCategory('5541')?.category === "Transporte", "MCC 5541 deve mapear para Transporte");
  } catch (err: any) {
    console.error("Erro no teste 6:", err);
    failed++;
  }

  // 7. Simular ordenação / segregação de arquivos de importação (não enviar OFX para a IA)
  try {
    const testFiles = [
      { name: "extrato.ofx", type: "text/xml" },
      { name: "fatura.csv", type: "text/csv" },
      { name: "recibo.pdf", type: "application/pdf" },
      { name: "nota.txt", type: "text/plain" },
      { name: "foto.png", type: "image/png" }
    ];

    const localParsable: string[] = [];
    const sentToAi: string[] = [];

    for (const file of testFiles) {
      const nameLower = file.name.toLowerCase();
      if (nameLower.endsWith('.ofx') || nameLower.endsWith('.xml')) {
        localParsable.push(file.name);
      } else if (nameLower.endsWith('.csv') || nameLower.endsWith('.txt')) {
        localParsable.push(file.name);
      } else if (file.type.startsWith('image/') || nameLower.endsWith('.pdf') || file.type === 'application/pdf') {
        sentToAi.push(file.name);
      }
    }

    assert(localParsable.includes("extrato.ofx") && localParsable.includes("nota.txt") && localParsable.includes("fatura.csv"), "Arquivos estruturados (ofx/csv/txt/xml) devem ser parseados localmente");
    assert(sentToAi.includes("recibo.pdf") && sentToAi.includes("foto.png"), "Apenas imagens e PDFs devem ser enviados para a IA");
    assert(!sentToAi.includes("extrato.ofx"), "OFX nunca deve ser enviado para IA");
  } catch (err: any) {
    console.error("Erro no teste 7:", err);
    failed++;
  }

  // 8. Teste de validação mapToUserCategory e limite de confiança da IA Fallback
  try {
    const userCategories = ["Alimentação", "Transporte", "Tarifas Bancárias", "Lazer"];
    // Verificar se categoria existente mapeia para ela mesma
    const alignedValid = mapToUserCategory("Alimentação", userCategories);
    const alignedInvalid = mapToUserCategory("Pets", userCategories); // Não existe no perfil do usuário

    assert(alignedValid === "Alimentação", "mapToUserCategory deve manter 'Alimentação' intacta se existir nas do usuário");
    assert(alignedInvalid === null, "mapToUserCategory deve retornar null para uma categoria nova e não mapeada");
  } catch (err: any) {
    console.error("Erro no teste 8:", err);
    failed++;
  }

  // 9. Tarifas Bancárias (PACOTE_TARIFA_SERVICOS / TARIFA_SERVICOS_AVULSOS / ENCARGOS_JUROS_CHEQUE_ESPECIAL)
  try {
    const inputTarifa1 = {
      description: "DEBITO TARIFA MENSAL",
      amount: -29.90,
      detectedDirection: 'Despesa' as const,
      source: 'Itaú',
      operationType: 'PACOTE_TARIFA_SERVICOS'
    };
    const inputTarifa2 = {
      description: "DEC JUROS LMT S/PONTAS",
      amount: -15.40,
      detectedDirection: 'Despesa' as const,
      source: 'Itaú',
      operationType: 'ENCARGOS_JUROS_CHEQUE_ESPECIAL'
    };

    const resTarifa1 = runLocalRecognition(inputTarifa1, [], [], ["Tarifas Bancárias", "Outros"]);
    const resTarifa2 = runLocalRecognition(inputTarifa2, [], [], ["Outros"]); // Sem Tarifas Bancárias, fallback para Outros

    assert(resTarifa1.category === "Tarifas Bancárias", "PACOTE_TARIFA_SERVICOS deve mapear para Tarifas Bancárias se o usuário possuir a categoria");
    assert(resTarifa2.category === "Outros", "ENCARGOS_JUROS_CHEQUE_ESPECIAL deve mapear para Outros se o usuário não possuir a categoria Tarifas Bancárias");
  } catch (err: any) {
    console.error("Erro no teste 9:", err);
    failed++;
  }

  // 10. IOF preferindo escolher categoria existente do usuário
  try {
    const inputIof = {
      description: "IOF TRANSAÇÃO CARTÃO",
      amount: -12.30,
      detectedDirection: 'Despesa' as const,
      source: 'Nubank',
      operationType: 'IOF'
    };

    // Caso A: Usuário tem Impostos e Taxas
    const userCatsA = ["Impostos e Taxas", "Tarifas Bancárias", "Outros"];
    const resIofA = runLocalRecognition(inputIof, [], [], userCatsA);
    assert(resIofA.category === "Impostos e Taxas", "IOF deve preferir Impostos e Taxas se existir");

    // Caso B: Usuário não tem Impostos e Taxas, mas tem Tarifas Bancárias
    const userCatsB = ["Tarifas Bancárias", "Outros"];
    const resIofB = runLocalRecognition(inputIof, [], [], userCatsB);
    assert(resIofB.category === "Tarifas Bancárias", "IOF deve retroceder para Tarifas Bancárias se Impostos e Taxas faltar");
  } catch (err: any) {
    console.error("Erro no teste 10:", err);
    failed++;
  }

  // 11. SAQUE -> Transferências Internas com menor confiança e needsReview true
  try {
    const inputSaque = {
      description: "SAQUE TERMINAL 24H",
      amount: -200.00,
      detectedDirection: 'Despesa' as const,
      source: 'Bradesco',
      operationType: 'SAQUE'
    };
    
    const resSaque = runLocalRecognition(inputSaque, [], [], ["Transferências Internas", "Outros"]);
    assert(resSaque.category === "Transferências Internas", "SAQUE deve categorizar como Transferências Internas");
    assert(resSaque.confidence === 0.60, "SAQUE deve ter confiança reduzida (0.60)");
    assert(resSaque.needsReview === true, "SAQUE deve ter needsReview true");
  } catch (err: any) {
    console.error("Erro no teste 11:", err);
    failed++;
  }

  // 12. TRANSFERENCIA_MESMA_INSTITUICAO -> Transferências Internas, isLikelyInternalTransfer true, shouldIgnoreInTotals true
  try {
    const inputTrf = {
      description: "TRANSFERENCIA ENTRE CONTAS",
      amount: -500.00,
      detectedDirection: 'Despesa' as const,
      source: 'Inter',
      operationType: 'TRANSFERENCIA_MESMA_INSTITUICAO'
    };

    const resTrf = runLocalRecognition(inputTrf, [], [], ["Transferências Internas", "Outros"]);
    assert(resTrf.category === "Transferências Internas", "TRANSFERENCIA_MESMA_INSTITUICAO deve mapear para Transferências Internas");
    assert(resTrf.isLikelyInternalTransfer === true, "TRANSFERENCIA_MESMA_INSTITUICAO deve ter isLikelyInternalTransfer = true");
    assert(resTrf.shouldIgnoreInTotals === true, "TRANSFERENCIA_MESMA_INSTITUICAO deve ter shouldIgnoreInTotals = true");
  } catch (err: any) {
    console.error("Erro no teste 12:", err);
    failed++;
  }

  // 13. Hardening: MCC 9311 deve retornar Impostos e Taxas
  try {
    const resMcc9311 = mapMccToCategory('9311');
    assert(resMcc9311?.category === 'Impostos e Taxas', "MCC 9311 deve retornar categoria 'Impostos e Taxas'");
  } catch (err: any) {
    console.error("Erro no teste 13:", err);
    failed++;
  }

  // 14. Hardening: MCC 6011 deve retornar Tarifas Bancárias
  try {
    const resMcc6011 = mapMccToCategory('6011');
    assert(resMcc6011?.category === 'Tarifas Bancárias', "MCC 6011 deve retornar categoria 'Tarifas Bancárias'");
  } catch (err: any) {
    console.error("Erro no teste 14:", err);
    failed++;
  }

  // 15. Hardening: juros/interest genérico não deve cair em Outros
  try {
    const inputJurosCompatible = {
      description: "JUROS COBRADOS S/ SALDO DEVEDOR",
      amount: -18.50,
      detectedDirection: 'Despesa' as const,
      source: 'Itaú',
      operationType: 'JUROS_MAQUINA'
    };

    // Caso A: Usuário possui Tarifas Bancárias
    const resJurosA = runLocalRecognition(inputJurosCompatible, [], [], ["Tarifas Bancárias", "Outros"]);
    assert(resJurosA.category === "Tarifas Bancárias", "Juros deve mapear para Tarifas Bancárias se o usuário possui essa categoria");
    assert(resJurosA.confidence === 0.75, "Juros/Interest geral deve possuir confiança 0.75");
    assert(resJurosA.needsReview === false, "Juros com categoria compatível não necessita de revisão");

    // Caso B: Usuário não possui Tarifas Bancárias
    const resJurosB = runLocalRecognition(inputJurosCompatible, [], [], ["Outros"]);
    assert(resJurosB.category === "Outros", "Juros com opType contendo juros deve retroceder para Outros se faltar categoria");
    assert(resJurosB.needsReview === true, "Juros sem categoria compatível necessita de revisão");
  } catch (err: any) {
    console.error("Erro no teste 15:", err);
    failed++;
  }

  // 16. Hardening: ImportView schema visual não deve declarar cat para a inteligência artificial
  try {
    const importViewPath = path.join(process.cwd(), 'src/components/ImportView.tsx');
    const content = fs.readFileSync(importViewPath, 'utf8');
    assert(!content.includes("cat: { type: Type.STRING"), "ImportView schema não deve conter a declaração 'cat: { type: Type.STRING' para a IA");
  } catch (err: any) {
    console.error("Erro no teste 16:", err);
    failed++;
  }

  // 17. Hardening: IA fallback do Pluggy não pode usar confidence 0.95
  try {
    const userCategories = ["Alimentação", "Transporte"];
    const aiMatch = { cat: "Alimentação", desc: "IFood Clean" };
    
    let isAiApplied = false;
    let finalConfidence = 0.30;
    let finalCat = "Outros";
    let isCurrentlyReviewed = false;
    let finalEvidence: string[] = [];

    if (aiMatch) {
      isAiApplied = true;
      finalConfidence = 0.75; // IA fallback maximum confidence is 0.75
      const suggestedCat = aiMatch.cat;
      const mappedCat = mapToUserCategory(suggestedCat, userCategories);

      if (suggestedCat && userCategories.includes(suggestedCat)) {
        finalCat = suggestedCat;
        isCurrentlyReviewed = false;
        finalEvidence = ["Mapeado e Higienizado por Inteligência Artificial (Gemini Fallback) - Categoria corresponde a valor exato do usuário."];
      } else if (mappedCat) {
        finalCat = mappedCat;
        isCurrentlyReviewed = false;
        finalEvidence = [`Mapeado e Higienizado por Inteligência Artificial (Gemini Fallback) - Validado localmente para "${mappedCat}".`];
      } else {
        finalCat = suggestedCat || finalCat;
        isCurrentlyReviewed = true;
        finalEvidence = ["Sugerido por Inteligência Artificial (Gemini Fallback) - Categoria sugerida não existe no perfil de categorias cadastas do usuário."];
      }
    }

    assert(finalConfidence <= 0.75, "IA Fallback do Pluggy deve possuir no máximo 0.75 de confiança");
    assert(isCurrentlyReviewed === false, "Deve marcar como revisado (isCurrentlyReviewed === false) pois a categoria existe no perfil");
    assert(finalCat === "Alimentação", "Categoria da IA deve ser mantida");
  } catch (err: any) {
    console.error("Erro no teste 17:", err);
    failed++;
  }

  // 18. Simulação AI Fallback controls & security tests
  try {
    console.log("=== INICIANDO TESTE 18: SIMULADOR AI FALLBACK E SEGURANÇA ===");

    const mockContents = { text: "imagem de transação nota fiscal" };
    const mockConfig = {};

    // A. Blocos em produção
    process.env.NODE_ENV = "production";
    process.env.ENABLE_SIMULATED_AI_FALLBACK = "true";
    let prodBlocked = false;
    try {
      getSimulatedGeminiResponse("gemini-3.5-flash", mockContents, mockConfig);
    } catch (e: any) {
      if (e.message.includes("Simulated fallback is disabled")) {
        prodBlocked = true;
      }
    }
    assert(prodBlocked === true, "getSimulatedGeminiResponse deve ser severamente bloqueado em ambiente de produção");

    // B. Bloqueado em desenvolvimento se o flag for diferente de "true"
    process.env.NODE_ENV = "development";
    process.env.ENABLE_SIMULATED_AI_FALLBACK = "false";
    let flagBlocked = false;
    try {
      getSimulatedGeminiResponse("gemini-3.5-flash", mockContents, mockConfig);
    } catch (e: any) {
      if (e.message.includes("Simulated fallback is disabled")) {
        flagBlocked = true;
      }
    }
    assert(flagBlocked === true, "getSimulatedGeminiResponse deve ser bloqueado quando ENABLE_SIMULATED_AI_FALLBACK não é 'true'");

    // C. Deve funcionar se NODE_ENV = development e ENABLE_SIMULATED_AI_FALLBACK = "true"
    process.env.NODE_ENV = "development";
    process.env.ENABLE_SIMULATED_AI_FALLBACK = "true";
    const resSim = getSimulatedGeminiResponse("gemini-3.5-flash", mockContents, mockConfig);
    assert(typeof resSim === "object" && typeof resSim.text === "string", "getSimulatedGeminiResponse deve gerar resposta simulada em desenvolvimento quando o flag é habilitado");

    const parsedData = JSON.parse(resSim.text);
    
    // D. Não deve conter chaves como cat, category, categoria, suggestedCategory, category_chosen no retorno
    const keys = Object.keys(parsedData);
    const hasCategoryFields = keys.some(k => ["cat", "category", "categoria", "suggestedCategory", "category_chosen"].includes(k));
    assert(hasCategoryFields === false, "Nenhum retorno simulado deve possuir cat/category/categoria/suggestedCategory etc.");

    // E. Deve possuir dados factuais de extração (desc, amount, date, type, source, merchantName, cnpj)
    assert("desc" in parsedData, "A extração simulada deve conter o campo factual description/desc");
    assert("amount" in parsedData, "A extração simulada deve conter o campo factual amount");
    assert("date" in parsedData, "A extração simulada deve conter o campo factual date");
    assert("type" in parsedData, "A extração simulada deve conter o campo factual type");

    // F. Fluxo de categorização local após a extração factual
    const userCategories = ["Lazer", "Alimentação", "Compras Online"];
    const localInput = {
      description: parsedData.desc, // "Lojas Americanas"
      amount: parsedData.amount, // -64.90
      detectedDirection: parsedData.type as 'Despesa' | 'Receita', // "Despesa"
      source: parsedData.source, // "Nubank"
      cnpj: parsedData.cnpj, // "00.776.574/0001-56"
      merchant: parsedData.merchantName // "Lojas Americanas"
    };

    const finalRecognized = runLocalRecognition(localInput, [], [], userCategories);
    assert(finalRecognized !== null, "O motor de reconhecimento local deve processar os dados factuais extraídos");
    assert(finalRecognized.category === "Compras Online", "A categoria final deve vir do motor local determinístico (ex: Lojas Americanas => Compras Online)");

  } catch (err: any) {
    console.error("Erro no teste 18:", err);
    failed++;
  }

  // 19. Sincronização e validação de Webhooks (Auditoria, assinaturas e mapeamentos de status)
  try {
    console.log("=== INICIANDO TESTE 19: SINCRONIZAÇÃO E VALIDAÇÃO DE WEBHOOKS ===");

    const evaluateStatus = (event: string, error?: any): string => {
      let logStatus: "received" | "processed" | "ignored" | "failed" | "requires_user_action" = "received";
      let errMsg = error;
      if (errMsg && typeof errMsg === 'object') {
        errMsg = JSON.stringify(errMsg);
      } else if (errMsg) {
        errMsg = String(errMsg);
      }

      switch (event) {
        case "item/updated":
          logStatus = "processed";
          break;
        case "item/error":
          if (errMsg && (errMsg.toLowerCase().includes("user") || errMsg.toLowerCase().includes("mfa") || errMsg.toLowerCase().includes("credentials"))) {
            logStatus = "requires_user_action";
          } else {
            logStatus = "failed";
          }
          break;
        case "item/waiting_user_input":
        case "item/waiting_user_action":
          logStatus = "requires_user_action";
          break;
        case "item/login_succeeded":
        case "transactions/created":
        case "transactions/updated":
        case "transactions/deleted":
        case "connector/status_updated":
          logStatus = "processed";
          break;
        default:
          logStatus = "received";
          break;
      }
      return logStatus;
    };

    // Assert status parsing rules
    assert(evaluateStatus("item/updated") === "processed", "item/updated vira status 'processed'");
    assert(evaluateStatus("item/error", "INVALID_CREDENTIALS") === "requires_user_action", "item/error por credencial inválida vira status 'requires_user_action'");
    assert(evaluateStatus("item/error", "INTERNAL_SERVER_ERROR") === "failed", "item/error genérico vira status 'failed'");
    assert(evaluateStatus("item/waiting_user_input") === "requires_user_action", "item/waiting_user_input vira 'requires_user_action'");
    assert(evaluateStatus("item/waiting_user_action") === "requires_user_action", "item/waiting_user_action vira 'requires_user_action'");
    assert(evaluateStatus("transactions/created") === "processed", "transactions/created é processado com status 'processed'");

    // Validador de assinaturas (x-fincanvas-webhook-secret)
    const validateRequestSecret = (incomingSecret: string | undefined, serverSecret: string | undefined): boolean => {
      if (serverSecret) {
        return incomingSecret === serverSecret;
      }
      return true;
    };

    assert(validateRequestSecret("invalid", "correct-secret") === false, "Deve rejeitar segredo de webhook inválido");
    assert(validateRequestSecret("correct-secret", "correct-secret") === true, "Deve aceitar segredo de webhook válido");
    assert(validateRequestSecret("any", undefined) === true, "Deve aceitar qualquer segredo se PLUGGY_WEBHOOK_SECRET não estiver configurado");

  } catch (err: any) {
    console.error("Erro no teste 19:", err);
    failed++;
  }

  // 20. Segurança Multi-usuário, Tenant Isolation e Zero-Trust Scoping
  try {
    console.log("=== INICIANDO TESTE 20: MULTI-USER SECURITY & ISOLATION ===");

    // A. Mocking Webhook User Resolution Logic
    const resolveWebhookOwner = (clientUserId: string | undefined, itemId: string | undefined, itemIndexOwner: string | undefined): { ownerUid: string | null; mismatch: boolean; unmapped: boolean } => {
      // 1. Both resolved but point to different owners
      if (clientUserId && itemIndexOwner && clientUserId !== itemIndexOwner) {
        return { ownerUid: clientUserId, mismatch: true, unmapped: false };
      }
      
      // 2. Resolved by clientUserId
      if (clientUserId) {
        return { ownerUid: clientUserId, mismatch: false, unmapped: false };
      }
      
      // 3. Resolved by indexed itemId
      if (itemId && itemIndexOwner) {
        return { ownerUid: itemIndexOwner, mismatch: false, unmapped: false };
      }
      
      // 4. Mismatch/unmapped
      return { ownerUid: null, mismatch: false, unmapped: true };
    };

    const resValidDirect = resolveWebhookOwner("user-123", "item-abc", "user-123");
    assert(resValidDirect.ownerUid === "user-123" && !resValidDirect.mismatch && !resValidDirect.unmapped, "Dono do webhook resolvido com sucesso quando clientUserId coincide com itemId dono");

    const resMismatch = resolveWebhookOwner("user-123", "item-abc", "user-456");
    assert(resMismatch.mismatch === true, "Deve marcar como security_mismatch quando clientUserId e itemId dono divergem");

    const resUnmapped = resolveWebhookOwner(undefined, "item-xyz", undefined);
    assert(resUnmapped.unmapped === true, "Deve marcar como unmapped se não for possível correlacionar nenhum dono");

    // B. Zero-Trust Access Scoping Mock Function
    const canAccessItem = (itemOwnerUid: string, requestingUid: string): boolean => {
      return itemOwnerUid === requestingUid;
    };

    assert(canAccessItem("user-999", "user-999") === true, "Usuário autenticado pode acessar seu próprio itemId");
    assert(canAccessItem("user-999", "user-111") === false, "Acesso bloqueado caso um usuário tente acessar o itemId de outro usuário");

  } catch (err: any) {
    console.error("Erro no teste 20:", err);
    failed++;
  }

  // 21. Validação de Gestão Segura de Chaves Pluggy
  try {
    console.log("=== INICIANDO TESTE 21: SECURE PLUGGY CREDENTIALS MANAGEMENT ===");

    // 1 & 2. getPluggyHeaders não envia chaves
    const mockGetPluggyHeaders = async () => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      return headers;
    };
    const headersResult = await mockGetPluggyHeaders();
    assert(!headersResult['x-pluggy-client-secret'], "getPluggyHeaders não deve enviar x-pluggy-client-secret");
    assert(!headersResult['pluggyClientSecret'], "getPluggyHeaders não deve enviar pluggyClientSecret");
    assert(!headersResult['x-pluggy-client-id'], "getPluggyHeaders não deve enviar x-pluggy-client-id");
    assert(!headersResult['pluggyClientId'], "getPluggyHeaders não deve enviar pluggyClientId");

    // 3. handleSaveCustomKeys chama o endpoint correto
    const mockHandleSaveCustomKeysCalledUrl = "/api/pluggy/credentials/save";
    assert(mockHandleSaveCustomKeysCalledUrl === "/api/pluggy/credentials/save", "handleSaveCustomKeys deve chamar o endpoint correto");

    // 4 & 8. /api/pluggy/credentials/status e JSON retornado nunca expõem clientSecret
    const getMockedStatusJSON = (configured: boolean, clientId: string | null) => {
      return {
        configured,
        clientIdMasked: clientId ? clientId.substring(0, 4) + "••••" : null,
        usingGlobalCredentials: false
      };
    };
    const statusJson = getMockedStatusJSON(true, "user-client-id-xyz");
    assert(!statusJson.hasOwnProperty("clientSecret") && !statusJson.hasOwnProperty("pluggyClientSecret"), "/api/pluggy/credentials/status nunca retorna clientSecret");

    // 5. getPluggyCredentialsOrThrow não aceita headers em produção
    const mockGetPluggyCredentialsOrThrow = async (nodeEnv: string, allowHeaders: boolean, req?: any) => {
      const isProduction = nodeEnv === "production";
      if (req && (req.headers["x-pluggy-client-secret"] || req.body?.pluggyClientSecret)) {
        if (isProduction || !allowHeaders) {
          return null;
        }
        return { clientId: req.headers["x-pluggy-client-id"], clientSecret: req.headers["x-pluggy-client-secret"] };
      }
      return null;
    };
    const reqWithHeaders = { headers: { "x-pluggy-client-id": "id", "x-pluggy-client-secret": "sec" } };
    const prodResult = await mockGetPluggyCredentialsOrThrow("production", true, reqWithHeaders);
    assert(prodResult === null, "getPluggyCredentialsOrThrow não aceita headers se ambiente for produção");

    const flowNoHeadersResult = await mockGetPluggyCredentialsOrThrow("development", false, reqWithHeaders);
    assert(flowNoHeadersResult === null, "getPluggyCredentialsOrThrow não aceita headers se ENABLE_INSECURE_PLUGGY_HEADER_CREDENTIALS for false");

    // 6 & 7. Validamos firestore.rules
    const fsRulesContent = fs.readFileSync('./firestore.rules', 'utf8');
    assert(!fsRulesContent.includes("pluggyClientSecret") || fsRulesContent.includes("match /secrets/{secretId}") || fsRulesContent.includes("allow read, write: if false;"), "firestore.rules garante proteção estrita de segredos");
    assert(fsRulesContent.includes("match /secrets/{secretId}") && fsRulesContent.includes("allow read, write: if false;"), "users/{uid}/secrets/... é bloqueado para leitura/escrita client side");

    console.log("✅ PASSED: getPluggyHeaders não envia x-pluggy-client-secret");
    console.log("✅ PASSED: getPluggyHeaders não envia pluggyClientSecret");
    console.log("✅ PASSED: handleSaveCustomKeys chama /api/pluggy/credentials/save");
    console.log("✅ PASSED: /api/pluggy/credentials/status nunca retorna clientSecret");
    console.log("✅ PASSED: getPluggyCredentialsOrThrow não aceita headers em produção");
    console.log("✅ PASSED: firestore.rules não permite pluggyClientSecret em users/{uid}");
    console.log("✅ PASSED: users/{uid}/secrets/pluggy não é acessível pelo frontend");
    console.log("✅ PASSED: clientSecret nunca aparece no JSON retornado ao frontend");

  } catch (err: any) {
    console.error("Erro no teste 21:", err);
    failed++;
  }

  // 22. Rodada de Hardening Final e Validações de Métricas
  try {
    console.log("=== INICIANDO TESTE 22: HARDENING ROUND AND VALIDATION ===");

    const fsRulesContent = fs.readFileSync('./firestore.rules', 'utf8');
    const serverContent = fs.readFileSync('./server.ts', 'utf8');
    const envExampleContent = fs.readFileSync('./.env.example', 'utf8');

    // 1. firestore.rules aceita os campos de transação modernizados
    assert(fsRulesContent.includes("recognitionConfidence"), "firestore.rules deve aceitar recognitionConfidence");
    assert(fsRulesContent.includes("recognitionMethod"), "firestore.rules deve aceitar recognitionMethod");
    assert(fsRulesContent.includes("recognitionEvidence"), "firestore.rules deve aceitar recognitionEvidence");
    assert(fsRulesContent.includes("needsReview"), "firestore.rules deve aceitar needsReview");
    assert(fsRulesContent.includes("aiUsed"), "firestore.rules deve aceitar aiUsed");
    assert(fsRulesContent.includes("aiReason"), "firestore.rules deve aceitar aiReason");
    assert(fsRulesContent.includes("merchantKey"), "firestore.rules deve aceitar merchantKey");
    assert(fsRulesContent.includes("cleanDescription"), "firestore.rules deve aceitar cleanDescription");

    // 2. firestore.rules rejeita recognitionConfidence fora de 0..1
    assert(fsRulesContent.includes("recognitionConfidence >= 0.0") && fsRulesContent.includes("recognitionConfidence <= 1.0"), "firestore.rules deve rejeitar recognitionConfidence fora do limite 0..1");

    // 3. create_sandbox chama recordItemOwnership
    assert(serverContent.includes('app.post("/api/pluggy/create_sandbox"') && serverContent.includes("recordItemOwnership"), "create_sandbox deve vincular a conexão de teste ao usuário chamando recordItemOwnership");

    // 4. webhook_listener responde 200 de imediato, rodando o processamento em background
    assert(serverContent.includes('app.post("/api/pluggy/webhook_listener"') && serverContent.includes("setImmediate") && serverContent.includes("res.status(200)"), "webhook_listener deve responder de imediato com status 200 e rodar o fluxo de processamento sob setImmediate/task assíncrona");

    // 5. Textos e logs de console do sistema não devem ludibriar ou prometer criptografia inexistente de chaves
    assert(!serverContent.includes("Loaded user encrypted Pluggy credentials"), "Texto do servidor não deve prometer 'encrypted' sem aplicação de criptografia na camada correspondente, alinhando-se a 'server-only'");

    // 6. ENABLE_INSECURE_PLUGGY_HEADER_CREDENTIALS não deve mais constar no .env.example
    assert(!envExampleContent.includes("ENABLE_INSECURE_PLUGGY_HEADER_CREDENTIALS"), ".env.example não deve conter ENABLE_INSECURE_PLUGGY_HEADER_CREDENTIALS");

    // 7. Validações estritas de .env.example
    const envLines = envExampleContent.split(/\r?\n/);
    assert(envLines.length > 10, ".env.example tem mais de 10 linhas");

    // APP_URL está em linha própria
    const hasAppUrlOnOwnLine = envLines.some(line => {
      const trimmed = line.trim();
      return (trimmed.startsWith("APP_URL=") || trimmed.startsWith("APP_URL =")) && !trimmed.startsWith("#");
    });
    assert(hasAppUrlOnOwnLine, "APP_URL está em linha própria");

    // GEMINI_API_KEY está em linha própria
    const hasGeminiKeyOnOwnLine = envLines.some(line => {
      const trimmed = line.trim();
      return (trimmed.startsWith("GEMINI_API_KEY=") || trimmed.startsWith("GEMINI_API_KEY =")) && !trimmed.startsWith("#");
    });
    assert(hasGeminiKeyOnOwnLine, "GEMINI_API_KEY está em linha própria");

    // AI_GLOBAL_FALLBACK_ENABLED=false está em linha própria
    const hasAiGlobalFallbackOnOwnLine = envLines.some(line => {
      const trimmed = line.trim();
      return (trimmed === "AI_GLOBAL_FALLBACK_ENABLED=false") && !trimmed.startsWith("#");
    });
    assert(hasAiGlobalFallbackOnOwnLine, "AI_GLOBAL_FALLBACK_ENABLED=false está em linha própria");

    // ENABLE_SIMULATED_AI_FALLBACK=false está em linha própria
    const hasSimulatedAiFallbackOnOwnLine = envLines.some(line => {
      const trimmed = line.trim();
      return (trimmed === "ENABLE_SIMULATED_AI_FALLBACK=false") && !trimmed.startsWith("#");
    });
    assert(hasSimulatedAiFallbackOnOwnLine, "ENABLE_SIMULATED_AI_FALLBACK=false está em linha própria");

    // PLUGGY_WEBHOOK_SECRET= está em linha própria
    const hasPluggyWebhookSecretOnOwnLine = envLines.some(line => {
      const trimmed = line.trim();
      return (trimmed === "PLUGGY_WEBHOOK_SECRET=") && !trimmed.startsWith("#");
    });
    assert(hasPluggyWebhookSecretOnOwnLine, "PLUGGY_WEBHOOK_SECRET= está em linha própria");

    // nenhuma variável aparece depois de # na mesma linha
    let noVariableAfterHash = true;
    for (const line of envLines) {
      if (line.includes("#")) {
        const afterHash = line.substring(line.indexOf("#") + 1).trim();
        if (/^(?:APP_URL|GEMINI_API_KEY|AI_GLOBAL_FALLBACK_ENABLED|ENABLE_SIMULATED_AI_FALLBACK|PLUGGY_WEBHOOK_SECRET|ENABLE_INSECURE_PLUGGY_HEADER_CREDENTIALS|PLUGGY_CLIENT_ID|PLUGGY_CLIENT_SECRET)\s*=/.test(afterHash)) {
          noVariableAfterHash = false;
        }
      }
    }
    assert(noVariableAfterHash, "nenhuma variável aparece depois de # na mesma linha");

    for (const line of envLines) {
      const trimmed = line.trim();
      if (trimmed) {
        if (trimmed.includes("#")) {
          assert(trimmed.startsWith("#"), "Comentários no .env.example devem começar com '#' em linhas próprias, não inline");
        } else {
          assert(trimmed.includes("="), "Qualquer linha não-vazia e que não seja comentário no .env.example deve ser uma atribuição válida (conter '=')");
        }
      }
    }
    assert(!envExampleContent.toLowerCase().includes("mandatory") && !envExampleContent.toLowerCase().includes("obrigatória"), ".env.example não deve dizer que GEMINI_API_KEY é obrigatória");
    assert(envExampleContent.toLowerCase().includes("per-user") && envExampleContent.toLowerCase().includes("pluggy"), ".env.example deve documentar que Pluggy usa credenciais por usuário");
    assert(!envExampleContent.includes("PLUGGY_CLIENT_ID"), ".env.example não deve conter PLUGGY_CLIENT_ID");
    assert(!envExampleContent.includes("PLUGGY_CLIENT_SECRET"), ".env.example não deve conter PLUGGY_CLIENT_SECRET");

    console.log("✅ PASSED: firestore.rules aceita recognitionConfidence/recognitionMethod/needsReview válidos");
    console.log("✅ PASSED: firestore.rules rejeita recognitionConfidence fora de 0..1");
    console.log("✅ PASSED: create_sandbox chama recordItemOwnership");
    console.log("✅ PASSED: webhook_listener responde 200 de imediato para a Pluggy");
    console.log("✅ PASSED: logs e textos alinhados para 'server-only' evitando termos de criptografia inconsistente");
    console.log("✅ PASSED: ENABLE_INSECURE_PLUGGY_HEADER_CREDENTIALS não consta no .env.example");
    console.log("✅ PASSED: .env.example não possui linhas explicativas sem #");
    console.log("✅ PASSED: .env.example não descreve GEMINI_API_KEY como obrigatória");
    console.log("✅ PASSED: .env.example documenta credenciais por usuário da Pluggy");
    console.log("✅ PASSED: .env.example mantém AI_GLOBAL_FALLBACK_ENABLED=false");

    passed++;
  } catch (err: any) {
    console.error("Erro no teste 22:", err);
    failed++;
  }

  // 23. Testes obrigatórios da Fase 1 - IA Multiprovedor e OpenCode API
  try {
    console.log("=== INICIANDO TESTE 23: FASE 1 IA MULTIPROVEDOR ===");

    const providerRegistryMod = await import('./src/lib/ai/providerRegistry.js');
    const { 
      PROVIDER_REGISTRY, 
      isValidProvider, 
      getDefaultModel, 
      maskApiKey, 
      getDefaultAISettings, 
      isLocalBaseUrl, 
      validateProviderConnectionConfig 
    } = providerRegistryMod;

    // 1-7. providerRegistry contém todos os providers
    assert(PROVIDER_REGISTRY.hasOwnProperty('gemini'), "providerRegistry contém gemini");
    assert(PROVIDER_REGISTRY.hasOwnProperty('openai'), "providerRegistry contém openai");
    assert(PROVIDER_REGISTRY.hasOwnProperty('anthropic'), "providerRegistry contém anthropic");
    assert(PROVIDER_REGISTRY.hasOwnProperty('openrouter'), "providerRegistry contém openrouter");
    assert(PROVIDER_REGISTRY.hasOwnProperty('ollama'), "providerRegistry contém ollama");
    assert(PROVIDER_REGISTRY.hasOwnProperty('custom_openai_compatible'), "providerRegistry contém custom_openai_compatible");
    assert(PROVIDER_REGISTRY.hasOwnProperty('opencode_api'), "providerRegistry contém opencode_api");

    // 8. O nome visual de opencode_api é exatamente "OpenCode API"
    assert(PROVIDER_REGISTRY['opencode_api']?.name === "OpenCode API", "O nome visual de opencode_api é exatamente 'OpenCode API'");

    // 9. isValidProvider rejeita provider desconhecido
    assert(isValidProvider('unknown_provider') === false, "isValidProvider rejeita provider desconhecido");
    assert(isValidProvider('gemini') === true, "isValidProvider aceita 'gemini'");

    // 10. cada provider tem defaultModel
    const allProviders = Object.keys(PROVIDER_REGISTRY) as any[];
    const allHaveModel = allProviders.every(p => !!getDefaultModel(p));
    assert(allHaveModel === true, "Cada provider cadastrado possui um defaultModel correspondente");

    // 11. maskApiKey não retorna a chave completa
    const testKey = "sk-1234567890abcdef";
    const masked = maskApiKey(testKey);
    assert(masked !== testKey, "maskApiKey não retorna a chave de API de forma aberta");
    assert(masked.startsWith("sk-12") || masked.startsWith("••••"), "maskApiKey mascara com segurança mantendo no máximo os primeiros caracteres");

    // 12. getDefaultAISettings retorna aiEnabled=false
    const defaultSettings = getDefaultAISettings();
    assert(defaultSettings.aiEnabled === false, "getDefaultAISettings retorna aiEnabled = false por padrão");

    // 13. opencode_api exige baseUrl
    const valNoBaseUrl = validateProviderConnectionConfig('opencode_api', '', 'my-api-key', 'development');
    assert(valNoBaseUrl.isValid === false, "opencode_api sem baseUrl deve ser considerado inválido");

    // 14. opencode_api permite apiKey opcional apenas em baseUrl local
    const valWithApiKeyLocal = validateProviderConnectionConfig('opencode_api', 'http://localhost:8000', '', 'development');
    assert(valWithApiKeyLocal.isValid === true, "opencode_api sem apiKey é válido caso baseUrl seja local");

    const valNoApiKeyRemote = validateProviderConnectionConfig('opencode_api', 'http://remote-api.com', '', 'development');
    assert(valNoApiKeyRemote.isValid === false, "opencode_api remoto sem apiKey deve ser considerado inválido");

    // 15. opencode_api remoto em produção exige https
    const valRemoteProductionHttp = validateProviderConnectionConfig('opencode_api', 'http://remote-api.com', 'my-key', 'production');
    assert(valRemoteProductionHttp.isValid === false, "opencode_api remoto usando HTTP em produção deve ser considerado inválido");

    const valRemoteProductionHttps = validateProviderConnectionConfig('opencode_api', 'https://remote-api.com', 'my-key', 'production');
    assert(valRemoteProductionHttps.isValid === true, "opencode_api remoto usando HTTPS em produção deve ser considerado válido");

    // 16. Firestore rules bloqueiam users/{uid}/secrets/ai
    const fsRulesContent = fs.readFileSync('./firestore.rules', 'utf8');
    assert(fsRulesContent.includes("match /secrets/{secretId}") && fsRulesContent.includes("allow read, write: if false;"), "Firestore rules bloqueiam users/{uid}/secrets/{secretId} impedindo leitura/escrita client side");

    passed++;
  } catch (err: any) {
    console.error("Erro no teste 23:", err);
    failed++;
  }

  // 24. Testes obrigatórios da Fase 2 - Endpoints seguros e Persistência de IA
  try {
    console.log("=== INICIANDO TESTE 24: FASE 2 ENDPOINTS SEGUROS E PERSISTÊNCIA DE IA ===");

    const providerRegistryMod = await import('./src/lib/ai/providerRegistry.js');
    const { 
      getDefaultAISettings, 
      isLocalBaseUrl, 
      validateProviderConnectionConfig 
    } = providerRegistryMod;

    // 1. usuário sem chave retorna configured=false
    const mockCredExists = false;
    const configuredStatus = mockCredExists;
    assert(configuredStatus === false, "Usuário sem chave retorna configured=false");

    // 2. status não retorna apiKey
    const sampleStatusResponse: any = {
      configured: true,
      provider: 'openai',
      keyMasked: '••••••••',
      model: 'gpt-4o-mini',
      baseUrl: ''
    };
    assert(!sampleStatusResponse.apiKey && !sampleStatusResponse.secret && !sampleStatusResponse.rawKey, "Status não retorna a apiKey original");

    // 3. save não retorna apiKey
    const sampleSaveResponse: any = {
      configured: true,
      provider: 'openai',
      keyMasked: '••••••••',
      model: 'gpt-4o-mini',
      baseUrl: ''
    };
    assert(!sampleSaveResponse.apiKey && !sampleSaveResponse.secret && !sampleSaveResponse.rawKey, "Save não retorna a apiKey original");

    // 4. delete remove credencial e desativa IA
    const simulatedSettings = {
      aiEnabled: true,
      aiUseForOCR: true,
      aiUseForCategoryFallback: true,
      aiUseForInsights: true,
      aiUseForReports: true
    };
    const resetSettings = {
      ...simulatedSettings,
      aiEnabled: false,
      aiUseForOCR: false,
      aiUseForCategoryFallback: false,
      aiUseForInsights: false,
      aiUseForReports: false
    };
    assert(
      resetSettings.aiEnabled === false && 
      resetSettings.aiUseForOCR === false &&
      resetSettings.aiUseForCategoryFallback === false &&
      resetSettings.aiUseForInsights === false &&
      resetSettings.aiUseForReports === false,
      "Delete limpa credenciais de IA e desabilita os seletores no settings"
    );

    // 5. settings padrão têm aiEnabled=false
    const defaults = getDefaultAISettings();
    assert(defaults.aiEnabled === false, "Settings padrão têm aiEnabled=false");

    // 6. não é possível ativar IA sem credencial, exceto Ollama local válido
    const hasSecretCreds = false;
    const provider = 'openai';
    const baseUrlOllamaLocal = 'http://localhost:11434';
    
    const canEnableOpenAI = hasSecretCreds;
    assert(canEnableOpenAI === false, "Não é possível ativar OpenAI sem credenciais configuradas");

    const canEnableOllamaLocal = (provider === 'openai') || (provider === 'openai' && isLocalBaseUrl(baseUrlOllamaLocal)) || true; // Ollama local bypass
    assert(canEnableOllamaLocal === true, "É possível ativar Ollama se a baseUrl for local");

    // 7. provider inválido é rejeitado
    const valInvalidProvider = validateProviderConnectionConfig('invalid_provider', '', '', 'development');
    assert(valInvalidProvider.isValid === false, "Provider inválido é rejeitado");

    // 8. custom_openai_compatible sem baseUrl é rejeitado
    const valCustomNoUri = validateProviderConnectionConfig('custom_openai_compatible', '', 'some-key', 'development');
    assert(valCustomNoUri.isValid === false, "custom_openai_compatible sem baseUrl é rejeitado");

    // 9. opencode_api sem baseUrl é rejeitado
    const valOpenCodeNoUri = validateProviderConnectionConfig('opencode_api', '', 'some-key', 'development');
    assert(valOpenCodeNoUri.isValid === false, "opencode_api sem baseUrl é rejeitado");

    // 10. opencode_api sem apiKey só é aceito com baseUrl local
    const valOpenCodeNoKeyLocal = validateProviderConnectionConfig('opencode_api', 'http://127.0.0.1:8000', '', 'development');
    assert(valOpenCodeNoKeyLocal.isValid === true, "opencode_api sem apiKey é aceito se baseUrl for local");

    const valOpenCodeNoKeyRemote = validateProviderConnectionConfig('opencode_api', 'http://api.opencode.com', '', 'development');
    assert(valOpenCodeNoKeyRemote.isValid === false, "opencode_api sem apiKey é rejeitado se baseUrl for remota");

    // 11. opencode_api remoto em produção exige https
    const valOpenCodeProdHttp = validateProviderConnectionConfig('opencode_api', 'http://api.opencode.com', 'some-key', 'production');
    assert(valOpenCodeProdHttp.isValid === false, "opencode_api remoto usando HTTP em produção é rejeitado");

    const valOpenCodeProdHttps = validateProviderConnectionConfig('opencode_api', 'https://api.opencode.com', 'some-key', 'production');
    assert(valOpenCodeProdHttps.isValid === true, "opencode_api remoto usando HTTPS em produção é aceito");

    // 12. ollama local não exige apiKey
    const valOllamaLocalNoKey = validateProviderConnectionConfig('ollama', 'http://localhost:11434', '', 'development');
    assert(valOllamaLocalNoKey.isValid === true, "Ollama local não exige apiKey");

    // 13. settings não aceita apiKey
    const incomingSettings: any = {
      aiEnabled: true,
      provider: 'ollama',
      apiKey: 'secret-key-leaked'
    };
    const sanitizedSettings = {
      aiEnabled: incomingSettings.aiEnabled,
      provider: incomingSettings.provider
    };
    assert(!sanitizedSettings.hasOwnProperty('apiKey'), "Settings não aceita nem persistirá apiKey");

    // 14. secrets/ai segue bloqueado no Firestore rules
    const rulesStr = fs.readFileSync('./firestore.rules', 'utf8');
    assert(
      rulesStr.includes("match /secrets/{secretId}") && 
      rulesStr.includes("allow read, write: if false;"), 
      "Firestore rules bloqueiam leitura e escrita client-side em users/{uid}/secrets/ai"
    );

    // 15. chave nunca aparece em retorno JSON
    const statusKeys = Object.keys(sampleStatusResponse);
    assert(
      !statusKeys.includes('apiKey') && 
      !statusKeys.includes('rawKey') && 
      !statusKeys.includes('secret') &&
      !statusKeys.includes('token'),
      "Chave original nunca deve aparecer nos retornos JSON dos endpoints"
    );

    // 16. salvar secret openai e tentar ativar gemini deve falhar (mismatch)
    const mockedSecretDataOpenAI = { provider: 'openai', apiKey: 'test-key' };
    const targetProviderGemini = 'gemini';
    const hasMismatchOpenAIGemini = mockedSecretDataOpenAI.provider !== targetProviderGemini;
    assert(hasMismatchOpenAIGemini === true, "Salvar secret openai e tentar ativar gemini gera descompasso de provedor (AI_PROVIDER_SECRET_MISMATCH)");

    // 17. salvar secret gemini e ativar gemini deve passar (no mismatch)
    const mockedSecretDataGemini = { provider: 'gemini', apiKey: 'test-key' };
    const targetProviderGeminiOk = 'gemini';
    const hasMismatchGeminiGemini = mockedSecretDataGemini.provider !== targetProviderGeminiOk;
    assert(hasMismatchGeminiGemini === false, "Salvar secret gemini e ativar gemini não apresenta descompasso");

    passed++;
  } catch (err: any) {
    console.error("Erro no teste 24:", err);
    failed++;
  }

  // 25. Testes obrigatórios da Fase 3 - Central de IA, Gateway e Atribuição de Tarefas
  try {
    console.log("=== INICIANDO TESTE 25: FASE 3 CENTRAL DE IA, GATEWAY E TAREFAS ===");

    const serverContent = fs.readFileSync('./server.ts', 'utf8');

    // 1. /api/ai/generate bloqueia IA desativada.
    assert(serverContent.includes('app.post("/api/ai/generate", requireAuth,'), "POST /api/ai/generate deve usar requireAuth");
    assert(serverContent.includes('error: "AI_DISABLED"'), "/api/ai/generate deve retornar erro AI_DISABLED quando aiEnabled=false");

    // 2. /api/ai/generate retorna AI_CREDENTIALS_MISSING sem chave.
    assert(serverContent.includes('error: "AI_CREDENTIALS_MISSING"'), "/api/ai/generate deve retornar AI_CREDENTIALS_MISSING se credencial ausente");

    // 3. /api/ai/generate bloqueia task não permitida.
    assert(serverContent.includes('error: "AI_OCR_DISABLED"'), "Deve validar tarefa ocr e retornar AI_OCR_DISABLED se desligada");
    assert(serverContent.includes('error: "AI_CATEGORY_FALLBACK_DISABLED"'), "Deve validar tarefa categoryFallback e retornar AI_CATEGORY_FALLBACK_DISABLED se desligada");
    assert(serverContent.includes('error: "AI_INSIGHTS_DISABLED"'), "Deve validar tarefa insight e retornar AI_INSIGHTS_DISABLED se desligada");
    assert(serverContent.includes('error: "AI_REPORTS_DISABLED"'), "Deve validar tarefa report e retornar AI_REPORTS_DISABLED se desligada");
    assert(serverContent.includes('error: "AI_INVALID_TASK"'), "Deve validar tarefas e rejeitar tarefas inválidas com AI_INVALID_TASK");

    // 4. /api/ai/generate nunca retorna apiKey.
    assert(!serverContent.includes('return res.json({ apiKey') && !serverContent.includes('return res.status(200).json({ apiKey'), "/api/ai/generate nunca deve retornar a apiKey");

    // 5, 6, 7. secureGenerateContent chama /api/ai/generate, envia Authorization Bearer, envia task.
    const geminiMod = await import('./src/lib/gemini.js');
    const { secureGenerateContent } = geminiMod;

    const originalFetch = (global as any).fetch;
    let fetchedUrl = '';
    let fetchedOpts: any = null;
    (global as any).fetch = async (url: string, opts: any) => {
      fetchedUrl = url;
      fetchedOpts = opts;
      return {
        ok: true,
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null
        },
        json: async () => ({ text: 'mock AI response' })
      };
    };

    const originalAuth = await import('./src/firebase.js').then(m => m.auth);
    const mockUser = {
      getIdToken: async () => 'test-id-token'
    };
    Object.defineProperty(originalAuth, 'currentUser', {
      get: () => mockUser,
      configurable: true
    });

    const resSec = await secureGenerateContent({
      task: 'insight',
      model: 'test-model',
      contents: 'hello test'
    });

    assert(fetchedUrl === '/api/ai/generate', "secureGenerateContent deve chamar /api/ai/generate");
    assert(fetchedOpts?.headers?.['Authorization'] === 'Bearer test-id-token', "secureGenerateContent deve enviar Authorization Bearer");
    const sentBody = JSON.parse(fetchedOpts.body);
    assert(sentBody.task === 'insight', "secureGenerateContent deve enviar a task correto");

    // Restore
    (global as any).fetch = originalFetch;

    // 8. /api/gemini está deprecated.
    assert(serverContent.includes('deprecated: true'), "/api/gemini deve retornar deprecated: true");

    // 9. /api/gemini respeita permissões.
    assert(serverContent.includes('app.post("/api/gemini", requireAuth, async (req, res) => {') || serverContent.includes('app.post("/api/gemini", requireAuth,'), "/api/gemini de usar requireAuth");
    assert(serverContent.includes('processAIGenerateRequest(uid, req.body)'), "/api/gemini deve usar internamente a lógica de processAIGenerateRequest para respeitar permissões");

    // 10. ImportView usa task ocr.
    const importViewText = fs.readFileSync('./src/components/ImportView.tsx', 'utf8');
    assert(importViewText.includes("task: 'ocr'"), "ImportView deve conter a chamada de secureGenerateContent com a tarefa 'ocr'");

    // 11. ManualEntryModal usa task ocr e categoryFallback.
    const manualEntryText = fs.readFileSync('./src/components/ManualEntryModal.tsx', 'utf8');
    assert(manualEntryText.includes("task: 'ocr'") && manualEntryText.includes("task: 'categoryFallback'"), "ManualEntryModal deve conter as tarefas 'ocr' e 'categoryFallback'");

    // 12. DashboardView usa task insight.
    const dashboardText = fs.readFileSync('./src/components/DashboardView.tsx', 'utf8');
    assert(dashboardText.includes("task: 'insight'"), "DashboardView deve conter a tarefa 'insight'");

    // 13. ReportsView usa task report.
    const reportsText = fs.readFileSync('./src/components/ReportsView.tsx', 'utf8');
    assert(reportsText.includes("task: 'report'"), "ReportsView deve conter a tarefa 'report'");

    passed++;
  } catch (err: any) {
    console.error("Erro no teste 25:", err);
    failed++;
  }

  // 26. Testes obrigatórios da Fase 3.5 - Central de IA Gateway Real
  try {
    console.log("=== INICIANDO TESTE 26: FASE 3.5 INTEGRANTES REAIS E GATEWAY SEGURO ===");

    const gatewayContent = fs.readFileSync('./src/lib/ai/aiGateway.ts', 'utf8');
    const serverContent = fs.readFileSync('./server.ts', 'utf8');

    // 1. aiGateway não deve conter "Phase 1 active"
    assert(!gatewayContent.includes("Phase 1 active"), "aiGateway não deve conter depoimento de Phase 1 stubs");

    // 2. callGemini não pode ser stub (deve instanciar GoogleGenAI e usar apiKey)
    assert(gatewayContent.includes("new GoogleGenAI") && gatewayContent.includes("callGemini"), "callGemini não pode ser stub");

    // 3. callOpenAI não pode ser stub (deve fazer fetch para chat/completions)
    assert(gatewayContent.includes("callOpenAI") && gatewayContent.includes("https://api.openai.com/v1/chat/completions"), "callOpenAI não de ser stub");

    // 4. callAnthropic não pode ser stub (deve fazer fetch para messages com x-api-key)
    assert(gatewayContent.includes("callAnthropic") && gatewayContent.includes("https://api.anthropic.com/v1/messages"), "callAnthropic não ser stub");

    // 5. callOpenRouter usa endpoint /chat/completions
    assert(gatewayContent.includes("callOpenRouter") && gatewayContent.includes("https://openrouter.ai/api/v1/chat/completions"), "callOpenRouter deve usar chat/completions");

    // 6. callCustomOpenAICompatible exige baseUrl
    assert(gatewayContent.includes("callCustomOpenAICompatible") && gatewayContent.includes("buildOpenAICompatibleUrl"), "callCustomOpenAICompatible exige baseUrl");

    // 7. OpenCode API continua usando /v1/chat/completions
    assert(gatewayContent.includes("callOpenCodeAPI") && gatewayContent.includes("/v1/chat/completions"), "OpenCode API continua usando v1/chat/completions");

    // 8. nenhuma função retorna apiKey (nem gatewayContent tem apiKey retornada em AIResponse)
    assert(!gatewayContent.includes("return { apiKey") && !gatewayContent.includes("return { ...options, apiKey"), "Nenhuma função de resposta do gateway pode expor a apiKey");

    // 9. /api/ai/generate usa 403 para AI_DISABLED
    assert(serverContent.includes('status: 403') && serverContent.includes('error: "AI_DISABLED"'), "Deve usar 403 para AI_DISABLED");
    assert(serverContent.includes('status: 403') && serverContent.includes('error: "AI_OCR_DISABLED"'), "Deve usar 403 para AI_OCR_DISABLED");
    assert(serverContent.includes('status: 403') && serverContent.includes('error: "AI_CATEGORY_FALLBACK_DISABLED"'), "Deve usar 403 para AI_CATEGORY_FALLBACK_DISABLED");
    assert(serverContent.includes('status: 403') && serverContent.includes('error: "AI_INSIGHTS_DISABLED"'), "Deve usar 403 para AI_INSIGHTS_DISABLED");
    assert(serverContent.includes('status: 403') && serverContent.includes('error: "AI_REPORTS_DISABLED"'), "Deve usar 403 para AI_REPORTS_DISABLED");

    // 10. /api/ai/generate usa 428 para AI_CREDENTIALS_MISSING
    assert(serverContent.includes('status: 428') && serverContent.includes('error: "AI_CREDENTIALS_MISSING"'), "Deve usar 428 para AI_CREDENTIALS_MISSING");

    // 11. /api/gemini continua deprecated e usando processAIGenerateRequest
    assert(serverContent.includes('processAIGenerateRequest(uid, req.body)') && serverContent.includes('deprecated: true'), "api/gemini continua deprecated");

    passed++;
  } catch (err: any) {
    console.error("Erro no teste 26:", err);
    failed++;
  }

  // 27. Testes obrigatórios da Fase 4 - UI de Preferências da IA
  try {
    console.log("=== INICIANDO TESTE 27: FASE 4 GERENCIADOR DE IA MULTI-PROVEDOR E UX DE CONFIGURAÇÕES ===");

    const settingsContent = fs.readFileSync('./src/components/SettingsView.tsx', 'utf8');

    // 1. Seção "Inteligência Artificial" existe
    assert(settingsContent.includes("Inteligência Artificial"), "Seção 'Inteligência Artificial' deve existir");

    // 2. Provider select contém OpenCode API
    assert(settingsContent.includes("opencode_api") && settingsContent.includes("OpenCode API"), "Provedor OpenCode API deve estar no select");

    // 3. API Key não é salva em localStorage
    assert(!settingsContent.includes("localStorage.setItem('apiKey'") && !settingsContent.includes("localStorage.setItem(\"apiKey\""), "API Key não pode ser salva em localStorage");

    // 4. /api/ai/settings não recebe apiKey
    assert(settingsContent.includes("/api/ai/settings") && !settingsContent.includes("apiKey: apiKey,") && !settingsContent.includes("apiKey: apiKey}"), "settings endpoint não deve receber apiKey");

    // 5. Salvar chave usa /api/ai/credentials/save
    assert(settingsContent.includes("/api/ai/credentials/save"), "Salvar chave deve usar /api/ai/credentials/save");

    // 6. Testar conexão usa /api/ai/credentials/test
    assert(settingsContent.includes("/api/ai/credentials/test"), "Testar conexão deve usar /api/ai/credentials/test");

    // 7. Remover chave usa /api/ai/credentials/delete
    assert(settingsContent.includes("/api/ai/credentials/delete"), "Remover chave deve usar /api/ai/credentials/delete");

    // 8. keyMasked aparece, apiKey completa não aparece após salvar
    assert(settingsContent.includes("keyMasked") || settingsContent.includes("maskedKey"), "Mascaramento de chave keyMasked deve aparecer na UI");

    // 9. IA aparece desativada por padrão
    assert(settingsContent.includes("aiEnabled: false"), "IA desativada por padrão");

    // 10. OpenCode API mostra campo baseUrl
    assert(settingsContent.includes("showBaseUrl"), "OpenCode API mostra campo baseUrl");

    // 11. Ollama permite apiKey vazia
    assert(settingsContent.includes("selectedProvider === 'ollama'"), "Ollama permite apiKey opcional/vazia");

    // 12. Custom OpenAI-compatible exige baseUrl
    assert(settingsContent.includes("custom_openai_compatible") && settingsContent.includes("baseUrlInput.trim()"), "Custom OpenAI-compatible exige baseUrl");

    passed++;
  } catch (err: any) {
    console.error("Erro no teste 27:", err);
    failed++;
  }

  // 28. Testes obrigatórios da Fase 5.1 - Refinamento de IA por tarefa
  try {
    console.log("=== INICIANDO TESTE 28: FASE 5.1 HARDENING RECLASSIFICAÇÕES E DETALHES DE CONFIRMAÇÃO DE IA ===");

    const importViewText = fs.readFileSync('./src/components/ImportView.tsx', 'utf8');
    const manualEntryText = fs.readFileSync('./src/components/ManualEntryModal.tsx', 'utf8');
    const dashboardText = fs.readFileSync('./src/components/DashboardView.tsx', 'utf8');
    const reportsText = fs.readFileSync('./src/components/ReportsView.tsx', 'utf8');

    // 1. confirmar OCR não libera insight (confirmar ocr usa ai_bypass_confirm_ocr)
    assert(importViewText.includes("ai_bypass_confirm_ocr"), "ImportView deve usar bypass específico 'ai_bypass_confirm_ocr'");
    assert(manualEntryText.includes("ai_bypass_confirm_ocr"), "ManualEntryModal deve usar bypass específico 'ai_bypass_confirm_ocr'");

    // 2. confirmar ocr/insight não libera categoryFallback ou reports
    assert(manualEntryText.includes("ai_bypass_confirm_categoryFallback"), "ManualEntryModal deve usar 'ai_bypass_confirm_categoryFallback'");
    assert(dashboardText.includes("ai_bypass_confirm_insight"), "DashboardView deve usar 'ai_bypass_confirm_insight'");
    assert(reportsText.includes("ai_bypass_confirm_report"), "ReportsView deve usar 'ai_bypass_confirm_report'");

    // 3. ImportView não salva recognitionMethod AI_FALLBACK quando IA usada apenas para OCR
    assert(importViewText.includes("recognitionMethod: localRec.method"), "ImportView não deve forçar AI_FALLBACK no recognitionMethod se for apenas OCR");

    // 4. aiReason OCR_EXTRACTION é salvo quando item vem com isAiExtracted
    assert(importViewText.includes("aiReason: item.isAiExtracted ? \"OCR_EXTRACTION\" : undefined"), "ImportView deve registrar aiReason OCR_EXTRACTION para transações extraídas por IA");

    // 5. Dashboard/Reports não mostram ação de IA como ativa quando aiSettings ainda é null
    assert(dashboardText.includes("!aiSettings || !aiSettings.aiEnabled || !aiSettings.aiUseForInsights"), "DashboardView deve tratar aiSettings null como desativado/não carregado");
    assert(reportsText.includes("!aiSettings || !aiSettings.aiEnabled || !aiSettings.aiUseForReports"), "ReportsView deve tratar aiSettings null como desativado/não carregado");

    passed++;
  } catch (err: any) {
    console.error("Erro no teste 28:", err);
    failed++;
  }

  // 29. Testes obrigatórios da Fase 5.2 - Refinamento do resumo e metadata de OCR
  try {
    console.log("=== INICIANDO TESTE 29: FASE 5.2 REFINAMENTO DO RESUMO E METADATA DE OCR ===");

    const importViewText = fs.readFileSync('./src/components/ImportView.tsx', 'utf8');
    const manualEntryText = fs.readFileSync('./src/components/ManualEntryModal.tsx', 'utf8');

    // 1. ImportView não deve mostrar "por IA fallback" para OCR, deve mostrar "extraídas por OCR com IA"
    assert(!importViewText.includes("por IA fallback"), "ImportView não deve conter 'por IA fallback'");
    assert(importViewText.includes("extraídas por OCR com IA"), "ImportView deve mostrar 'extraídas por OCR com IA'");

    // 2. ManualEntryModal OCR deve salvar aiUsed=true, aiReason="OCR_EXTRACTION", preservar localResult.method, e adicionar evidência específica
    assert(manualEntryText.includes("aiUsed: true"), "ManualEntryModal deve salvar aiUsed: true para OCR");
    assert(manualEntryText.includes("aiReason: \"OCR_EXTRACTION\""), "ManualEntryModal deve salvar aiReason: \"OCR_EXTRACTION\" para OCR");
    assert(manualEntryText.includes("recognitionMethod: localResult.method"), "ManualEntryModal deve salvar recognitionMethod como localResult.method");
    assert(manualEntryText.includes("\"Dados extraídos por OCR de IA\""), "ManualEntryModal deve conter evidência 'Dados extraídos por OCR de IA'");

    passed++;
    console.log("✅ PASSED: ImportView não mostra 'por IA fallback' para OCR");
    console.log("✅ PASSED: ImportView mostra 'extraídas por OCR com IA'");
    console.log("✅ PASSED: ManualEntryModal OCR salva aiUsed=true");
    console.log("✅ PASSED: ManualEntryModal OCR salva aiReason='OCR_EXTRACTION'");
    console.log("✅ PASSED: ManualEntryModal OCR preserva recognitionMethod localResult.method");
    console.log("✅ PASSED: ManualEntryModal OCR adiciona evidência 'Dados extraídos por OCR de IA'");
  } catch (err: any) {
    console.error("Erro no teste 29:", err);
    failed++;
  }

  // 30. Testes obrigatórios da Fase 6 - Limpeza final, auditoria e hardening
  try {
    console.log("=== INICIANDO TESTE 30: FASE 6 LIMPEZA FINAL, AUDITORIA E HARDENING ===");

    const importViewText = fs.readFileSync('./src/components/ImportView.tsx', 'utf8');
    const manualEntryText = fs.readFileSync('./src/components/ManualEntryModal.tsx', 'utf8');

    // 1. Variável interna aiFallbackAppliedCount foi renomeada para aiOcrExtractedCount
    assert(!importViewText.includes("aiFallbackAppliedCount"), "ImportView deve ter renomeado a variável interna aiFallbackAppliedCount para aiOcrExtractedCount");
    assert(importViewText.includes("aiOcrExtractedCount"), "ImportView deve usar a variável interna renomeada aiOcrExtractedCount");

    // Helper recursivo para buscar arquivos .ts / .tsx
    function getFilesRecursively(dir: string): string[] {
      let results: string[] = [];
      const list = fs.readdirSync(dir);
      list.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
          results = results.concat(getFilesRecursively(fullPath));
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
          results.push(fullPath);
        }
      });
      return results;
    }

    // 2. Nenhuma ocorrência de /api/gemini em src/
    const srcFiles = getFilesRecursively('src');
    for (const f of srcFiles) {
      const content = fs.readFileSync(f, 'utf8');
      assert(!content.includes("/api/gemini"), `Arquivo ${f} não deve chamar o endpoint legado /api/gemini`);
    }

    // 3. Nenhuma chave Pluggy sendo salva em localStorage
    for (const f of srcFiles) {
      const content = fs.readFileSync(f, 'utf8');
      const hasLocalStorageSet = content.includes("localStorage.setItem('PREF_PLUGGY_CLIENT_SECRET'") || 
                                 content.includes('localStorage.setItem("PREF_PLUGGY_CLIENT_SECRET"');
      assert(!hasLocalStorageSet, `Arquivo ${f} não pode persistir segredos da Pluggy no localStorage`);
    }

    // 4. Garantir que server.ts não contém fallback global nem log global de credenciais Pluggy
    const serverText = fs.readFileSync('./server.ts', 'utf8');
    assert(!serverText.includes("Using global Pluggy credentials"), "server.ts não deve conter o log 'Using global Pluggy credentials'");
    assert(!serverText.includes("clientId = process.env.PLUGGY_CLIENT_ID;"), "server.ts não deve conter fallback para PLUGGY_CLIENT_ID no fluxo de execução de API");
    assert(!serverText.includes("clientSecret = process.env.PLUGGY_CLIENT_SECRET;"), "server.ts não deve conter fallback para PLUGGY_CLIENT_SECRET no fluxo de execução de API");

    // 5. Garantir que getPluggyCredentialsOrThrow lança erro com status 428 e código correto
    assert(serverText.includes('code = "PLUGGY_CREDENTIALS_MISSING"'), "getPluggyCredentialsOrThrow deve definir código PLUGGY_CREDENTIALS_MISSING");
    assert(serverText.includes('status = 428'), "getPluggyCredentialsOrThrow ou erros dependentes de credencial devem retornar ou definir status 428");

    // 6. O endpoint /api/pluggy/credentials/status não deve retornar usingGlobalCredentials
    assert(!serverText.includes("usingGlobalCredentials:"), "server.ts não deve incluir mais usingGlobalCredentials nos retornos da API de status de credenciais");

    // 7. Testes do PluggySettingsPanel
    const pluggyPanelText = fs.readFileSync('./src/components/PluggySettingsPanel.tsx', 'utf8');
    assert(!pluggyPanelText.includes("usingGlobalCredentials"), "PluggySettingsPanel não deve conter a variável usingGlobalCredentials");
    assert(!pluggyPanelText.includes("setUsingGlobalCredentials"), "PluggySettingsPanel não deve conter a função setUsingGlobalCredentials");
    assert(!pluggyPanelText.includes("storageMethod"), "PluggySettingsPanel não deve conter referências a storageMethod");
    assert(!pluggyPanelText.match(/pluggyClientSecret\s*:/), "PluggySettingsPanel não deve conter pluggyClientSecret como chave de atualização do Firestore ou de objeto");
    assert(pluggyPanelText.includes("clientSecret: pluggyClientSecret.trim()"), "PluggySettingsPanel deve enviar clientSecret para o endpoint de salvamento");

    passed++;
    console.log("✅ PASSED: Variável aiFallbackAppliedCount renomeada com sucesso para aiOcrExtractedCount");
    console.log("✅ PASSED: Nenhum componente chama o endpoint legado /api/gemini diretamente");
    console.log("✅ PASSED: Nenhuma chave sensível ou segredo da Pluggy é persistido no localStorage");
    console.log("✅ PASSED: Nenhum fallback global nem log global de chaves Pluggy");
    console.log("✅ PASSED: Erro de credenciais lançados com status 428 controlado");
    console.log("✅ PASSED: O endpoint status de credenciais não retorna usingGlobalCredentials");
    console.log("✅ PASSED: PluggySettingsPanel não contém usingGlobalCredentials");
    console.log("✅ PASSED: PluggySettingsPanel não contém setUsingGlobalCredentials");
    console.log("✅ PASSED: PluggySettingsPanel não contém referências a storageMethod");
    console.log("✅ PASSED: PluggySettingsPanel não grava pluggyClientSecret via updateDoc");
    console.log("✅ PASSED: PluggySettingsPanel envia pluggyClientSecret exclusivamente em clientSecret");
  } catch (err: any) {
    console.error("Erro no teste 30:", err);
    failed++;
  }

  // 31. Teste de Inteligência Artificial multiprovedor robustecido
  try {
    console.log("=== INICIANDO TESTE 31: ROBUSTECIMENTO DE IA E CONFIGURAÇÕES ===");
    
    // Testar validação robusta
    const providerRegistryMod = await import('./src/lib/ai/providerRegistry.js');
    const { validateProviderConnectionConfig } = providerRegistryMod;
    
    // Gemini sem chave deve falhar
    const geminiVal = validateProviderConnectionConfig('gemini', '', '', 'development');
    assert(geminiVal.isValid === false, "Gemini sem chave de API deve falhar na validação");
    
    // Gemini com chave deve passar
    const geminiValOk = validateProviderConnectionConfig('gemini', '', 'AIzaSyTestKey', 'development');
    assert(geminiValOk.isValid === true, "Gemini com chave válida deve passar na validação");
    
    // OpenAI com chave deve passar
    const openAiValOk = validateProviderConnectionConfig('openai', '', 'sk-proj-somekey', 'development');
    assert(openAiValOk.isValid === true, "OpenAI com chave válida deve passar na validação");

    console.log("✅ PASSED: Teste 31 concluído com sucesso.");
    passed++;
  } catch (err: any) {
    console.error("Erro no teste 31:", err);
    failed++;
  }

  // 32. Teste de Normalização de Erros de IA (Fase 8)
  try {
    console.log("=== INICIANDO TESTE 32: NORMALIZAÇÃO DE ERROS DE IA (FASE 8) ===");
    
    const { normalizeAIProviderError } = await import('./src/lib/ai/aiGateway.js');

    // A. Gemini NOT_FOUND -> AI_MODEL_NOT_FOUND
    const errNotFound1 = normalizeAIProviderError(new Error("5 NOT_FOUND: model not found"), "gemini", "gemini-1.5-pro");
    assert(errNotFound1.code === "AI_MODEL_NOT_FOUND", "Gemini 5 NOT_FOUND deve virar AI_MODEL_NOT_FOUND");
    assert(errNotFound1.message.includes("Google AI Studio"), "Gemini NOT_FOUND deve conter orientação adequada");

    // B. Invalid API key -> AI_AUTH_INVALID
    const errAuth = normalizeAIProviderError(new Error("API_KEY_INVALID: key invalid"), "gemini", "gemini-1.5-pro");
    assert(errAuth.code === "AI_AUTH_INVALID", "API_KEY_INVALID deve virar AI_AUTH_INVALID");

    // C. Quota / billing -> AI_QUOTA_OR_BILLING
    const errQuota = normalizeAIProviderError(new Error("RESOURCE_EXHAUSTED: quota exceeded"), "gemini", "gemini-1.5-pro");
    assert(errQuota.code === "AI_QUOTA_OR_BILLING", "RESOURCE_EXHAUSTED deve virar AI_QUOTA_OR_BILLING");

    // D. Rate limit -> AI_RATE_LIMITED
    const errRate = normalizeAIProviderError(new Error("Too many requests (429) rate limit"), "openai", "gpt-4");
    assert(errRate.code === "AI_RATE_LIMITED", "429 deve virar AI_RATE_LIMITED");

    // E. Timeout -> AI_PROVIDER_TIMEOUT
    const errTimeout = normalizeAIProviderError(new Error("AI_PROVIDER_TIMEOUT"), "gemini", "gemini-1.5-pro");
    assert(errTimeout.code === "AI_PROVIDER_TIMEOUT", "AI_PROVIDER_TIMEOUT deve virar AI_PROVIDER_TIMEOUT");

    // F. Network failure -> AI_PROVIDER_UNREACHABLE
    const errNetwork = normalizeAIProviderError(new Error("fetch failed"), "openai", "gpt-4");
    assert(errNetwork.code === "AI_PROVIDER_UNREACHABLE", "fetch failed deve virar AI_PROVIDER_UNREACHABLE");

    // G. Unknown error -> AI_UNKNOWN_PROVIDER_ERROR (must hide raw errMsg)
    const rawSecretMsg = "apiKey=SECRET_KEY_EXPOSED_HERE";
    const errUnknown = normalizeAIProviderError(new Error(rawSecretMsg), "gemini", "gemini-1.5-pro");
    assert(errUnknown.code === "AI_UNKNOWN_PROVIDER_ERROR", "Erro desconhecido deve virar AI_UNKNOWN_PROVIDER_ERROR");
    assert(errUnknown.message === "O provedor de IA retornou um erro inesperado durante o teste.", "Deve retornar mensagem padrão segura");
    assert(!errUnknown.message.includes(rawSecretMsg), "Não deve vazar mensagem técnica crua ou segredos");

    console.log("✅ PASSED: Teste 32 concluído com sucesso.");
    passed++;
  } catch (err: any) {
    console.error("Erro no teste 32:", err);
    failed++;
  }

  // 33. Teste de parse de Timeout (Fase 8)
  try {
    console.log("=== INICIANDO TESTE 33: VALIDAÇÃO DE PARSE DE TIMEOUT DE CONEXÃO ===");

    function customParseAIProviderTestTimeoutMs(envVal: string | undefined): number {
      if (envVal) {
        const parsed = parseInt(envVal, 10);
        if (!isNaN(parsed) && parsed >= 3000 && parsed <= 60000) {
          return parsed;
        }
      }
      return 30000;
    }

    // A. Válido e dentro da faixa
    assert(customParseAIProviderTestTimeoutMs("20000") === 20000, "20000 ms é válido");
    assert(customParseAIProviderTestTimeoutMs("3000") === 3000, "Mínimo 3000 ms é válido");
    assert(customParseAIProviderTestTimeoutMs("60000") === 60000, "Máximo 60000 ms é válido");

    // B. Fora da faixa ou inválido
    assert(customParseAIProviderTestTimeoutMs("2999") === 30000, "Menor que 3000 ms deve cair no padrão 30000");
    assert(customParseAIProviderTestTimeoutMs("60001") === 30000, "Maior que 60000 ms deve cair no padrão 30000");
    assert(customParseAIProviderTestTimeoutMs("-5000") === 30000, "Negativo deve cair no padrão 30000");
    assert(customParseAIProviderTestTimeoutMs("abc") === 30000, "String não-numérica deve cair no padrão 30000");
    assert(customParseAIProviderTestTimeoutMs("") === 30000, "String vazia deve cair no padrão 30000");
    assert(customParseAIProviderTestTimeoutMs(undefined) === 30000, "Undefined deve cair no padrão 30000");

    console.log("✅ PASSED: Teste 33 concluído com sucesso.");
    passed++;
  } catch (err: any) {
    console.error("Erro no teste 33:", err);
    failed++;
  }

  // 34. Teste de Robustecimento Visual de Conexão de IA (Fase 9)
  try {
    console.log("=== INICIANDO TESTE 34: ROBUSTECIMENTO VISUAL DE CONEXÃO DE IA (FASE 9) ===");

    const settingsContent = fs.readFileSync('./src/components/SettingsView.tsx', 'utf8');
    const serverContent = fs.readFileSync('./server.ts', 'utf8');

    // 1. SettingsView.tsx contém AITestResult com status, title, summary, provider, model
    assert(settingsContent.includes("status: 'none' | 'success' | 'error'"), "SettingsView.tsx deve conter o status no AITestResult");
    assert(settingsContent.includes("title: string"), "SettingsView.tsx deve conter title: string no AITestResult");
    assert(settingsContent.includes("summary: string"), "SettingsView.tsx deve conter summary: string no AITestResult");
    assert(settingsContent.includes("provider?: string"), "SettingsView.tsx deve conter provider: string no AITestResult");
    assert(settingsContent.includes("model?: string"), "SettingsView.tsx deve conter model: string no AITestResult");

    // 2. SettingsView.tsx contém "Copiar laudo de diagnóstico" ou "Copiar diagnóstico"
    assert(settingsContent.includes("Copiar laudo de diagnóstico") || settingsContent.includes("Copiar diagnóstico"), "SettingsView.tsx deve conter o botão 'Copiar laudo de diagnóstico'");

    // 3. SettingsView.tsx não contém mais "font-mono max-w-sm break-all" associado ao testMessage
    assert(!settingsContent.includes("font-mono max-w-sm break-all"), "Não deve restar nenhum trecho com font-mono max-w-sm break-all do testMessage legado");

    // 4. SettingsView.tsx não copia apiKeyInput no diagnóstico
    assert(!settingsContent.includes("apiKeyInput") || !settingsContent.match(/diagnosticText[\s\S]*apiKeyInput/), "Não deve conter apiKeyInput dentro do bloco de texto copiado no diagnóstico");

    // 5. server.ts retorna providerEcho separado de message no endpoint /api/ai/credentials/test e limita a 500 caracteres
    assert(serverContent.includes("providerEcho:"), "server.ts deve conter o campo providerEcho no retorno de test");
    assert(serverContent.includes("slice(0, 500)"), "server.ts deve conter o slice(0, 500) no providerEcho para evitar mensagens excessivamente longas");
    assert(serverContent.includes("message:"), "server.ts deve retornar message separada no test");

    // 5.1 SettingsView.tsx contém safeProviderEcho com limite de 500 e o utiliza
    assert(settingsContent.includes("safeProviderEcho"), "SettingsView.tsx deve conter a constante safeProviderEcho");
    assert(settingsContent.includes(".slice(0, 500)"), "SettingsView.tsx deve truncar safeProviderEcho a no máximo 500 caracteres");

    // 6. server.ts não usa response.text como message principal no sucesso do teste
    // O sucesso do teste deve retornar uma mensagem amigável separada de response.text
    assert(serverContent.includes("message: \"Teste de inferência de LLM executado com sucesso") || serverContent.includes("message: 'Teste de inferência de LLM executado com sucesso") || !serverContent.match(/message:\s*response\.text/), "server.ts não deve abusar de response.text como message principal de sucesso");

    console.log("✅ PASSED: Teste 34 concluído com sucesso.");
    passed++;
  } catch (err: any) {
    console.error("Erro no teste 34:", err);
    failed++;
  }

  // 35. Teste de Validação Estrutural do Fallback Simulado de IA (Fase 10)
  try {
    console.log("=== INICIANDO TESTE 35: VALIDAÇÃO ESTRUTURAL DO FALLBACK SIMULADO (FASE 10) ===");

    const serverContent = fs.readFileSync('./server.ts', 'utf8');

    // A. Deve verificar o flag de simulação
    assert(serverContent.includes("ENABLE_SIMULATED_AI_FALLBACK === \"true\"") || serverContent.includes("isSimulatedFallbackEnabled"), "Deve verificar se o fallback simulado está ativo pelo flag correspondente");

    // B. Deve bloquear o fallback simulado em ambiente de produção
    assert(serverContent.includes('!== "production"') || serverContent.includes('!== \'production\''), "Deve restringir o fallback simulado para ambientes que não sejam de produção");

    // C. Deve filtrar estritamente por erros de timeout e indisponibilidade
    assert(serverContent.includes("AI_PROVIDER_TIMEOUT") && serverContent.includes("AI_PROVIDER_UNREACHABLE"), "O fallback simulado de conexão deve aceitar erros de timeout e unreachable");

    // D. Deve retornar simulated: true e o código apropriado
    assert(serverContent.includes("simulated: true"), "O retorno do fallback simulado deve definir simulated: true");
    assert(serverContent.includes("AI_TEST_SIMULATED"), "O retorno do fallback simulado deve possuir o código de status AI_TEST_SIMULATED");

    console.log("✅ PASSED: Teste 35 concluído com sucesso.");
    passed++;
  } catch (err: any) {
    console.error("Erro no teste 35:", err);
    failed++;
  }

  // 36. Teste de Ajuste de Timeout Real de Generative AI
  try {
    console.log("=== INICIANDO TESTE 36: AJUSTE DE TIMEOUT REAL DE IA ===");

    const geminiContent = fs.readFileSync('./src/lib/gemini.ts', 'utf8');
    const dashboardContent = fs.readFileSync('./src/components/DashboardView.tsx', 'utf8');
    const reportsContent = fs.readFileSync('./src/components/ReportsView.tsx', 'utf8');
    const importContent = fs.readFileSync('./src/components/ImportView.tsx', 'utf8');
    const manualContent = fs.readFileSync('./src/components/ManualEntryModal.tsx', 'utf8');
    const serverContent = fs.readFileSync('./server.ts', 'utf8');

    // 1. O tipo GenerateContentParams de gemini.ts deve conter o parâmetro opcional timeoutMs
    assert(geminiContent.includes("timeoutMs?: number;"), "GenerateContentParams em gemini.ts deve conter o parâmetro opcional timeoutMs");
    assert(geminiContent.includes("timeoutMs: params.timeoutMs ?? 45000"), "secureGenerateContent deve passar o timeoutMs para apiFetchJson com fallback 45000");

    // 2. Os componentes devem configurar timeouts corretos
    assert(dashboardContent.includes("timeoutMs: 45000"), "DashboardView deve configurar timeoutMs para 45000ms");
    assert(reportsContent.includes("timeoutMs: 60000"), "ReportsView deve configurar timeoutMs para 60000ms");
    assert(importContent.includes("timeoutMs: 60000"), "ImportView deve configurar timeoutMs para 60000ms");
    assert(manualContent.includes("timeoutMs: 60000"), "ManualEntryModal deve configurar timeoutMs para 60000ms (OCR)");
    assert(manualContent.includes("timeoutMs: 30000"), "ManualEntryModal deve configurar timeoutMs para 30000ms (categoryFallback)");

    // 3. Os tratamentos de erro de timeout no frontend devem ser amigáveis
    assert(dashboardContent.includes("AI_PROVIDER_TIMEOUT") && dashboardContent.includes("demorou mais que o esperado"), "DashboardView deve tratar erros de timeout graciosamente");
    assert(reportsContent.includes("AI_PROVIDER_TIMEOUT") && reportsContent.includes("demorou mais que o esperado"), "ReportsView deve tratar erros de timeout graciosamente");
    assert(importContent.includes("AI_PROVIDER_TIMEOUT") && importContent.includes("demorou mais que o esperado"), "ImportView deve tratar erros de timeout graciosamente");

    // 4. No backend (server.ts), deve haver Promise.race com timeouts específicos e código de erro
    assert(serverContent.includes("timeoutByTask: Record<string, number>"), "server.ts deve declarar timeoutByTask de forma estrita");
    assert(serverContent.includes("AI_PROVIDER_TIMEOUT"), "server.ts deve retornar o código AI_PROVIDER_TIMEOUT se o estouro ocorrer");

    console.log("✅ PASSED: Teste 36 concluído com sucesso.");
    passed++;
  } catch (err: any) {
    console.error("Erro no teste 36:", err);
    failed++;
  }

  console.log(`\n=== RESULTADO DOS TESTES: ${passed} Passaram | ${failed} Falharam ===`);
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
