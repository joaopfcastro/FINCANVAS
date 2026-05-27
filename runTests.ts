import { parseOFX, parseCSV } from './src/lib/import/parsers.js';
import { runLocalRecognition } from './src/lib/recognition/engine/recognitionEngine.js';
import { mapMccToCategory } from './src/lib/recognition/taxonomy/mccCategoryMapper.js';
import { ACCEPT_WITH_BADGE } from './src/lib/recognition/constants.js';
import { mapToUserCategory } from './src/lib/recognition/taxonomy/mapToUserCategory.js';

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

  console.log(`\n=== RESULTADO DOS TESTES: ${passed} Passaram | ${failed} Falharam ===`);
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
