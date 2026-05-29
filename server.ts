import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { PluggyService } from "./src/lib/pluggyService";
import { 
  normalizeInstitutionName, 
  classifyPluggyDirection, 
  cleanDescriptionLocally 
} from "./src/lib/pluggyNormalizer";
interface LearnedRule {
  id?: string;
  userId: string;
  merchantKey: string;
  category: string;
  cleanDescription: string;
  type: 'Receita' | 'Despesa';
  createdAt?: any;
  updatedAt?: any;
}
import { runLocalRecognition } from "./src/lib/recognition/engine/recognitionEngine";
import { mapToUserCategory } from "./src/lib/recognition/taxonomy/mapToUserCategory";
import { AUTO_ACCEPT, ACCEPT_WITH_BADGE, REVIEW_OR_AI } from "./src/lib/recognition/constants";
import { RawTransactionInput as NewRawInput, UserRecognitionRule } from "./src/lib/recognition/types";
import admin from "firebase-admin";
import fs from "fs";
import { 
  isValidProvider, 
  getProviderConfig, 
  getDefaultModel, 
  maskApiKey, 
  getDefaultAISettings, 
  isLocalBaseUrl, 
  validateProviderConnectionConfig 
} from "./src/lib/ai/providerRegistry";
import { generateAIContent, normalizeAIProviderError } from "./src/lib/ai/aiGateway";
import {
  getAISecret,
  saveAISecret,
  deleteAISecret,
  getAISettings,
  saveAISettings
} from "./src/lib/server/aiCredentialsRepository";

dotenv.config();

// Robust source-aware Firebase Admin SDK initialization with multiple credential fallback layers
function initFirebaseAdmin() {
  if (admin.apps.length > 0) {
    return admin.apps[0];
  }

  const appOptions: admin.AppOptions = {};

  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        appOptions.credential = admin.credential.cert(serviceAccount);
        console.log("[Firebase Admin] Initialized matching FIREBASE_SERVICE_ACCOUNT_JSON configuration.");
      } catch (jsonErr: any) {
        console.error("[Firebase Admin Error] FIREBASE_SERVICE_ACCOUNT_JSON parse failed:", jsonErr.message);
      }
    }

    if (!appOptions.credential && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      if (fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
        console.log("[Firebase Admin] Detected GOOGLE_APPLICATION_CREDENTIALS. Default SDK logic will handle cert.");
      }
    }

    if (!appOptions.credential && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const appletConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
      if (fs.existsSync(appletConfigPath)) {
        const firebaseConfig = JSON.parse(fs.readFileSync(appletConfigPath, "utf8"));
        appOptions.projectId = firebaseConfig.projectId;
        console.log(`[Firebase Admin] Initializing with projectId from firebase-applet-config.json: ${firebaseConfig.projectId}.`);
      }
    }

    return admin.initializeApp(appOptions);
  } catch (err: any) {
    console.warn("[Firebase Admin] Custom builder fallback triggered due to initialization warning:", err.message);
    try {
      return admin.initializeApp();
    } catch (fallbackErr: any) {
      console.error("[Firebase Admin Scaffold Error] Absolute initialization failure. Firestore fallback denied.");
      throw fallbackErr;
    }
  }
}

initFirebaseAdmin();
const db = admin.firestore();

let lastFirestoreStatus: boolean | null = null;
let lastFirestoreCheckTime = 0;

// Light test query to verify connection to Firestore database with a 15-second Cache
async function checkFirestoreReady(): Promise<boolean> {
  const now = Date.now();
  if (lastFirestoreStatus !== null && (now - lastFirestoreCheckTime) < 15000) {
    return lastFirestoreStatus;
  }

  try {
    await db.collection("users").limit(1).get();
    lastFirestoreStatus = true;
    lastFirestoreCheckTime = now;
    return true;
  } catch (err: any) {
    console.error("[Firestore Health Check Failed]:", err.message);
    lastFirestoreStatus = false;
    lastFirestoreCheckTime = now;
    return false;
  }
}

/**
 * Backend authentication middleware that validates the Authorization Bearer ID Token.
 * Sets req.user = { uid, email } and rejects unauthorized requests with 401.
 */
const requireAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing Authorization Bearer Token" });
  }

  const idToken = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    (req as any).user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
    };
    next();
  } catch (error: any) {
    console.error("[requireAuth Error]:", error.message);
    return res.status(401).json({ error: "Unauthorized: Invalid or expired Firebase ID Token" });
  }
};

/**
 * Persists ownership mapping information for a synchronized/validated itemId.
 * Standardizes security by creating a global lookup index and a per-user subcollection log.
 */
async function recordItemOwnership(uid: string, itemId: string, email?: string) {
  try {
    const updatedAt = admin.firestore.FieldValue.serverTimestamp();
    // Save to global lookup index
    await db.collection("pluggyItemIndex").doc(itemId).set({
      uid,
      itemId,
      email: email || "",
      updatedAt
    }, { merge: true });

    // Save to users/{uid}/pluggyItems/{itemId} subcollection
    await db.collection("users").doc(uid).collection("pluggyItems").doc(itemId).set({
      uid,
      itemId,
      updatedAt
    }, { merge: true });

    // Save under legacy subcollection users/{uid}/pluggy/items/{itemId} for absolute compliance
    await db.collection("users").doc(uid).collection("pluggy").doc("items").collection("list").doc(itemId).set({
      uid,
      itemId,
      updatedAt
    }, { merge: true });

    // Safely update users/{uid}.pluggyItemIds array
    await db.collection("users").doc(uid).set({
      pluggyItemIds: admin.firestore.FieldValue.arrayUnion(itemId)
    }, { merge: true }).catch((err) => {
      console.warn(`[Item Ownership Index] Failed updating user doc array pluggyItemIds for uid ${uid}:`, err.message);
    });

    console.log(`[Item Ownership Index] Successfully mapped item: ${itemId} -> user: ${uid}`);
  } catch (err: any) {
    console.error(`[Item Ownership Index Error] Failed registering itemId ${itemId}:`, err.message);
  }
}

// In-memory registry of received Pluggy webhook events for developer diagnostics
interface PluggyWebhookEventLog {
  id: string;
  event: string;
  itemId?: string;
  transactionIds?: string[];
  clientUserId?: string;
  triggeredBy?: string;
  receivedAt: string;
  status: "received" | "processed" | "ignored" | "failed" | "requires_user_action";
  itemStatus?: string;
  rawBody: any;
  error?: string;
}
const receivedWebhookEvents: PluggyWebhookEventLog[] = [];

// Helper to safely parse JSON responses from external APIs (like Pluggy)
async function safeJson(response: any): Promise<any> {
  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    throw new Error(`Servidor da API (${response.url}) retornou formato não-JSON (Status ${response.status}). Detalhes: ${text.substring(0, 300)}`);
  }
  return response.json();
}

// LEGACY DEV-ONLY - NOT USED BY MULTI-PROVIDER ARCHITECTURE
// Legacy disabled code. Not used by /api/ai/generate, /api/gemini, Pluggy Sync, ImportView or ManualEntryModal.
let aiClient: GoogleGenAI | null = null;
function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("Warning: GEMINI_API_KEY is not defined in environment.");
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

