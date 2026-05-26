import { GoogleGenAI } from "@google/genai";

export interface PluggyTransaction {
  pluggyId: string;
  date: string;
  desc: string;
  amount: number;
  source: string;
  originalCategory: string;
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
   * Performs deep nested retrieval of all accounts and transactions corresponding to items
   */
  public static async syncTransactions(apiKey: string, itemsList: PluggyItem[], daysBack = 30): Promise<PluggyTransaction[]> {
    console.log(`[PluggyService Sync] Iniciando varredura profunda de transações dos últimos ${daysBack} dias.`);
    
    const results: PluggyTransaction[] = [];
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - daysBack);
    const fromStr = fromDate.toISOString().split("T")[0];

    for (const item of itemsList) {
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
        console.log(`[PluggyService Sync] Consultando transações para a conta: ${account.name} (tipo: ${account.type})`);
        try {
          const transactionsData = await this.request(
            `/transactions?accountId=${account.id}&from=${fromStr}`,
            { 
              headers: this.getHeaders(apiKey, ""),
            }
          );
          const rawList = transactionsData.results || [];
          console.log(`[PluggyService Sync] Extraídas ${rawList.length} transações brutas para a conta ${account.name}`);

          for (const tx of rawList) {
            results.push({
              pluggyId: tx.id,
              date: tx.date,
              desc: tx.description,
              amount: tx.amount,
              source: `${itemTitle} - ${account.name}`,
              originalCategory: tx.category || "",
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
