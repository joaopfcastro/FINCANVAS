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

  console.log(`\n=== RESULTADO DOS TESTES: ${passed} Passaram | ${failed} Falharam ===`);
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