// Extract human-readable text recursively from Gemini contents parameter
function getPromptText(contents: any): string {
  if (!contents) return "";
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    let combined = "";
    for (const item of contents) {
      if (!item) continue;
      if (typeof item === "string") {
        combined += item + " ";
      } else if (typeof item === "object") {
        if (item.parts) {
          combined += getPromptText(item.parts) + " ";
        } else if (item.text) {
          combined += item.text + " ";
        } else if (Array.isArray(item)) {
          combined += getPromptText(item) + " ";
        }
      }
    }
    return combined.trim();
  }
  if (typeof contents === "object") {
    if (contents.parts) {
      return getPromptText(contents.parts);
    }
    if (contents.text) {
      return contents.text;
    }
  }
  return "";
}
// Generate highly realistic smart mockup response matching UI expectations on API failure
// LEGACY DEV-ONLY - NOT USED BY MULTI-PROVIDER ARCHITECTURE
// Legacy disabled code. Not used by /api/ai/generate, /api/gemini, Pluggy Sync, ImportView or ManualEntryModal.
export function getSimulatedGeminiResponse(model: string, contents: any, config: any): { text: string; [key: string]: any } {
  const ENABLE_SIMULATED_AI_FALLBACK = process.env.ENABLE_SIMULATED_AI_FALLBACK === "true";
  const IS_PRODUCTION = process.env.NODE_ENV === "production";

  if (IS_PRODUCTION || !ENABLE_SIMULATED_AI_FALLBACK) {
    console.log("Gemini unavailable and simulated fallback disabled");
    throw new Error("Simulated fallback is disabled");
  }

  console.log("Simulated Gemini fallback enabled for development only");
  const promptText = getPromptText(contents);
  const promptLower = promptText.toLowerCase();

  // 1. Bulk Transaction Import Extraction (e.g., CSV imports, statements)
  const isArraySchema = config?.responseSchema?.type === "ARRAY" || config?.responseSchema?.type === "Type.ARRAY" || promptLower.includes("extrato") || promptLower.includes("transações financeiras");
  if (isArraySchema) {
    const today = new Date();
    const formatDate = (daysOffset: number) => {
      const d = new Date(today);
      d.setDate(today.getDate() - daysOffset);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    };

    const simulatedRows = [
      {
        date: formatDate(0),
        desc: "iFood (Restaurante Almoço)",
        type: "Despesa",
        amount: -54.90,
        source: "Nubank"
      },
      {
        date: formatDate(0),
        desc: "Supermercado Pão de Açúcar",
        type: "Despesa",
        amount: -186.20,
        source: "Itaú"
      },
      {
        date: formatDate(1),
        desc: "Uber Trip",
        type: "Despesa",
        amount: -21.50,
        source: "Nubank"
      },
      {
        date: formatDate(1),
        desc: "Mercado Livre",
        type: "Despesa",
        amount: -129.90,
        source: "Cartão de Crédito"
      },
      {
        date: formatDate(2),
        desc: "Transferência Recebida Pix",
        type: "Receita",
        amount: 3500.00,
        source: "Banco do Brasil"
      },
      {
        date: formatDate(3),
        desc: "Netflix Mensalidade",
        type: "Despesa",
        amount: -55.90,
        source: "Nubank"
      }
    ];

    const jsonText = JSON.stringify(simulatedRows, null, 2);
    return {
      text: jsonText,
      candidates: [{ content: { parts: [{ text: jsonText }] } }]
    };
  }

  // 2. Single Receipt / Note Fiscal Capture details
  if (promptLower.includes("nota fiscal") || promptLower.includes("recibo") || promptLower.includes("imagem de transação")) {
    const todayStr = new Date().toLocaleDateString('pt-BR');
    const responseObj = {
      desc: "Lojas Americanas",
      amount: -64.90,
      date: todayStr,
      type: "Despesa",
      source: "Nubank",
      merchantName: "Lojas Americanas",
      cnpj: "00.776.574/0001-56"
    };

    const jsonText = JSON.stringify(responseObj, null, 2);
    return {
      text: jsonText,
      candidates: [{ content: { parts: [{ text: jsonText }] } }]
    };
  }

  // 3. Category/Description intelligent suggestions for Manual entry
  if (promptLower.includes("analise a descrição") || promptLower.includes("descrição:") || promptLower.includes("regras de classificação")) {
    let description = "Transação";
    const descMatch = promptText.match(/Descrição:\s*"([^"]+)"/i) || promptText.match(/Descrição:\s*([^\n]+)/i);
    if (descMatch) {
      description = descMatch[1].trim();
    }

    const dl = description.toLowerCase();
    let cleanDesc = description;
    let source = "Pix";

    if (dl.includes("uber") || dl.includes("99app") || dl.includes("cabify") || dl.includes("indrive")) {
      cleanDesc = "Uber/Transporte";
      source = "Cartão de Crédito";
    } else if (dl.includes("ifood") || dl.includes("mcdonald") || dl.includes("burger") || dl.includes("bk") || dl.includes("habibs") || dl.includes("restaurante") || dl.includes("pizzaria") || dl.includes("padaria") || dl.includes("sushi")) {
      cleanDesc = dl.includes("ifood") ? "iFood" : (dl.includes("mcdonald") ? "McDonald's" : "Restaurante/Alimentação");
      source = "Pix";
    } else if (dl.includes("posto") || dl.includes("combustivel") || dl.includes("petrobras") || dl.includes("ipiranga") || dl.includes("shell") || dl.includes("combustível")) {
      cleanDesc = "Posto de Combustível";
      source = "Cartão";
    } else if (dl.includes("mercado") || dl.includes("carrefour") || dl.includes("extra") || dl.includes("pao de acucar") || dl.includes("pão de açúcar") || dl.includes("supermercado")) {
      cleanDesc = "Supermercado";
      source = "Débito";
    } else if (dl.includes("amazon") || dl.includes("shopee") || dl.includes("mercado livre") || dl.includes("aliexpress") || dl.includes("magalu")) {
      cleanDesc = dl.includes("amazon") ? "Amazon" : (dl.includes("shopee") ? "Shopee" : "Mercado Livre");
      source = "Cartão de Crédito";
    } else if (dl.includes("netflix") || dl.includes("spotify") || dl.includes("youtube") || dl.includes("prime video") || dl.includes("disney") || dl.includes("hbo")) {
      cleanDesc = dl.includes("netflix") ? "Netflix" : (dl.includes("spotify") ? "Spotify" : "Assinatura Digital");
      source = "Crédito Recorrente";
    } else if (dl.includes("salario") || dl.includes("salário") || dl.includes("pagamento") || dl.includes("recebimento") || dl.includes("trabalho")) {
      cleanDesc = "Salário Mensal";
      source = "TED / PIX";
    } else if (dl.includes("investimento") || dl.includes("ações") || dl.includes("cdb") || dl.includes("poupança") || dl.includes("rendimento")) {
      cleanDesc = "Rentabilidade / Aplicação";
      source = "Corretora";
    } else {
      const cleanedInputDesc = description.trim();
      cleanDesc = cleanedInputDesc.charAt(0).toUpperCase() + cleanedInputDesc.slice(1);
    }

    const responseObj = {
      cleanDescription: cleanDesc,
      source: source
    };

    const jsonText = JSON.stringify(responseObj, null, 2);
    return {
      text: jsonText,
      candidates: [{ content: { parts: [{ text: jsonText }] } }]
    };
  }

  // 4. Largest Expense short insight advice
  if (promptLower.includes("despesa maior:")) {
    let despesaName = "sua despesa maior";
    let despesaAmount = "";
    let despesaGroupSymbol = "";
    const nameMatch = promptText.match(/Despesa Maior:\s*([^(]+)/i);
    const catMatch = promptText.match(/\(([^)]+)\)/i);
    const valMatch = promptText.match(/valor de R\$\s*([\d.,]+)/i);

    if (nameMatch) despesaName = nameMatch[1].trim();
    if (catMatch) despesaGroupSymbol = catMatch[1].trim();
    if (valMatch) despesaAmount = "de R$ " + valMatch[1].trim();

    const adviceText = `Sua despesa com **${despesaName}** ${despesaGroupSymbol ? `na categoria (${despesaGroupSymbol})` : ''} ${despesaAmount} é relevante. Para essa área de gastos, sugerimos monitorar a frequência ou definir limites semanais em cartões pré-pagos e preferir compras à vista com desconto para mitigar o impacto total de parcelas.`;

    return {
      text: adviceText,
      candidates: [{ content: { parts: [{ text: adviceText }] } }]
    };
  }

  // 5. Elite Consultant Markdown Wealth Report
  if (promptLower.includes("consultor financeiro de elite")) {
    const reportText = `## 📊 RELATÓRIO FINANCEIRO ESTRATÉGICO

Análise profunda de saúde financeira e comportamento orçamentário.

### 1. Análise Crítica do Comportamento
Seus dados de transações apontam para um bom patamar de estabilidade, com receitas recorrentes que sustentam o orçamento básico. No entanto, há um desvio substancial de pequenos valores não catalogados que, quando agregados, reduzem severamente a sua capacidade real de poupança no fechamento do período.

### 2. Alerta de Áreas Críticas
* **Alimentação & Entregas**: Seus gastos com restaurantes e entregas rápidas estão acima dos limites orçamentários recomendados (geralmente fixados em até 15% do ganho líquido).
* **Compras Online**: Compras recorrentes de conveniência em e-commerce representam uma drenagem passiva sobre suas reservas.
* **Custos Fixos / Assinaturas**: Verifique se todos os canais recorrentes em débito automático estão sendo realmente aproveitados.

### 3. Projeção de Futuro (Próximos 6 Meses)
* **Mantendo o Comportamento Atual**: Seu fluxo de caixa mensal crescerá de forma marginal, dificultando a rápida formação de um colchão de segurança e adiando reinvestimentos.
* **Aplicando as Otimizações**: Uma retenção de apenas 12% adicionais nas despesas supérfluas gerará reservas correspondentes a 1.5 meses de despesas vitais completas ao final de 6 meses.

### 4. 5 Recomendações Práticas e Imediatas
1. **Regra de Adiantamento das Compras**: Aguarde 48 horas antes de finalizar itens mantidos voluntariamente nos carrinhos virtuais de compras online.
2. **Definição de Teto Semanal para Delivery**: Delimite uma quantia fixa semanal para alimentação externa e pedidos imediatos em aplicativos.
3. **Poupe no Recebimento**: Transfira de imediato 10% a 15% de qualquer faturamento líquido recorrente para investimento seguro antes de pagar despesas variáveis.
4. **Revisão Tarifária**: Estude mensalidades de pacotes bancários ou anuidades operacionais de cartão e exija reajustes.
5. **Auditoria Geral de Assinaturas**: Cancele contratos recorrentes que não tenham demonstrado engajamento nos últimos trinta dias inteiros.`;

    return {
      text: reportText,
      candidates: [{ content: { parts: [{ text: reportText }] } }]
    };
  }

  // 6. Heuristic Dashboard Finance Analysis
  if (promptLower.includes("analise financeiramente")) {
    const analysisText = `**O que está indo muito bem:** Observamos ótima consistência e estabilidade no faturamento recorrente. Suas receitas essenciais estão pavimentando uma base firme, mantendo as principais contas vitais estruturadas sob bom controle.

**Ponto de Atenção Recente:** Cuidado com o acúmulo de pequenas compras que drenam o caixa de forma invisível. Gastos pontuais não planejados somam somas expressivas quando agrupados semanalmente.

**Dica Financeira Prática:** Aplique a distribuição 50-30-20. Reserve rigorosamente 50% dos seus rendimentos líquidos para despesas vitais estruturais, limite a 30% seus desejos e estilo de vida variáveis, e envie os 20% restantes diretamente para sua carteira de investimentos.`;

    return {
      text: analysisText,
      candidates: [{ content: { parts: [{ text: analysisText }] } }]
    };
  }

  // Fallback default message
  const defaultText = "Com base no histórico orçamentário recente, orientamos manter uma revisão sistemática das despesas mensais supérfluas e focar no aporte automático de pelo menos 10% de suas receitas recorrentes.";
  return {
    text: defaultText,
    candidates: [{ content: { parts: [{ text: defaultText }] } }]
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Parse large payloads (receipt images)
  app.use(express.json({ limit: "50mb" }));

  // 0. Health check endpoint
  app.get("/api/health", async (_req, res) => {
    const firestoreReady = await checkFirestoreReady();
    const serviceStatus = {
      ok: firestoreReady,
      service: "FINCANVAS API",
      timestamp: new Date().toISOString(),
      database: firestoreReady ? "CONNECTED" : "DISCONNECTED"
    };
    if (!firestoreReady) {
      return res.status(503).json(serviceStatus);
    }
    return res.json(serviceStatus);
  });

  // Helper to retrieve and validate Pluggy credentials securely in backend
  const getPluggyCredentialsOrThrow = async (req?: express.Request) => {
    let uid = (req as any)?.user?.uid;
    let clientId: string | undefined;
    let clientSecret: string | undefined;

    // Buscar somente users/{uid}/secrets/pluggy
    if (uid) {
      try {
        const secretDoc = await db.collection("users").doc(uid).collection("secrets").doc("pluggy").get();
        if (secretDoc.exists) {
          const sData = secretDoc.data();
          clientId = sData?.clientId || sData?.pluggyClientId;
          clientSecret = sData?.clientSecret || sData?.pluggyClientSecret;
          if (clientId && clientSecret) {
            console.log("Loaded user server-only Pluggy credentials");
          }
        }
      } catch (err: any) {
        console.warn(`[Pluggy Credentials] Failed reading private secret collection for uid ${uid}:`, err.message);
      }
    }

    clientId = clientId?.trim();
    clientSecret = clientSecret?.trim();

    if (!clientId || !clientSecret) {
      const error = new Error("Configure suas credenciais Pluggy em Preferências para usar a integração bancária.");
      (error as any).code = "PLUGGY_CREDENTIALS_MISSING";
      (error as any).status = 428;
      throw error;
    }
    return { clientId, clientSecret };
  };

  const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || "");

  // 0. Check secure credentials status (legacy endpoint forwarded for UI safety)
  app.get("/api/pluggy/credentials_status", requireAuth, async (req, res) => {
    const webhookSecretConfigured = !!process.env.PLUGGY_WEBHOOK_SECRET;
    try {
      await getPluggyCredentialsOrThrow(req);
      res.json({ configured: true, webhookSecretConfigured });
    } catch {
      res.json({ configured: false, webhookSecretConfigured });
    }
  });

  // 0.1 POST /api/pluggy/credentials/save
  app.post("/api/pluggy/credentials/save", requireAuth, async (req: any, res) => {
    try {
      const { clientId, clientSecret } = req.body;
      const uid = req.user.uid;

      if (!clientId || !clientSecret) {
        return res.status(400).json({ error: "Client ID e Client Secret são campos obrigatórios." });
      }

      // Valida autenticação na Pluggy (testa se as credenciais realmente funcionam)
      try {
        await PluggyService.authenticate(clientId.trim(), clientSecret.trim());
      } catch (authErr: any) {
        console.error("[Pluggy save credentials check failed]:", authErr.message);
        return res.status(401).json({ error: "Falha ao conectar na Pluggy com estas credenciais: " + authErr.message });
      }

      // Salva no Firestore sob users/{uid}/secrets/pluggy usando o Admin SDK
      await db.collection("users").doc(uid).collection("secrets").doc("pluggy").set({
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Migração/limpeza imediata de legado do documento principal do usuário
      await db.collection("users").doc(uid).update({
        pluggyClientSecret: admin.firestore.FieldValue.delete(),
        pluggyClientId: admin.firestore.FieldValue.delete()
      }).catch(() => {});

      const clientIdMasked = clientId.trim().substring(0, 4) + "••••";
      res.json({
        configured: true,
        clientIdMasked
      });
    } catch (err: any) {
      console.error("[Save Credentials Error]:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 0.2 GET /api/pluggy/credentials/status
  app.get("/api/pluggy/credentials/status", requireAuth, async (req: any, res) => {
    try {
      const uid = req.user.uid;

      // Realiza a migração/limpeza do legado automágica se estiver no user principal
      const userDocRef = db.collection("users").doc(uid);
      const userSnap = await userDocRef.get();
      if (userSnap.exists) {
        const uData = userSnap.data();
        if (uData?.pluggyClientSecret || uData?.pluggyClientId) {
          console.log(`[Migration] Purging legacy credentials from users/${uid} user profile`);
          await userDocRef.update({
            pluggyClientSecret: admin.firestore.FieldValue.delete(),
            pluggyClientId: admin.firestore.FieldValue.delete()
          }).catch((err) => console.error("Failed to delete legacy user doc fields:", err.message));
        }
      }

      const secretDoc = await db.collection("users").doc(uid).collection("secrets").doc("pluggy").get();
      if (secretDoc.exists) {
        const sData = secretDoc.data();
        const clientId = sData?.clientId || sData?.pluggyClientId || "";
        res.json({
          configured: true,
          needsCredentials: false,
          clientIdMasked: clientId.substring(0, 4) + "••••"
        });
      } else {
        res.json({
          configured: false,
          needsCredentials: true,
          clientIdMasked: null
        });
      }
    } catch (err: any) {
      console.error("[Status Credentials Error]:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 0.3 DELETE /api/pluggy/credentials/delete
  app.delete("/api/pluggy/credentials/delete", requireAuth, async (req: any, res) => {
    try {
      const uid = req.user.uid;

      // Remove private secret
      await db.collection("users").doc(uid).collection("secrets").doc("pluggy").delete();

      // Limpa legados de users/{uid} apenas por segurança
      await db.collection("users").doc(uid).update({
        pluggyClientSecret: admin.firestore.FieldValue.delete(),
        pluggyClientId: admin.firestore.FieldValue.delete()
      }).catch(() => {});

      res.json({ success: true, message: "Credenciais excluídas com sucesso." });
    } catch (err: any) {
      console.error("[Delete Credentials Error]:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 1. Testar Credenciais da API Privada do Pluggy
  app.post("/api/pluggy/test", requireAuth, async (req, res) => {
    try {
      const { clientId, clientSecret } = await getPluggyCredentialsOrThrow(req);
      await PluggyService.authenticate(clientId, clientSecret);
      res.json({ success: true, message: "Par de chaves do Pluggy validado com sucesso!" });
    } catch (err: any) {
      console.error("[Pluggy Test HTTP Router Error]:", err.message);
      res.status(err.code === "PLUGGY_CREDENTIALS_MISSING" ? 428 : 401).json({ error: err.message || "Erro de login na Pluggy." });
    }
  });

  // 1.1 Listar conexões (items) ativas do Pluggy
  app.post("/api/pluggy/list_items", requireAuth, async (req: any, res) => {
    try {
      const { clientId, clientSecret } = await getPluggyCredentialsOrThrow(req);
      const { itemIds } = req.body;
      const uid = req.user.uid;
      const apiKey = await PluggyService.authenticate(clientId, clientSecret);

      // Verify what itemIds user profile contains, or lookup
      const userProfileSnap = await db.collection("users").doc(uid).get();
      const userProfileItemIds: string[] = userProfileSnap.exists ? (userProfileSnap.data()?.pluggyItemIds || []) : [];

      let items: any[] = [];
      let globalListingRestricted = false;
      let requiresManualItemId = false;

      const listIds: string[] = Array.isArray(itemIds) ? itemIds.filter(Boolean) : [];

      // Zero-Trust Guard: If client requests specific IDs, verify ownership of all
      const checkedIds: string[] = [];
      for (const id of listIds) {
        if (userProfileItemIds.includes(id)) {
          checkedIds.push(id);
        } else {
          // Fallback to checking the index
          const indexSnap = await db.collection("pluggyItemIndex").doc(id).get();
          if (indexSnap.exists && indexSnap.data()?.uid === uid) {
            checkedIds.push(id);
          } else {
            console.warn(`[Zero-Trust] Blocked list_items query for item: ${id} by unauthorized uid: ${uid}`);
            return res.status(403).json({ error: "Access Denied: You do not own this connection." });
          }
        }
      }

      if (checkedIds.length > 0) {
        console.log(`[Pluggy list_items] Fetching specific authorized item IDs:`, checkedIds);
        for (const id of checkedIds) {
          try {
            const item = await PluggyService.getItem(apiKey, id);
            items.push(item);
          } catch (itemErr: any) {
            console.error(`[Pluggy list_items] Failed to get single item ${id}:`, itemErr.message);
          }
        }
      } else {
        // Fallback: list only user-owned items from their profile/index
        if (userProfileItemIds.length > 0) {
          for (const id of userProfileItemIds) {
            try {
              const item = await PluggyService.getItem(apiKey, id);
              items.push(item);
            } catch (err: any) {
              console.warn(`[Pluggy list_items] Sinking single user item read ${id}:`, err.message);
            }
          }
        } else {
          try {
            // Check global index too
            const indexQuery = await db.collection("pluggyItemIndex").where("uid", "==", uid).get();
            if (!indexQuery.empty) {
              for (const doc of indexQuery.docs) {
                try {
                  const item = await PluggyService.getItem(apiKey, doc.id);
                  items.push(item);
                } catch (e: any) {
                  console.warn(`[Pluggy list_items] Index item read failed ${doc.id}:`, e.message);
                }
              }
            } else {
              // Attempt global list ONLY if no manual connections exist and workspace permits it
              items = await PluggyService.listItems(apiKey);
            }
          } catch (listErr: any) {
            console.warn("[Pluggy list_items] Global workspace listing failed or restricted:", listErr.message);
            globalListingRestricted = true;
            requiresManualItemId = true;
            return res.json({
              ok: true,
              success: true,
              items: [],
              globalListingRestricted: true,
              requiresManualItemId: true,
              message: "Credenciais OK, mas sua conta não permite listagem de todos os items de forma global. Adicione o seu Item ID de conexão manual na aba de preferências para começar."
            });
          }
        }
      }

      res.json({ success: true, ok: true, items, globalListingRestricted, requiresManualItemId });
    } catch (err: any) {
      console.error("[Pluggy list_items HTTP Router Error]:", err.message);
      res.status(err.code === "PLUGGY_CREDENTIALS_MISSING" ? 428 : 500).json({ error: err.message });
    }
  });

  // 1.2 Deletar uma conexão (item) no Pluggy
  app.post("/api/pluggy/delete_item", requireAuth, async (req: any, res) => {
    const { itemId } = req.body;
    const uid = req.user.uid;
    if (!itemId) {
      return res.status(400).json({ error: "Item ID é um parâmetro obrigatório de exclusão." });
    }

    // Zero-Trust: Confirm ownership of the item before deletion
    const indexSnap = await db.collection("pluggyItemIndex").doc(itemId).get();
    const userProfileSnap = await db.collection("users").doc(uid).get();
    const userItemIds: string[] = userProfileSnap.exists ? (userProfileSnap.data()?.pluggyItemIds || []) : [];

    if (!userItemIds.includes(itemId) && (!indexSnap.exists || indexSnap.data()?.uid !== uid)) {
      console.warn(`[Zero-Trust Block] Unauthorized delete attempt for itemId: ${itemId} by uid: ${uid}`);
      return res.status(403).json({ error: "Access Denied: You do not own this connection." });
    }

    try {
      const { clientId, clientSecret } = await getPluggyCredentialsOrThrow(req);
      const apiKey = await PluggyService.authenticate(clientId, clientSecret);
      await PluggyService.deleteItem(apiKey, itemId);

      // Clean up index/profile mapping
      await db.collection("pluggyItemIndex").doc(itemId).delete().catch(() => {});
      await db.collection("users").doc(uid).collection("pluggyItems").doc(itemId).delete().catch(() => {});
      await db.collection("users").doc(uid).collection("pluggy").doc("items").collection("list").doc(itemId).delete().catch(() => {});

      res.json({ success: true, message: "Conexão deletada com sucesso!" });
    } catch (err: any) {
      console.error("[Pluggy delete_item HTTP Router Error]:", err.message);
      res.status(err.code === "PLUGGY_CREDENTIALS_MISSING" ? 428 : 500).json({ error: err.message });
    }
  });

  // 1.2.1 Validar Item ID de conexão manual
  app.post("/api/pluggy/validate_item", requireAuth, async (req: any, res) => {
    try {
      const { itemId } = req.body;
      const uid = req.user.uid;
      const email = req.user.email;

      if (!itemId || !isUuid(itemId)) {
        return res.status(400).json({
          ok: false,
          code: "INVALID_ITEM_ID",
          message: "Item ID inválido. Por favor forneça um UUID válido da conexão Pluggy."
        });
      }

      const { clientId, clientSecret } = await getPluggyCredentialsOrThrow(req);
      const apiKey = await PluggyService.authenticate(clientId, clientSecret);
      const item = await PluggyService.getItem(apiKey, itemId);

      // Successfully validated. Record server-side ownership.
      await recordItemOwnership(uid, itemId, email);

      return res.json({
        ok: true,
        item: {
          id: item.id,
          status: item.status,
          connector: item.connector?.name ?? item.provider?.name ?? "Pluggy Connector",
          createdAt: (item as any).createdAt ?? (item as any).created_at,
          updatedAt: (item as any).updatedAt ?? (item as any).updated_at
        }
      });
    } catch (error: any) {
      console.error("[Pluggy Validate Item Exception]:", error.message);
      let message = error.message || "Não foi possível validar o Item ID.";
      let status = 500;
      let code = "PLUGGY_VALIDATE_ITEM_FAILED";

      if (message.toLowerCase().includes("not found") || message.includes("404")) {
        status = 404;
        code = "PLUGGY_ITEM_NOT_FOUND";
        message = "Item ID não encontrado na base de dados da Pluggy.";
      } else if (message.includes("401") || message.includes("403")) {
        status = 403;
        code = "PLUGGY_ITEM_ACCESS_RESTRICTED";
        message = "Esse Item ID não pertence às credenciais Pluggy configuradas ou seu plano não permite esse acesso.";
      } else if (error.code === "PLUGGY_CREDENTIALS_MISSING") {
        status = 428;
        code = error.code;
      }

      return res.status(status).json({
        ok: false,
        code,
        message
      });
    }
  });

  // 1.2.2 Gerar Token de Conectividade do Widget Pluggy Connect
  app.post("/api/pluggy/connect_token", requireAuth, async (req: any, res) => {
    try {
      const { itemId, webhookUrl: customWebhook } = req.body;
      const uid = req.user.uid;
      const { clientId, clientSecret } = await getPluggyCredentialsOrThrow(req);
      const apiKey = await PluggyService.authenticate(clientId, clientSecret);

      // Force req.user.uid as clientUserId when generating token with Pluggy. Clean.
      const webhookUrl = customWebhook || process.env.PLUGGY_WEBHOOK_URL;
      const data = await PluggyService.createConnectToken(apiKey, uid, itemId, { webhookUrl });
      res.json({ success: true, connectToken: data.accessToken || data.token || data.connectToken });
    } catch (err: any) {
      console.error("[Pluggy connect_token HTTP Router Error]:", err.message);
      res.status(err.code === "PLUGGY_CREDENTIALS_MISSING" ? 428 : 500).json({ error: err.message });
    }
  });

  // 1.3 Adicionar um canal de diagnóstico ao vivo da Pluggy
  app.post("/api/pluggy/diagnose", requireAuth, async (req: any, res) => {
    const { itemIds } = req.body;
    
    const logs: string[] = [];
    const steps: { name: string; status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"; details: string }[] = [
      { name: "Verificação de Parâmetros", status: "PENDING", details: "Aguardando início..." },
      { name: "Handshake de Autenticação", status: "PENDING", details: "Aguardando início..." },
      { name: "Mapeamento de Workspace", status: "PENDING", details: "Aguardando início..." },
      { name: "Verificação de Itens Relacionados", status: "PENDING", details: "Aguardando..." }
    ];

    logs.push("[Diagnóstico] Iniciando varredura e testes ao vivo para o Pluggy...");
    try {
      // Passo 1: Verificação local com de credenciais seguras no servidor
      steps[0].status = "RUNNING";
      logs.push("[Passo 1] Analisando existência e preenchimento das credenciais do servidor...");
      
      const { clientId, clientSecret } = await getPluggyCredentialsOrThrow(req);
      const cleanId = clientId.trim().replace(/[\r\n\t\s]/g, "");
      const cleanSecret = clientSecret.trim().replace(/[\r\n\t\s]/g, "");

      steps[0].status = "COMPLETED";
      steps[0].details = "Credenciais localizadas no servidor.";
      logs.push(`[Passo 1] Parâmetros validados! Client ID mascarado: "${cleanId.substring(0, 8)}..."`);

      // Passo 2: Handshake do Servidor
      steps[1].status = "RUNNING";
      const authUrl = "https://api.pluggy.ai/auth";
      logs.push(`[Passo 2] Disparando handshake seguro (POST /auth) contra: ${authUrl}`);
      
      const authRes = await fetch(authUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: cleanId, clientSecret: cleanSecret }),
      });

      logs.push(`[Passo 2] Status de resposta retornado de /auth: ${authRes.status} (${authRes.statusText})`);
      const authData = await authRes.json().catch(() => ({}));
      logs.push(`[Passo 2] Atributos retornados no objeto JSON: [${Object.keys(authData).join(", ")}]`);

      let apiKey = authData?.apiKey || authData?.api_key || authData?.token || authData?.accessToken;
      if (apiKey && typeof apiKey === 'string') {
        apiKey = apiKey.trim().replace(/[\r\n\t\s]/g, "");
      }

      if (!apiKey) {
        steps[1].status = "FAILED";
        steps[1].details = `Falha de credenciamento (HTTP ${authRes.status}).`;
        logs.push(`[Passo 2 - DETALHES DE ERRO DA API PLUGGY]: ${JSON.stringify(authData)}`);
        throw new Error(`Conexão rejeitada no handshake inicial da API com Status HTTP ${authRes.status}. Verifique se suas chaves são válidas.`);
      }

      steps[1].status = "COMPLETED";
      steps[1].details = "Handshake válido! API key liberada.";
      logs.push(`[Passo 2] Autenticação realizada com sucesso!`);
      logs.push(`[Passo 2] Chave obtida (Mascarada): ${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 6)}`);

      // Passo 3: Varredura de items global
      steps[2].status = "RUNNING";
      logs.push("[Passo 3] Testando listagem global em /items...");

      let isGlobalListOk = false;
      let globalItemsCount = 0;
      try {
        const resTest = await fetch("https://api.pluggy.ai/items", {
          headers: { "X-API-KEY": apiKey }
        });
        
        if (resTest.ok) {
          const data = await resTest.json();
          globalItemsCount = (data.results || []).length;
          isGlobalListOk = true;
          steps[2].status = "COMPLETED";
          steps[2].details = `Workspace global mapeado com sucesso! Encontrados ${globalItemsCount} itens de conexão.`;
          logs.push(`[Passo 3] A listagem global /items funcionou corretamente. Total de conexões detectadas: ${globalItemsCount}`);
        } else {
          const textErr = await resTest.text().catch(() => "");
          logs.push(`[Passo 3] A listagem global falhou (Status ${resTest.status}): ${textErr.substring(0, 200)}`);
          steps[2].status = "COMPLETED"; // Declarado completado mas com aviso amigável
          steps[2].details = `Restrito/Personal (HTTP ${resTest.status}). O app usará Item IDs manuais.`;
          logs.push(`[Passo 3] Credenciais de nível Personal/Free detectadas (listagem global restrita). Isso é perfeitamente normal; o FINCANVAS prosseguirá usando seus Item IDs individuais.`);
        }
      } catch (listErr: any) {
        logs.push(`[Passo 3] Erro ao carregar listagem global: ${listErr.message}`);
        steps[2].status = "COMPLETED";
        steps[2].details = "Listagem de workspace indisponível. Continuando com validação por ID individual.";
      }

      // Passo 4: Validação de Itens Relacionados
      steps[3].status = "RUNNING";
      const normalizedIds: string[] = Array.isArray(itemIds) ? itemIds : [];
      logs.push(`[Passo 4] Validando lista de IDs de Conexão fornecidos (${normalizedIds.length})...`);

      if (normalizedIds.length === 0) {
        if (isGlobalListOk && globalItemsCount > 0) {
          steps[3].status = "COMPLETED";
          steps[3].details = `Nenhum ID específico fornecido pelo cliente, mas a listagem global retornou ${globalItemsCount} itens ativos prontos para uso.`;
          logs.push(`[Passo 4] Nenhum Item ID manual inserido, mas as conexões globais estão acessíveis.`);
        } else {
          steps[3].status = "FAILED";
          steps[3].details = "Nenhum Item ID manual foi configurado na tela de preferências.";
          logs.push("[Passo 4] Falha: Para chaves do tipo Personal/Free com listagem global inacessível, você precisa copiar o Item ID da conexão bancária no Meu Pluggy e informá-lo manualmente.");
        }
      } else {
        let successCount = 0;
        let failCount = 0;
        for (const id of normalizedIds) {
          logs.push(`[Passo 4] Checando validade do Item ID individual: ${id}...`);
          try {
            const item = await PluggyService.getItem(apiKey, id);
            successCount++;
            logs.push(`[Passo 4] SUCESSO! Conexão de Item ID ${id} validada na API (Status: ${item.status || "N/A"}).`);
          } catch (itemErr: any) {
            failCount++;
            logs.push(`[Passo 4] FALHA: Não foi possível obter acesso para o Item ID ${id}. Erro: ${itemErr.message}`);
          }
        }
        
        if (successCount > 0) {
          steps[3].status = "COMPLETED";
          steps[3].details = `Seus ${successCount} item(ns) de conexão configurado(s) foram verificado(s) com sucesso na Pluggy.`;
        } else {
          steps[3].status = "FAILED";
          steps[3].details = `Falha total: Nenhum dos ${normalizedIds.length} Item ID(s) manual(is) foi aceito ou localizado.`;
        }
      }

      res.json({ success: true, steps, logs });
    } catch (err: any) {
      console.error("[Pluggy diagnose HTTP Router Error]:", err.message);
      logs.push(`[ERRO DE DIAGNÓSTICO CATASTRÓFICO]: ${err.message}`);
      
      const current = steps.find(s => s.status === "RUNNING" || s.status === "PENDING");
      if (current) {
        current.status = "FAILED";
        current.details = err.message;
      }
      res.json({ success: false, steps, logs, error: err.message });
    }
  });

  // 2. Criar Conexão de Teste (Itaú Sandbox) programaticamente no Pluggy
  app.post("/api/pluggy/create_sandbox", requireAuth, async (req: any, res) => {
    const { bankConnectorId } = req.body;
    try {
      const { clientId, clientSecret } = await getPluggyCredentialsOrThrow(req);
      const apiKey = await PluggyService.authenticate(clientId, clientSecret);
      const itemData = await PluggyService.createSandbox(apiKey, bankConnectorId || 2);
      
      if (itemData && itemData.id) {
        await recordItemOwnership(req.user.uid, itemData.id, req.user.email);
      }

      res.json({ success: true, item: itemData });
    } catch (err: any) {
      console.error("[Pluggy create_sandbox HTTP Router Error]:", err.message);
      res.status(err.code === "PLUGGY_CREDENTIALS_MISSING" ? 428 : 500).json({ error: err.message });
    }
  });

  // 2.1 Cadastrar Webhook no Pluggy
  app.post("/api/pluggy/create_webhook", requireAuth, async (req: any, res) => {
    const { event, url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "É necessário fornecer um URL para o webhook." });
    }
    try {
      const { clientId, clientSecret } = await getPluggyCredentialsOrThrow(req);
      const apiKey = await PluggyService.authenticate(clientId, clientSecret);
      
      const customHeaders: Record<string, string> = {};
      const secret = process.env.PLUGGY_WEBHOOK_SECRET;
      if (secret) {
        customHeaders["X-FINCANVAS-WEBHOOK-SECRET"] = secret;
      }

      console.log(`[server.ts webhook] customHeaders config:`, secret ? "Configurado!" : "Não configurado");
      const webhook = await PluggyService.createWebhook(
        apiKey, 
        event || "item/updated", 
        url, 
        Object.keys(customHeaders).length > 0 ? customHeaders : undefined
      );
      res.json({ success: true, webhook });
    } catch (err: any) {
      console.error("[Pluggy create_webhook HTTP Router Error]:", err.message);
      res.status(err.code === "PLUGGY_CREDENTIALS_MISSING" ? 428 : 500).json({ error: err.message });
    }
  });

  // 2.2 Listar Webhooks cadastrados no Pluggy
  app.post("/api/pluggy/list_webhooks", requireAuth, async (req: any, res) => {
    try {
      const { clientId, clientSecret } = await getPluggyCredentialsOrThrow(req);
      const apiKey = await PluggyService.authenticate(clientId, clientSecret);
      const webhooks = await PluggyService.listWebhooks(apiKey);
      res.json({ success: true, webhooks });
    } catch (err: any) {
      console.error("[Pluggy list_webhooks HTTP Router Error]:", err.message);
      res.status(err.code === "PLUGGY_CREDENTIALS_MISSING" ? 428 : 500).json({ error: err.message });
    }
  });

  // 2.3 Excluir Webhook cadastrado no Pluggy
  app.post("/api/pluggy/delete_webhook", requireAuth, async (req: any, res) => {
    const { webhookId } = req.body;
    if (!webhookId) {
      return res.status(400).json({ error: "O ID do webhook é obrigatório para exclusão." });
    }
    try {
      const { clientId, clientSecret } = await getPluggyCredentialsOrThrow(req);
      const apiKey = await PluggyService.authenticate(clientId, clientSecret);
      await PluggyService.deleteWebhook(apiKey, webhookId);
      res.json({ success: true, message: "Webhook excluído com sucesso do Pluggy!" });
    } catch (err: any) {
      console.error("[Pluggy delete_webhook HTTP Router Error]:", err.message);
      res.status(err.code === "PLUGGY_CREDENTIALS_MISSING" ? 428 : 500).json({ error: err.message });
    }
  });

  // 2.4 Listar logs de eventos recebidos (Filtrados por usuário atual no Firestore)
  app.get("/api/pluggy/webhook_events", requireAuth, async (req: any, res) => {
    try {
      const uid = req.user.uid;
      const snap = await db.collection("users").doc(uid).collection("pluggyWebhookEvents").orderBy("receivedAt", "desc").limit(50).get();
      const events: any[] = [];
      snap.forEach(docSnap => {
        const d = docSnap.data();
        events.push({
          id: docSnap.id,
          event: d.event,
          itemId: d.itemId,
          transactionIds: d.transactionIds,
          clientUserId: d.clientUserId,
          triggeredBy: d.triggeredBy,
          receivedAt: d.receivedAt,
          status: d.status,
          itemStatus: d.itemStatus,
          rawBody: d.rawBody,
          error: d.error
        });
      });
      res.json({ success: true, events });
    } catch (err: any) {
      console.error("[Pluggy webhook_events Router Error]:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 2.5 Listener de Webhook: Chamado externamente pela Pluggy
  app.post("/api/pluggy/webhook_listener", async (req, res) => {
    const webhookSecret = process.env.PLUGGY_WEBHOOK_SECRET;
    if (webhookSecret) {
      const incomingSecret = req.headers["x-fincanvas-webhook-secret"] || req.headers["x-pluggy-webhook-secret"];
      if (!incomingSecret || incomingSecret !== webhookSecret) {
        console.warn("[Pluggy Webhook Receiver] Secret validation failed!");
        return res.status(401).json({ error: "Unauthorized: Invalid or missing webhook secret." });
      }
    }

    console.log("[Pluggy Webhook Receiver] Novo evento capturado no endpoint:");
    console.log(JSON.stringify(req.body, null, 2));

    // Respond 200 quickly to Pluggy, before doing heavy async processing
    res.status(200).json({ success: true, message: "Webhook received. Processing in background." });

    // Background asynchronous processing
    setImmediate(async () => {
      try {
        const { event, id, item, transactionIds, clientUserId, triggeredBy } = req.body;
        const itemId = item?.id || req.body.itemId || undefined;
        const resolvedClientId = clientUserId || item?.clientUserId || undefined;
        
        const eventId = id || `wh-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        let logStatus: "received" | "processed" | "ignored" | "failed" | "requires_user_action" | "security_mismatch" | "unmapped" = "received";
        
        let errMsg = req.body.error;
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
            logStatus = "processed";
            break;
          case "transactions/created":
          case "transactions/updated":
          case "transactions/deleted":
            logStatus = "processed";
            break;
          case "connector/status_updated":
            logStatus = "processed";
            break;
          default:
            logStatus = "received";
            break;
        }

        // Zero-Trust resolution: Who is the actual owner of this item?
        let ownerUid: string | null = null;
        let ownerUidFromIndex: string | null = null;

        if (itemId) {
          const indexDoc = await db.collection("pluggyItemIndex").doc(itemId).get();
          if (indexDoc.exists) {
            ownerUidFromIndex = indexDoc.data()?.uid || null;
          }
        }

        if (resolvedClientId && ownerUidFromIndex) {
          // Validation: If clientUserId and index map mismatch, raise security exception tag
          if (resolvedClientId !== ownerUidFromIndex) {
            console.error(`[Security Mismatch] Webhook payload clientUserId: ${resolvedClientId} does NOT match registered index owner: ${ownerUidFromIndex}`);
            logStatus = "security_mismatch";
            ownerUid = ownerUidFromIndex; // fallback lock onto original index registration
          } else {
            ownerUid = resolvedClientId;
          }
        } else if (resolvedClientId) {
          ownerUid = resolvedClientId;
        } else if (ownerUidFromIndex) {
          ownerUid = ownerUidFromIndex;
        }

        const eventLog: any = {
          id: eventId,
          event: event || "item/updated",
          itemId: itemId || null,
          transactionIds: transactionIds || null,
          clientUserId: resolvedClientId || null,
          triggeredBy: triggeredBy || null,
          receivedAt: new Date().toISOString(),
          status: logStatus,
          itemStatus: item?.status || null,
          rawBody: req.body,
          error: errMsg || null,
          ownerResolvedVia: resolvedClientId && ownerUidFromIndex ? "both" : (resolvedClientId ? "clientUserId" : (ownerUidFromIndex ? "index" : "unresolved"))
        };

        if (!ownerUid) {
          logStatus = "unmapped";
          eventLog.status = "unmapped";
          console.warn(`[Webhook Receiver] Unmapped webhook: no owner could be found for itemId: ${itemId}, clientUserId: ${resolvedClientId}`);
          await db.collection("pluggy_unmapped_webhooks").doc(eventId).set(eventLog);
        } else {
          eventLog.ownerUid = ownerUid;
          // Persist safely inside the authenticated owner's subcollection
          await db.collection("users").doc(ownerUid).collection("pluggyWebhookEvents").doc(eventId).set(eventLog);
          console.log(`[Webhook Receiver] Secure tenant log appended for uid: ${ownerUid}`);
        }

        // Add to global diagnostic feed for dev
        receivedWebhookEvents.unshift({
          ...eventLog,
          id: eventId,
          itemId: itemId || undefined,
          transactionIds: transactionIds || undefined,
          clientUserId: resolvedClientId || undefined,
          triggeredBy: triggeredBy || undefined,
          itemStatus: item?.status || undefined,
          error: errMsg || undefined
        });
        if (receivedWebhookEvents.length > 100) {
          receivedWebhookEvents.length = 100;
        }

        console.log(`[Pluggy Webhook Receiver] Evento '${event}' registrado com sucesso. Status: ${logStatus}`);
      } catch (innerErr: any) {
        console.error("[Pluggy Webhook Receiver Async Background Error]:", innerErr.message);
        try {
          const eventId = req.body.id || `wh-err-${Date.now()}`;
          await db.collection("pluggy_failed_webhook_processing").doc(eventId).set({
            id: eventId,
            error: innerErr.message,
            rawBody: req.body,
            failedAt: new Date().toISOString()
          });
        } catch (failSaveErr: any) {
          console.error("Failed to even log the background error to firestore:", failSaveErr.message);
        }
      }
    });
  });

  // 3. Sincronizar e categorizar transações bancárias do Pluggy com IA (Gemini)
  app.post("/api/pluggy/sync", requireAuth, async (req: any, res) => {
    const { categories, itemIds } = req.body;
    const uid = req.user.uid;
    const userCategories = categories || [
      'Alimentação', 'Transporte', 'Lazer', 'Saúde', 
      'Educação', 'Moradia', 'Salário', 'Investimentos',
      'Compras Online', 'Assinaturas', 'Outros'
    ];

    try {
      const { clientId, clientSecret } = await getPluggyCredentialsOrThrow(req);
      const apiKey = await PluggyService.authenticate(clientId, clientSecret);
      
      // Load user profile and index mapping to ensure ownership
      const userProfileSnap = await db.collection("users").doc(uid).get();
      const userProfileItemIds: string[] = userProfileSnap.exists ? (userProfileSnap.data()?.pluggyItemIds || []) : [];

      let items: any[] = [];
      const itemIdsList: string[] = Array.isArray(itemIds) ? itemIds.filter(Boolean) : [];

      if (itemIdsList.length > 0) {
        console.log(`[Pluggy Sync Endpoint] Realizando sync focado em ${itemIdsList.length} Item IDs fornecidos pelo cliente.`);
        // Zero-Trust: Validate each requested ID
        for (const id of itemIdsList) {
          if (userProfileItemIds.includes(id)) {
            try {
              const itemData = await PluggyService.getItem(apiKey, id);
              items.push(itemData);
            } catch (itemErr: any) {
              console.warn(`[Pluggy Sync Endpoint] Fallback para item ${id}:`, itemErr.message);
              items.push({ id, status: "UPDATED" }); 
            }
          } else {
            // Check the public index lookup
            const indexSnap = await db.collection("pluggyItemIndex").doc(id).get();
            if (indexSnap.exists && indexSnap.data()?.uid === uid) {
              try {
                const itemData = await PluggyService.getItem(apiKey, id);
                items.push(itemData);
              } catch (itemErr: any) {
                console.warn(`[Pluggy Sync Endpoint] Fallback para item ${id}:`, itemErr.message);
                items.push({ id, status: "UPDATED" }); 
              }
            } else {
              console.warn(`[Zero-Trust Guard] Blocked sync request for unauthorized itemId: ${id} by uid: ${uid}`);
              return res.status(403).json({ error: "Access Denied: You do not own this connection." });
            }
          }
        }
      } else {
        console.log(`[Pluggy Sync Endpoint] No items specified. Loading user-owned items from profile/index.`);
        // Fetch all owned items from user profile
        if (userProfileItemIds.length > 0) {
          for (const id of userProfileItemIds) {
            try {
              const itemData = await PluggyService.getItem(apiKey, id);
              items.push(itemData);
            } catch (err: any) {
              console.warn(`[Pluggy Sync Endpoint] Sunk loading user item: ${id}`, err.message);
              items.push({ id, status: "UPDATED" });
            }
          }
        } else {
          // Fetch from index
          const indexSnap = await db.collection("pluggyItemIndex").where("uid", "==", uid).get();
          if (!indexSnap.empty) {
            for (const doc of indexSnap.docs) {
              try {
                const itemData = await PluggyService.getItem(apiKey, doc.id);
                items.push(itemData);
              } catch (err: any) {
                console.warn(`[Pluggy Sync Endpoint] Sunk loading indexed item: ${doc.id}`, err.message);
                items.push({ id: doc.id, status: "UPDATED" });
              }
            }
          }
        }
      }

      console.log(`[Pluggy Sync Endpoint] Mapeados ${items.length} itens totais para sincronização direta.`);

      if (items.length === 0) {
        return res.status(200).json({ 
          ok: false,
          success: false,
          code: "PLUGGY_ITEM_ID_REQUIRED",
          message: "Credenciais Pluggy autenticadas, mas nenhuma conexão bancária foi vinculada. Adicione um Item ID manual ou conecte uma conta via Pluggy Connect."
        });
      }

      // Check for item errors or if they need reconnect
      const badItems = items.filter(it => it.status && ["LOGIN_ERROR", "OUTDATED", "NEEDS_RECONNECT"].includes(it.status));
      if (badItems.length > 0 && items.length === badItems.length) {
        // All configured items are broken and need reconnect
        return res.status(200).json({
          ok: false,
          success: false,
          code: "PLUGGY_ITEM_NOT_UPDATED",
          message: `Suas conexões (${badItems.map(it => it.id).join(', ').substring(0, 40) || ""}) reportaram status de falha (${badItems[0].status}). Reconecte as suas contas para continuar.`
        });
      }

      // Baixa contas e transações associadas
      const rawAccountsBatch = await PluggyService.syncAccounts(apiKey, items);
      const rawTransactionsBatch = await PluggyService.syncTransactions(apiKey, items, 30);
      console.log(`[Pluggy Sync Endpoint] Extraídas ${rawAccountsBatch.length} contas e ${rawTransactionsBatch.length} transações brutas para processamento com IA.`);

      if (rawTransactionsBatch.length === 0) {
        return res.json({ 
          success: true, 
          ok: true, 
          transactions: [], 
          accounts: rawAccountsBatch,
          message: "Sincronização OK! Nenhuma movimentação bancária foi identificada nos últimos 30 dias de extrato. Saldos de contas atualizados." 
        });
      }

      // 1. Process EVERY transaction using modern local recognition engine
      const userLearnedRules: LearnedRule[] = req.body.learnedRules || [];
      const userHistoryInput = req.body.userHistory || req.body.history || [];

      // Translate learned rules to the new format
      const transformedRules: UserRecognitionRule[] = userLearnedRules.map((lr, idx) => ({
        id: lr.id || `learnt-${lr.merchantKey}-${idx}`,
        userId: lr.userId,
        name: `Aprendizado: ${lr.merchantKey}`,
        enabled: true,
        priority: 1000 + idx,
        scope: 'all',
        conditions: [
          { field: 'merchantKey', operator: 'equals', value: lr.merchantKey }
        ],
        actions: [
          { type: 'setCategory', value: lr.category },
          { type: 'setDescription', value: lr.cleanDescription },
          { type: 'setType', value: lr.type }
        ],
        stopProcessing: true,
        createdAt: lr.createdAt,
        updatedAt: lr.updatedAt,
        usageCount: 0
      }));

      // Map raw inputs and run recognition
      const localResults = rawTransactionsBatch.map(tx => {
        const rawInput: NewRawInput = {
          description: tx.desc,
          amount: tx.amount,
          operationType: tx.operationType,
          mcc: (tx as any).mcc || null,
          cnpj: (tx as any).cnpj || null,
          merchant: tx.merchantName || null,
          detectedDirection: tx.detectedDirection,
          pluggyId: tx.pluggyId
        };
        const recognized = runLocalRecognition(rawInput, transformedRules, userHistoryInput, userCategories);
        return {
          tx,
          recognized
        };
      });

      // Split into high confidence (local) and low confidence (needing AI)
      // Confidences lower than REVIEW_OR_AI (0.60) will trigger AI fallback
      const highConfidenceList = localResults.filter(r => r.recognized.confidence >= REVIEW_OR_AI);
      const lowConfidenceList = localResults.filter(r => r.recognized.confidence < REVIEW_OR_AI);

      console.log(`[Pluggy Sync Local Engine V2] Local recognition completed:`);
      console.log(`  - High Confidence (>= ${REVIEW_OR_AI}): ${highConfidenceList.length}`);
      console.log(`  - Low Confidence (< ${REVIEW_OR_AI}) [Triggers AI Fallback]: ${lowConfidenceList.length}`);

      let geminiMapped: Record<string, { cat: string; desc: string }> = {};

      let aiEnabled = false;
      let aiUseForCategoryFallback = false;
      try {
        const settingsDoc = await db.collection("users").doc(uid).collection("settings").doc("ai").get();
        if (settingsDoc.exists) {
          const sData = settingsDoc.data() || {};
          aiEnabled = sData.aiEnabled ?? false;
          aiUseForCategoryFallback = sData.aiUseForCategoryFallback ?? false;
        } else {
          const defaults = getDefaultAISettings();
          aiEnabled = defaults.aiEnabled;
          aiUseForCategoryFallback = defaults.aiUseForCategoryFallback;
        }
      } catch (err: any) {
        console.warn("[Pluggy Sync AI check] Failed to fetch settings, assuming false:", err.message);
      }

      const aiAllowed = aiEnabled && aiUseForCategoryFallback;

      if (lowConfidenceList.length > 0 && aiAllowed) {
        console.log(`[Pluggy Sync AI Fallback] Sending ${lowConfidenceList.length} transactions to AI fallback process...`);
        const promptSystem = `Você é um excelente assistente financeiro de elite brasileiro. Algumas transações com baixa confiança local precisam de classificação e pós-processamento. Mapeie-as para estas categorias válidas: ${JSON.stringify(userCategories)}.
Você NÃO PODE alterar o tipo da transação ou direção financeira. A direção financeira já foi calculada heuristicamente e está correta em 'detectedDirection' ('Receita' ou 'Despesa').

Lançamentos a classificar:
${JSON.stringify(lowConfidenceList.map(r => ({
  pluggyId: r.tx.pluggyId,
  description: r.tx.desc,
  originalCategory: r.tx.originalCategory || '',
  merchantName: r.tx.merchantName || '',
  detectedDirection: r.tx.detectedDirection,
  amount: r.tx.amount
})), null, 2)}

Retorne OBRIGATORIAMENTE um array JSON no formato: [{"pluggyId": "...", "cat": "...", "desc": "..."}]. Não adicione textos adicionais fora do JSON.`;

        try {
          const result = await processAIGenerateRequest(uid, {
            task: "categoryFallback",
            contents: promptSystem,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    pluggyId: { type: "STRING" },
                    cat: { type: "STRING" },
                    desc: { type: "STRING" }
                  },
                  required: ["pluggyId", "cat", "desc"]
                }
              }
            }
          });

          if (result.status === 200 && result.successResponse?.text) {
            const geminiText = result.successResponse.text || "[]";
            const parsedGemini = JSON.parse(geminiText) as any[];
            for (const item of parsedGemini) {
              geminiMapped[item.pluggyId] = {
                cat: item.cat,
                desc: item.desc
              };
            }
            console.log(`[Pluggy Sync AI Fallback] AI successfully categorized ${parsedGemini.length} transactions via provider ${result.successResponse.provider}.`);
          } else {
            console.warn("[Pluggy Sync AI Fallback] AI fallback was bypassed/disabled:", result.errorResponse?.error || result.errorResponse?.message);
          }
        } catch (aiError: any) {
          console.error("[Pluggy Sync AI Fallback Error]: AI request failed. Reverting to local heuristic fallback.", aiError?.message || aiError);
        }
      }

      // Compute precise statistics
      let userRulesCount = 0;
      let descriptionMatchCount = 0;
      let merchantRulesCount = 0;
      let mccCount = 0;
      let pluggyCategoryCount = 0;
      let operationTypeCount = 0;
      let localAutoCount = 0;
      let localProbableCount = 0;
      let aiFallbackCount = 0;
      let needsReviewCount = 0;
      let internalTransfersCount = 0;
      let ignoredInTotalsCount = 0;

      // Build the final compiled list
      const categorizedList = localResults.map(r => {
        const tx = r.tx;
        const localRec = r.recognized;
        const aiMatch = geminiMapped[tx.pluggyId];

        // Format Date
        let dateStr = "";
        try {
          const d = new Date(tx.date);
          const dd = String(d.getDate()).padStart(2, '0');
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const yyyy = d.getFullYear();
          dateStr = `${dd}/${mm}/${yyyy}`;
        } catch(e) {
          dateStr = tx.date;
        }

        // Final values resolved either from Gemini (if low confidence & succeeded) or from local recognition
        let finalCat = localRec.category;
        let finalDesc = localRec.cleanDescription;

        // Statistics accounting
        if (localRec.isLikelyInternalTransfer) {
          internalTransfersCount++;
        }
        if (localRec.shouldIgnoreInTotals) {
          ignoredInTotalsCount++;
        }

        if (localRec.method === 'USER_RULE') {
          userRulesCount++;
        } else if (localRec.method === 'DESCRIPTION_MATCH') {
          descriptionMatchCount++;
        } else if (localRec.method === 'MERCHANT_CNPJ' || localRec.method === 'MERCHANT_ALIAS') {
          merchantRulesCount++;
        } else if (localRec.method === 'MCC') {
          mccCount++;
        } else if (localRec.method === 'PLUGGY_CATEGORY') {
          pluggyCategoryCount++;
        } else if (localRec.method === 'OPERATION_TYPE') {
          operationTypeCount++;
        }

        // Check categorisation source
        let isAiApplied = false;
        let finalConfidence = localRec.confidence;
        let finalEvidence = [...localRec.evidence];
        let isCurrentlyReviewed = false;

        if (aiMatch) {
          isAiApplied = true;
          aiFallbackCount++;
          finalConfidence = 0.75; // IA fallback maximum confidence is 0.75
          finalDesc = aiMatch.desc || finalDesc;

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
            isCurrentlyReviewed = true; // Se a categoria da IA for nova/não mapeável, manter needsReview = true
            finalEvidence = ["Sugerido por Inteligência Artificial (Gemini Fallback) - Categoria sugerida não existe no perfil de categorias cadastas do usuário."];
          }
        } else {
          // Local stats breakdown
          if (localRec.confidence >= AUTO_ACCEPT) {
            localAutoCount++;
          } else if (localRec.confidence >= ACCEPT_WITH_BADGE) {
            localProbableCount++;
          }
          const isLowConfidence = localRec.confidence < REVIEW_OR_AI;
          isCurrentlyReviewed = localRec.needsReview || localRec.method === 'REVIEW_REQUIRED' || finalConfidence < ACCEPT_WITH_BADGE || isLowConfidence;
        }

        if (isCurrentlyReviewed) {
          needsReviewCount++;
        }

        const finalMethod = isAiApplied ? 'AI_FALLBACK' : localRec.method;

        return {
          pluggyId: tx.pluggyId,
          date: dateStr,
          desc: finalDesc,
          cat: finalCat,
          type: tx.detectedDirection,
          amount: tx.amount,
          source: tx.source,
          rawAmount: tx.rawAmount,
          sourceRaw: tx.sourceRaw,
          bankRawName: tx.bankRawName,
          accountLabel: tx.accountLabel,
          accountId: tx.accountId,
          itemId: tx.itemId,
          pluggyType: tx.pluggyType,
          accountType: tx.accountType,
          accountSubtype: tx.accountSubtype,
          operationType: tx.operationType,
          paymentData: tx.paymentData,
          merchant: tx.merchantName,
          detectedDirection: tx.detectedDirection,
          directionConfidence: finalConfidence,
          directionReason: finalEvidence.join(' | '),
          
          // Modern recognition parameters
          recognitionConfidence: finalConfidence,
          recognitionMethod: finalMethod,
          recognitionEvidence: finalEvidence,
          needsReview: isCurrentlyReviewed,
          aiUsed: isAiApplied,
          merchantKey: localRec.merchantKey,
          cleanDescription: finalDesc,
          isLikelyInternalTransfer: localRec.isLikelyInternalTransfer,
          shouldIgnoreInTotals: localRec.shouldIgnoreInTotals
        };
      });

      const recognitionStats = {
        total: rawTransactionsBatch.length,
        localAuto: localAutoCount,
        localProbable: localProbableCount,
        aiFallback: aiFallbackCount,
        needsReview: needsReviewCount,
        userRules: userRulesCount,
        descriptionMatch: descriptionMatchCount,
        merchantRules: merchantRulesCount,
        mcc: mccCount,
        pluggyCategory: pluggyCategoryCount,
        operationType: operationTypeCount,
        internalTransfers: internalTransfersCount,
        ignoredInTotals: ignoredInTotalsCount
      };

      res.json({ 
        success: true, 
        ok: true, 
        transactions: categorizedList, 
        accounts: rawAccountsBatch,
        recognitionStats
      });
    } catch (err: any) {
      console.error("[Pluggy sync HTTP Router Error]:", err.message);
      res.status(err.code === "PLUGGY_CREDENTIALS_MISSING" ? 428 : 500).json({ 
        ok: false,
        success: false, 
        error: err.message, 
        code: err.code || "PLUGGY_SYNC_FAILED" 
      });
    }
  });

  // --- SECURE MULTI-PROVIDER AI BACKEND ENDPOINTS (FASE 3) ---

  async function processAIGenerateRequest(uid: string, body: any): Promise<{ status: number; errorResponse?: { error: string; message: string }; successResponse?: any }> {
    const { task, model, contents, config } = body;
    const resolvedTask = task || 'general';

    const validTasks = ['ocr', 'categoryFallback', 'insight', 'report', 'general'];
    if (!validTasks.includes(resolvedTask)) {
      return {
        status: 400,
        errorResponse: { error: "AI_INVALID_TASK", message: "Tarefa de IA inválida ou não especificada." }
      };
    }

    // Load settings safely from backend repository
    const settings = await getAISettings(uid);

    if (!settings.aiEnabled) {
      return {
        status: 403,
        errorResponse: { error: "AI_DISABLED", message: "A funcionalidade de Inteligência Artificial está desabilitada." }
      };
    }

    // Check task specific permissions
    if (resolvedTask === 'ocr' && !settings.aiUseForOCR) {
      return {
        status: 403,
        errorResponse: { error: "AI_OCR_DISABLED", message: "A tarefa de OCR via IA está desabilitada." }
      };
    }
    if (resolvedTask === 'categoryFallback' && !settings.aiUseForCategoryFallback) {
      return {
        status: 403,
        errorResponse: { error: "AI_CATEGORY_FALLBACK_DISABLED", message: "O fallback de categoria via IA está desabilitado." }
      };
    }
    if (resolvedTask === 'insight' && !settings.aiUseForInsights) {
      return {
        status: 403,
        errorResponse: { error: "AI_INSIGHTS_DISABLED", message: "Insights automáticos via IA estão desabilitados." }
      };
    }
    if (resolvedTask === 'report' && !settings.aiUseForReports) {
      return {
        status: 403,
        errorResponse: { error: "AI_REPORTS_DISABLED", message: "Relatórios assistidos via IA estão desabilitados." }
      };
    }

    // Load secret safely from repository
    const secretData = await getAISecret(uid);

    const isOllamaLocal = settings.provider === "ollama" && isLocalBaseUrl(settings.baseUrl || "");

    if (!isOllamaLocal && !secretData) {
      return {
        status: 428,
        errorResponse: { error: "AI_CREDENTIALS_MISSING", message: "Credenciais de IA ausentes ou inválidas." }
      };
    }

    if (secretData) {
      if (secretData.provider !== settings.provider) {
        return {
          status: 400,
          errorResponse: { error: "AI_PROVIDER_SECRET_MISMATCH", message: "O provedor selecionado não corresponde à credencial de IA salva." }
        };
      }
    }

    const finalApiKey = secretData?.apiKey;
    const finalBaseUrl = settings.baseUrl;

    const validation = validateProviderConnectionConfig(
      settings.provider,
      finalBaseUrl,
      finalApiKey,
      process.env.NODE_ENV || "development"
    );

    if (!validation.isValid) {
      return {
        status: 428,
        errorResponse: { error: "AI_CREDENTIALS_MISSING", message: validation.error || "A configuração de IA é inválida." }
      };
    }

    const response = await generateAIContent({
      provider: settings.provider,
      apiKey: finalApiKey,
      baseUrl: finalBaseUrl,
      model: model || settings.model || getDefaultModel(settings.provider),
      task: resolvedTask,
      contents,
      config
    });

    return {
      status: 200,
      successResponse: {
        text: response.text,
        provider: response.provider,
        model: response.model
      }
    };
  }

  // POST /api/ai/generate
  app.post("/api/ai/generate", requireAuth, async (req, res) => {
    const uid = (req as any).user.uid;
    try {
      const result = await processAIGenerateRequest(uid, req.body);
      if (result.errorResponse) {
        return res.status(result.status).json(result.errorResponse);
      }
      return res.status(result.status).json(result.successResponse);
    } catch (err: any) {
      console.error("[POST /api/ai/generate error]:", err.message);
      if (err.message === "FIRESTORE_UNAVAILABLE") {
        return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE", message: "O repositório do Firestore está indisponível." });
      }
      const details = process.env.NODE_ENV !== "production" ? err.message : undefined;
      return res.status(500).json({ error: "Erro interno no servidor de IA.", ...(details && { details }) });
    }
  });

  // --- SECURE MULTI-PROVIDER AI BACKEND ENDPOINTS (FASE 3) ---

  // 1. POST /api/ai/credentials/save
  app.post("/api/ai/credentials/save", requireAuth, async (req, res) => {
    const uid = (req as any).user.uid;
    let { provider, apiKey, baseUrl, model } = req.body;

    if (!isValidProvider(provider)) {
      return res.status(400).json({ error: "Provedor de IA inválido." });
    }

    try {
      const savedData = await getAISecret(uid);

      if (!apiKey && savedData && savedData.provider === provider) {
        apiKey = savedData.apiKey;
      }

      const validation = validateProviderConnectionConfig(
        provider,
        baseUrl,
        apiKey,
        process.env.NODE_ENV || "development"
      );

      if (!validation.isValid) {
        return res.status(400).json({ error: validation.error || "Configuração inválida de IA." });
      }

      const keyMasked = maskApiKey(apiKey || "");

      const dataToSave = {
        provider,
        apiKey: apiKey || "",
        keyMasked,
        baseUrl: baseUrl || "",
        model: model || getDefaultModel(provider)
      };

      await saveAISecret(uid, dataToSave);

      // Retornar apenas informações não-sensíveis
      return res.json({
        configured: true,
        provider,
        keyMasked,
        model: dataToSave.model,
        baseUrl: dataToSave.baseUrl
      });
    } catch (err: any) {
      console.error("[POST /api/ai/credentials/save error]:", err.message);
      if (err.message === "FIRESTORE_UNAVAILABLE") {
        return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE", message: "O banco de dados Firestore está indisponível." });
      }
      return res.status(500).json({ error: "Erro interno ao salvar credenciais de IA." });
    }
  });

  // 2. GET /api/ai/credentials/status
  app.get("/api/ai/credentials/status", requireAuth, async (req, res) => {
    const uid = (req as any).user.uid;
    try {
      const secretData = await getAISecret(uid);
      const settings = await getAISettings(uid);

      if (!secretData) {
        return res.json({
          configured: false,
          settings
        });
      }

      return res.json({
        configured: true,
        provider: secretData.provider,
        keyMasked: secretData.keyMasked,
        model: secretData.model,
        baseUrl: secretData.baseUrl,
        settings
      });
    } catch (err: any) {
      console.error("[GET /api/ai/credentials/status error]:", err.message);
      if (err.message === "FIRESTORE_UNAVAILABLE") {
        return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE", message: "O banco de dados Firestore está indisponível." });
      }
      return res.status(500).json({ error: "Erro interno ao consultar status de IA." });
    }
  });

  // 3. DELETE /api/ai/credentials/delete
  app.delete("/api/ai/credentials/delete", requireAuth, async (req, res) => {
    const uid = (req as any).user.uid;
    try {
      await deleteAISecret(uid);
      return res.json({
        success: true,
        message: "Configuração de IA removida com sucesso e IA desativada."
      });
    } catch (err: any) {
      console.error("[DELETE /api/ai/credentials/delete error]:", err.message);
      if (err.message === "FIRESTORE_UNAVAILABLE") {
        return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE", message: "O banco de dados Firestore está indisponível." });
      }
      return res.status(500).json({ error: "Erro interno ao excluir credenciais." });
    }
  });

  function parseAIProviderTestTimeoutMs(): number {
    const envVal = process.env.AI_PROVIDER_TEST_TIMEOUT_MS;
    if (envVal) {
      const parsed = parseInt(envVal, 10);
      if (!isNaN(parsed) && parsed >= 3000 && parsed <= 60000) {
        return parsed;
      }
    }
    return 15000; // default 15 seconds
  }

  // 4. POST /api/ai/credentials/test
  app.post("/api/ai/credentials/test", requireAuth, async (req, res) => {
    const uid = (req as any).user.uid;
    let { provider, apiKey, baseUrl, model } = req.body;

    try {
      const savedData = await getAISecret(uid);

      if (!provider) {
        if (!savedData) {
          return res.status(400).json({
            success: false,
            code: "AI_CREDENTIALS_MISSING",
            message: "Nenhuma credencial de IA configurada para teste."
          });
        }
        provider = savedData.provider;
        apiKey = savedData.apiKey;
        baseUrl = savedData.baseUrl;
        model = savedData.model;
      } else {
        if (!apiKey && savedData && savedData.provider === provider) {
          apiKey = savedData.apiKey;
        }
      }

      // Check if provider is valid
      if (!isValidProvider(provider)) {
        return res.json({
          success: false,
          code: "AI_PROVIDER_INVALID",
          message: "Provedor de IA inválido."
        });
      }

      const validation = validateProviderConnectionConfig(
        provider,
        baseUrl,
        apiKey,
        process.env.NODE_ENV || "development"
      );

      if (!validation.isValid) {
        return res.json({
          success: false,
          code: "AI_CREDENTIALS_INVALID",
          provider,
          model,
          message: validation.error || "Validação da configuração de conexão falhou."
        });
      }

      const timeoutMs = parseAIProviderTestTimeoutMs();
      const testModel = model || getDefaultModel(provider);

      // Safe lightweight test using generating content raced with a timeout
      const response = await Promise.race([
        generateAIContent({
          provider,
          apiKey,
          baseUrl,
          model: testModel,
          task: "general",
          contents: "Teste de conexão de API para FINCANVAS. Responda simulando canal operacional.",
          config: { temperature: 0.1 }
        }),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error("AI_PROVIDER_TIMEOUT")), timeoutMs)
        )
      ]);

      return res.json({
        success: true,
        provider,
        model: testModel,
        message: response.text || "Teste concluído de forma bem-sucedida."
      });
    } catch (err: any) {
      console.error("[POST /api/ai/credentials/test error]:", err.message);

      if (err.message === "FIRESTORE_UNAVAILABLE") {
        return res.status(503).json({
          error: "FIRESTORE_UNAVAILABLE",
          message: "O banco de dados Firestore está indisponível para carregar credenciais necessárias para teste."
        });
      }

      const normalized = normalizeAIProviderError(err, provider, model);
      return res.json({
        success: false,
        code: normalized.code,
        provider,
        model,
        message: normalized.message
      });
    }
  });

  // 5. GET /api/ai/settings
  app.get("/api/ai/settings", requireAuth, async (req, res) => {
    const uid = (req as any).user.uid;
    try {
      const settings = await getAISettings(uid);
      return res.json(settings);
    } catch (err: any) {
      console.error("[GET /api/ai/settings error]:", err.message);
      if (err.message === "FIRESTORE_UNAVAILABLE") {
        return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE", message: "O banco de dados Firestore está indisponível." });
      }
      return res.status(500).json({ error: "Erro interno ao buscar preferências de IA." });
    }
  });

  // 6. POST /api/ai/settings
  app.post("/api/ai/settings", requireAuth, async (req, res) => {
    const uid = (req as any).user.uid;
    const {
      aiEnabled,
      provider,
      model,
      baseUrl,
      aiUseForOCR,
      aiUseForCategoryFallback,
      aiUseForInsights,
      aiUseForReports,
      aiAlwaysAskBeforeSending
    } = req.body;

    if (!isValidProvider(provider)) {
      return res.status(400).json({ error: "Provedor de IA inválido." });
    }

    if (model && (typeof model !== "string" || model.length > 256)) {
      return res.status(400).json({ error: "Modelo inválido ou muito longo." });
    }

    if (baseUrl && (typeof baseUrl !== "string" || baseUrl.length > 2048)) {
      return res.status(400).json({ error: "Base URL inválida ou muito longa." });
    }

    const booleanFields = {
      aiEnabled,
      aiUseForOCR,
      aiUseForCategoryFallback,
      aiUseForInsights,
      aiUseForReports,
      aiAlwaysAskBeforeSending
    };

    for (const [key, val] of Object.entries(booleanFields)) {
      if (val !== undefined && typeof val !== "boolean") {
        return res.status(400).json({ error: `O campo ${key} deve ser um valor booleano.` });
      }
    }

    try {
      let finalModel = model;
      let finalBaseUrl = baseUrl;

      if (aiEnabled === true) {
        const secretData = await getAISecret(uid);

        const checkBaseUrl = (baseUrl !== undefined ? baseUrl : (secretData?.baseUrl || "")) || "";
        const isOllamaLocal = provider === "ollama" && isLocalBaseUrl(checkBaseUrl);

        if (!isOllamaLocal && !secretData) {
          return res.status(400).json({ error: "Não é possível ativar a IA sem credenciais configuradas." });
        }

        if (secretData) {
          if (secretData.provider !== provider) {
            return res.status(400).json({
              error: "AI_PROVIDER_SECRET_MISMATCH",
              message: "O provedor selecionado não corresponde à credencial de IA salva."
            });
          }
        }

        finalModel = model || secretData?.model || getDefaultModel(provider);
        finalBaseUrl = (baseUrl !== undefined ? baseUrl : (secretData?.baseUrl || "")) || "";

        const validation = validateProviderConnectionConfig(
          provider,
          finalBaseUrl,
          secretData?.apiKey,
          process.env.NODE_ENV || "development"
        );

        if (!validation.isValid) {
          return res.status(400).json({ error: validation.error || "A configuração de IA é inválida." });
        }
      } else {
        finalModel = model || getDefaultModel(provider);
        finalBaseUrl = baseUrl || "";
      }

      const settingsToSave = {
        aiEnabled: !!aiEnabled,
        provider,
        model: finalModel,
        baseUrl: finalBaseUrl,
        aiUseForOCR: !!aiUseForOCR,
        aiUseForCategoryFallback: !!aiUseForCategoryFallback,
        aiUseForInsights: !!aiUseForInsights,
        aiUseForReports: !!aiUseForReports,
        aiAlwaysAskBeforeSending: aiAlwaysAskBeforeSending !== false
      };

      await saveAISettings(uid, settingsToSave);

      return res.json({
        success: true,
        settings: settingsToSave
      });
    } catch (err: any) {
      console.error("[POST /api/ai/settings error]:", err.message);
      if (err.message === "FIRESTORE_UNAVAILABLE") {
        return res.status(503).json({ error: "FIRESTORE_UNAVAILABLE", message: "O banco de dados Firestore está indisponível." });
      }
      return res.status(500).json({ error: "Erro interno ao atualizar preferências de IA." });
    }
  });

  // Secure server-side endpoint for Gemini requests (DEPRECATED: Use /api/ai/generate instead)
  app.post("/api/gemini", requireAuth, async (req, res) => {
    const uid = (req as any).user.uid;
    try {
      const result = await processAIGenerateRequest(uid, req.body);
      if (result.errorResponse) {
        return res.status(result.status).json(result.errorResponse);
      }
      return res.status(result.status).json({
        ...result.successResponse,
        deprecated: true
      });
    } catch (err: any) {
      console.error("[POST /api/gemini error]:", err.message);
      return res.status(500).json({ error: "Erro interno no servidor de IA." });
    }
  });

  // Vite middleware in non-production, static serving in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      if (req.path.startsWith("/api/")) {
        return res.status(404).json({ error: `API endpoint não encontrado: ${req.path}` });
      }
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Global express error handler for robust JSON error reporting
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Global Server Error Caught:", err);
    res.status(500).json({ error: err.message || "Ocorreu um erro interno de processamento no servidor." });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express server running on port ${PORT}`);
  });
}

const isMainFile = () => {
  if (!process.argv[1]) return false;
  const mainPath = process.argv[1].replace(/\\/g, '/');
  return mainPath.endsWith("server.ts") || mainPath.endsWith("server.js") || mainPath.endsWith("server.cjs");
};

if (isMainFile()) {
  startServer().catch((err) => {
    console.error("Failed to start server:", err);
  });
}
