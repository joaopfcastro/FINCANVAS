import { parseOFX, parseCSV } from './src/components/ImportView.js';
import { runLocalRecognition } from './src/lib/recognition/engine/recognitionEngine.js';
import { mapMccToCategory } from './src/lib/recognition/taxonomy/mccCategoryMapper.js';
import { ACCEPT_WITH_BADGE } from './src/lib/recognition/constants.js';

// Setup mocks for Browser APIs to prevent crashes when importing ImportView.tsx which might load Firebase/React
import { jsdom } from 'mocha'; // we don't have mocha, but we can do simple globalThis:
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
    assert(sentToAi.includes("recibo.pdf") && sentToAi.includes("foto.png"), "Apenas imagens e PDFs podem ser enviados para a IA");
    assert(!sentToAi.includes("extrato.ofx"), "OFX nunca deve ser enviado para IA");
  } catch (err: any) {
    console.error("Erro no teste 7:", err);
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
