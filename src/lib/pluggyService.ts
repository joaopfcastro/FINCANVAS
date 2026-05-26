import { GoogleGenAI } from "@google/genai";
import { 
  normalizeInstitutionName, 
  classifyPluggyDirection, 
  buildAccountLabel 
} from "./pluggyNormalizer";

export interface PluggyTransaction {
  pluggyId: string;
  accountId: string;
  itemId: string;

  date: string;
  desc: string;
  descriptionRaw?: string;

  rawAmount: number;
  amount: number;

  pluggyType?: string;
  accountType?: string;
  accountSubtype?: string;

  operationType?: string | null;
  originalCategory?: string | null;

  merchantName?: string | null;
  merchantBusinessName?: string | null;

  bankRawName: string;
  accountRawName: string;
  sourceRaw: string;
  source: string;
  accountLabel?: string;

  detectedDirection: "Despesa" | "Receita";
  directionConfidence: number;
  directionReason: string;

  isLikelyInternalTransfer?: boolean;
  shouldIgnoreInTotals?: boolean;
  paymentData?: any;
}

export interface PluggyItem {
  id: string;
  status: string;
  connector?: {
    id: number;
    name: string;
    imageUrl?: string;
  };
  provider?: {
    id: number;
    name: string;
    imageUrl?: string;
  };
}

export class PluggyService {
  private static BASE_URL = "https://api.pluggy.ai";

  /**
   * Safely sanitize input keys
   */
  private static sanitize(val: string): string {
    return (val || "")
      .trim()
      .replace(/^['"]|['"]$/g, "") // strip leading/trailing quotes
      .replace(/[\r\n\t\s]/g, "");
  }

  /**
   * Helper to build clean headers for authenticated API requests
   */
  private static getHeaders(apiKey: string, contentType = "application/json"): HeadersInit {
    const cleanKey = this.sanitize(apiKey);
    const headers: Record<string, string> = {
      "X-API-KEY": cleanKey
    };
    if (contentType) {
      headers["Content-Type"] = contentType;
    }
    return headers;
  }

  /**
   * Helper for raw API requests with improved timeout and error extraction
   */
  private static async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.BASE_URL}${endpoint}`;
    console.log(`[PluggyService API] requesting GET/POST ${url}...`);

    let response: Response;
    try {
      response = await fetch(url, options);
    } catch (netErr: any) {
      console.error(`[PluggyService API] Sockets or Connection aborted relative to ${url}`, netErr);
      throw new Error(`Falha física na rede. Não foi possível conectar ao servidor da Pluggy (${url}). Detalhes: ${netErr.message || netErr}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
      if (contentType.includes("application/json")) {
        const errObj = await response.json().catch(() => ({}));
        console.error(`[PluggyService API] HTTP ${response.status} Error on ${endpoint}:`, errObj);
        throw new Error(errObj.message || errObj.error || `Erro de requisição (Status HTTP ${response.status}) da API.`);
      } else {
        const text = await response.text().catch(() => "");
        console.error(`[PluggyService API] Non-JSON HTTP ${response.status} on ${endpoint}:`, text);
        throw new Error(`Erro insolúvel na API (Status HTTP ${response.status}). Detalhes: ${text.substring(0, 200)}`);
      }
    }

    if (!contentType.includes("application/json")) {
      const txt = await response.text().catch(() => "");
      throw new Error(`A Pluggy retornou formato inesperado não-JSON. Detalhes: ${txt.substring(0, 150)}`);
    }

    return response.json();
  }

  /**
   * Performs authentication to exchange API keys
   */
  public static async authenticate(clientId: string, clientSecret: string): Promise<string> {
    const cleanId = this.sanitize(clientId);
    const cleanSecret = this.sanitize(clientSecret);

    if (!cleanId || !cleanSecret) {
      throw new Error("Credenciais inválidas: Client ID e Client Secret são campos obrigatórios.");
    }

    console.log(`[PluggyService Auth] Handshake com clientId: ${cleanId.substring(0, 8)}...`);
    try {
      const response = await this.request("/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: cleanId, clientSecret: cleanSecret }),
      });

      const apiKey = response?.apiKey || response?.api_key || response?.token || response?.accessToken;
      if (!apiKey) {
        console.error("[PluggyService Auth] Formato desconhecido no retorno de /auth:", response);
        throw new Error("Handshake obtido mas nenhuma chave de autenticação ('apiKey') foi identificada no objeto.");
      }

      console.log("[PluggyService Auth] Chave de API extraída e ativada com sucesso!");
      return apiKey;
    } catch (error: any) {
      if (error.message.includes("401") || error.message.toLowerCase().includes("credentials")) {
        throw new Error("Chaves rejeitadas: O Client ID ou o Client Secret inseridos não foram aceitos pela API do Pluggy.");
      }
      throw error;
    }
  }

  /**
   * Retrieves active linked connection items
   */
  public static async listItems(apiKey: string): Promise<PluggyItem[]> {
    console.log("[PluggyService] Listando itens ativos...");
    const response = await this.request("/items", {
      headers: this.getHeaders(apiKey, ""),
    });
    return response.results || [];
  }

  /**
   * Retrieves a single connection item by ID
   */
  public static async getItem(apiKey: string, itemId: string): Promise<PluggyItem> {
    console.log(`[PluggyService] Recuperando detalhes do item ${itemId}...`);
    const cleanId = this.sanitize(itemId);
    return this.request(`/items/${cleanId}`, {
      headers: this.getHeaders(apiKey, ""),
    });
  }

  /**
   * Disconnects and deletes an item consent from Pluggy
   */
  public static async deleteItem(apiKey: string, itemId: string): Promise<void> {
    console.log(`[PluggyService] Removendo item ${itemId}...`);
    await this.request(`/items/${itemId}`, {
      method: "DELETE",
      headers: this.getHeaders(apiKey, ""),
    });
  }

  /**
   * Creates an Itaú Sandbox simulated test connection
   */
  public static async createSandbox(apiKey: string, connectorId = 2): Promise<any> {
    console.log(`[PluggyService] Provisionando Sandbox conectando ao ID ${connectorId}...`);
    return this.request("/items", {
      method: "POST",
      headers: this.getHeaders(apiKey, "application/json"),
      body: JSON.stringify({
        connectorId: Number(connectorId),
        parameters: {
          user: "user-ok",
          password: "password-ok",
        },
      }),
    });
  }

  /**
   * Generates a Connect Token for initiating Pluggy Connect Widget
   */
  public static async createConnectToken(apiKey: string, clientUserId?: string, itemId?: string): Promise<any> {
    console.log(`[PluggyService] Gerando Connect Token...`);
    const payload: any = {
      options: {
        clientUserId: clientUserId || "fincanvas-user",
        avoidDuplicates: true,
      }
    };
    if (itemId) {
      payload.itemId = this.sanitize(itemId);
    }

    return this.request("/connect_token", {
      method: "POST",
      headers: this.getHeaders(apiKey, "application/json"),
      body: JSON.stringify(payload),
    });
  }

  /**
   * Helper to list all transactions for an account using pagination
   */
  private static async listAllTransactions(apiKey: string, accountId: string, dateFrom: string, dateTo: string): Promise<any[]> {
    const all: any[] = [];
    let after: string | undefined;

    do {
      const params = new URLSearchParams({
        accountId,
        dateFrom,
        dateTo
      });

      if (after) {
        params.set("after", after);
      }

      console.log(`[PluggyService Sync] Lendo transações (/v2/transactions) com cursor '${after || "início"}'...`);
      const response = await this.request(`/v2/transactions?${params.toString()}`, {
        headers: this.getHeaders(apiKey, ""),
      });

      const results = response.results ?? response.data ?? [];
      all.push(...results);

      // Extract cursor for next page if present
      after = response.next ?? response.after ?? response.pagination?.next ?? response.cursor?.after;
    } while (after);

    return all;
  }

  /**
   * Performs deep nested retrieval of all accounts and transactions corresponding to items
   */
  public static async syncTransactions(apiKey: string, itemsList: PluggyItem[], daysBack = 30): Promise<PluggyTransaction[]> {
    console.log(`[PluggyService Sync] Iniciando varredura profunda de transações dos últimos ${daysBack} dias.`);
    
    const results: PluggyTransaction[] = [];
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - daysBack);
    const fromStr = fromDate.toISOString().split("T")[0]; // YYYY-MM-DD
    
    const toDate = new Date();
    const toStr = toDate.toISOString().split("T")[0]; // YYYY-MM-DD

    for (const item of itemsList) {
      if (!item || !item.id) continue;
      const itemTitle = item.connector?.name || item.provider?.name || `Item ${item.id}`;
      console.log(`[PluggyService Sync] Lendo contas associadas ao item: ${itemTitle} (${item.id})`);
      
      let accounts: any[] = [];
      try {
        const accountsData = await this.request(`/accounts?itemId=${item.id}`, {
          headers: this.getHeaders(apiKey, ""),
        });
        accounts = accountsData.results || [];
        console.log(`[PluggyService Sync] Localizadas ${accounts.length} contas para o item ${item.id}`);
      } catch (accError: any) {
        console.warn(`[PluggyService Sync] Erro não-bloqueante ao carregar contas do item ${item.id}:`, accError.message || accError);
        continue; // Continua para o próximo item
      }

      for (const account of accounts) {
        if (!account || !account.id) continue;
        console.log(`[PluggyService Sync] Consultando transações para a conta: ${account.name} (tipo: ${account.type})`);
        try {
          const rawList = await this.listAllTransactions(apiKey, account.id, fromStr, toStr);
          console.log(`[PluggyService Sync] Extraídas ${rawList.length} transações brutas paginadas para a conta ${account.name}`);

          for (const tx of rawList) {
            const institution = normalizeInstitutionName({
              connectorName: item.connector?.name,
              providerName: item.provider?.name,
              itemName: itemTitle,
              accountName: account.name,
              marketingName: account.marketingName,
            });

            const direction = classifyPluggyDirection({
              amount: tx.amount,
              pluggyType: tx.type,
              accountType: account.type,
              accountSubtype: account.subtype,
              description: tx.description,
              operationType: tx.operationType,
              originalCategory: tx.category,
              paymentData: tx.paymentData,
            });

            results.push({
              pluggyId: tx.id,
              accountId: account.id,
              itemId: item.id,

              date: tx.date,
              desc: tx.description,
              descriptionRaw: tx.descriptionRaw || tx.description,

              rawAmount: tx.amount,
              amount: direction.normalizedAmount,

              pluggyType: tx.type,
              accountType: account.type,
              accountSubtype: account.subtype,

              operationType: tx.operationType || null,
              originalCategory: tx.category || null,

              merchantName: tx.merchant?.name || null,
              merchantBusinessName: tx.merchant?.businessName || null,

              bankRawName: institution.bankRawName,
              accountRawName: account.name,
              sourceRaw: institution.sourceRaw,
              source: institution.source,

              accountLabel: buildAccountLabel(account),

              detectedDirection: direction.detectedDirection,
              directionConfidence: direction.confidence,
              directionReason: direction.reason,

              isLikelyInternalTransfer: direction.isLikelyInternalTransfer,
              shouldIgnoreInTotals: direction.shouldIgnoreInTotals,
            });
          }
        } catch (txError: any) {
          console.warn(`[PluggyService Sync] Falha ao listar transações da conta ${account.id}:`, txError.message || txError);
          // Continua para a próxima conta
        }
      }
    }

    return results;
  }

  /**
   * Lists all active Webhooks registered on this Pluggy credentials account
   */
  public static async listWebhooks(apiKey: string): Promise<any[]> {
    console.log("[PluggyService] Listando webhooks ativos no Pluggy...");
    const response = await this.request("/webhooks", {
      headers: this.getHeaders(apiKey, "")
    });
    return response.results || [];
  }

  /**
   * Registers a new Webhook callback listener URL on Pluggy
   */
  public static async createWebhook(apiKey: string, event: string, url: string): Promise<any> {
    console.log(`[PluggyService] Registrando webhook para '${event}' em: ${url}`);
    return this.request("/webhooks", {
      method: "POST",
      headers: this.getHeaders(apiKey, "application/json"),
      body: JSON.stringify({ event, url })
    });
  }

  /**
   * Cleans up and deletes a Webhook callback from Pluggy
   */
  public static async deleteWebhook(apiKey: string, id: string): Promise<void> {
    console.log(`[PluggyService] Removendo registro de webhook ${id}...`);
    await this.request(`/webhooks/${id}`, {
      method: "DELETE",
      headers: this.getHeaders(apiKey, "")
    });
  }
}
