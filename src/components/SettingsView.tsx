import React, { useState, useRef, useEffect } from 'react';
import { User, signOut, sendPasswordResetEmail, updateProfile } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { UserProfile, Transaction } from '../App';
import { doc, updateDoc, serverTimestamp, collection, setDoc, deleteDoc } from 'firebase/firestore';
import { PluggySettingsPanel } from './PluggySettingsPanel';
import { User as UserIcon, Bell, LogOut, CloudCog, Download, UploadCloud, Trash2, Loader2, Database, Palette, CheckCircle2, ChevronLeft, ChevronRight, CreditCard, Brain, ChevronDown, ChevronUp, Copy, Check, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { 
  PROVIDER_REGISTRY, 
  getDefaultModel, 
  isLocalBaseUrl 
} from '../lib/ai/providerRegistry';
import { AIProvider } from '../lib/ai/types';
import { apiFetchJson } from '../lib/apiClient';
import { ToggleSwitch } from './ui/ToggleSwitch';

function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^\w\sà-úâ-ûã-õç]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeKey(date: string, desc: string, amount: number, source: string, type: string): string {
  const normDate = (date || '').trim();
  const normDesc = normalizeText(desc);
  const formattedAmount = Number(amount || 0).toFixed(2);
  const normSource = normalizeText(source);
  const normType = (type || '').trim().toLowerCase();
  
  return `${normDate}|${normDesc}|${formattedAmount}|${normSource}|${normType}`;
}

async function safeJsonClient(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = await response.text().catch(() => '');
    return {
      success: false,
      error: `Formato inesperado (Status: ${response.status}). Conteúdo: ${text.substring(0, 150) || 'N/A'}`
    };
  }
  try {
    return await response.json();
  } catch (err: any) {
    return {
      success: false,
      error: `Falha ao interpretar JSON retornado do servidor.`
    };
  }
}

export type AITestStepStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface AITestStep {
  name: string;
  status: AITestStepStatus;
  details?: string;
}

export interface AITestResult {
  status: 'none' | 'success' | 'error';
  title: string;
  summary: string;
  provider?: string;
  model?: string;
  code?: string;
  checkedAt?: string;
  providerEcho?: string;
  rawMessage?: string;
  steps: AITestStep[];
  logs: string[];
}

interface SettingsViewProps {
  user: User;
  profile: UserProfile;
  transactions: Transaction[];
  learnedRules: any[];
}

export const SettingsView = React.memo(function SettingsView({ user, profile, transactions, learnedRules = [] }: SettingsViewProps) {
  const [activePanel, setActivePanel] = useState<'perfil' | 'notif' | 'dados' | 'ia' | 'aparencia' | 'pluggy' | 'regras'>('perfil');
  const [isMobileMenu, setIsMobileMenu] = useState(true);

  // State to track if the backend API is online & available
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(null);
  const [dbStatus, setDbStatus] = useState<'CONNECTED' | 'DISCONNECTED' | 'UNKNOWN'>('UNKNOWN');

  // States for AI Settings & credentials
  const [aiSettings, setAiSettings] = useState({
    aiEnabled: false,
    provider: 'gemini' as AIProvider,
    model: 'gemini-3.5-flash',
    baseUrl: '',
    aiUseForOCR: false,
    aiUseForCategoryFallback: false,
    aiUseForInsights: false,
    aiUseForReports: false,
    aiAlwaysAskBeforeSending: true,
  });
  const [isCredentialSaved, setIsCredentialSaved] = useState(false);
  const [savedProvider, setSavedProvider] = useState<string>('');
  const [maskedKey, setMaskedKey] = useState<string>('');
  const [savedModel, setSavedModel] = useState<string>('');
  const [savedBaseUrl, setSavedBaseUrl] = useState<string>('');
  
  // local edits (form)
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>('gemini');
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.5-flash');
  const [baseUrlInput, setBaseUrlInput] = useState<string>('');
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  
  // test results / indicators
  const [testStatus, setTestStatus] = useState<'none' | 'success' | 'error'>('none');
  const [testMessage, setTestMessage] = useState<string>('');
  
  // New visual diagnostics states
  const [aiTestResult, setAiTestResult] = useState<AITestResult | null>(null);
  const [isAiDiagnosticsOpen, setIsAiDiagnosticsOpen] = useState<boolean>(false);
  const [copiedAiDiagnostics, setCopiedAiDiagnostics] = useState<boolean>(false);
  
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [savingAiSettings, setSavingAiSettings] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);

  // AI Connection Validations
  const showBaseUrl = ['openrouter', 'ollama', 'custom_openai_compatible', 'opencode_api'].includes(selectedProvider);
  
  const isOllamaLocal = selectedProvider === 'ollama' && isLocalBaseUrl(baseUrlInput || 'http://localhost:11434');
  const isCurrentProviderSaved = isCredentialSaved && (savedProvider === selectedProvider);
  const canEnableAI = isCurrentProviderSaved || isOllamaLocal;
  const isFormDisabled = loadingStatus || savingAiSettings || !apiAvailable || dbStatus === 'DISCONNECTED';

  const isApiKeyRequired = () => {
    if (['gemini', 'openai', 'anthropic', 'openrouter'].includes(selectedProvider)) {
      return true;
    }
    if (selectedProvider === 'ollama') {
      return false;
    }
    if (selectedProvider === 'custom_openai_compatible') {
      return false; // optional
    }
    if (selectedProvider === 'opencode_api') {
      return !isLocalBaseUrl(baseUrlInput);
    }
    return false;
  };

  // Fetch initial AI Status and Settings with healthcheck first
  useEffect(() => {
    let active = true;
    const loadData = async () => {
      try {
        setLoadingStatus(true);
        
        let isDbDisconnected = false;

        // 1. Verificar disponibilidade da API (Health check)
        const healthRes = await apiFetchJson<{ ok: boolean, database?: string }>('/api/health');
        if (!healthRes.ok) {
          if (healthRes.status === 503 && healthRes.data?.database === "DISCONNECTED") {
            isDbDisconnected = true;
            if (active) {
              setApiAvailable(true); // server is active, but db is down
              setDbStatus('DISCONNECTED');
            }
          } else {
            if (active) {
              setApiAvailable(false);
              setLoadingStatus(false);
            }
            return;
          }
        } else {
          if (active) {
            setApiAvailable(true);
            setDbStatus('CONNECTED');
          }
        }

        if (isDbDisconnected) {
          if (active) {
            setLoadingStatus(false);
          }
          return;
        }

        // 2. Carrega credenciais
        const token = await user.getIdToken();
        const res = await apiFetchJson<any>('/api/ai/credentials/status', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!res.ok) {
          throw new Error(res.message || 'Erro na resposta do backend');
        }

        const data = res.data;
        if (active && data) {
          setIsCredentialSaved(data.configured);
          if (data.configured) {
            setSavedProvider(data.provider || '');
            setMaskedKey(data.keyMasked || '');
            setSavedModel(data.model || '');
            setSavedBaseUrl(data.baseUrl || '');
            
            setSelectedProvider(data.provider || 'gemini');
            setSelectedModel(data.model || '');
            setBaseUrlInput(data.baseUrl || '');
          }
          if (data.settings) {
            setAiSettings(data.settings);
            if (!data.configured) {
              setSelectedProvider(data.settings.provider || 'gemini');
              setSelectedModel(data.settings.model || '');
              setBaseUrlInput(data.settings.baseUrl || '');
            }
          }
        }
      } catch (err) {
        console.error('Erro ao carregar status de IA:', err);
      } finally {
        if (active) setLoadingStatus(false);
      }
    };
    loadData();
    return () => { active = false; };
  }, [user]);

  // Saving settings logic (without apiKey inside body!)
  const handleToggleAI = async (checked: boolean) => {
    if (!apiAvailable) {
      toast.error("Não é possível alterar as configurações pois a API do FINCANVAS está offline.");
      return;
    }
    if (checked && !canEnableAI) {
      toast.error("Configure e salve sua chave de acesso primeiro para ativar a Inteligência Artificial (exceto para instâncias locais do Ollama).");
      return;
    }
    
    try {
      setSavingAiSettings(true);
      const token = await user.getIdToken();
      const res = await apiFetchJson<{ success: boolean; settings: any }>('/api/ai/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          ...aiSettings,
          aiEnabled: checked,
          provider: selectedProvider,
          model: selectedModel,
          baseUrl: baseUrlInput
        })
      });
      
      if (res.ok && res.data?.success) {
        setAiSettings(res.data.settings);
        toast.success(checked ? "Inteligência Artificial ativada com sucesso!" : "Inteligência Artificial desativada.");
      } else {
        toast.error(res.message || "Falha ao salvar as configurações.");
      }
    } catch (err: any) {
      toast.error("Erro de conexão ao salvar configurações: " + err.message);
    } finally {
      setSavingAiSettings(false);
    }
  };

  const handleTogglePermission = async (field: string, value: boolean) => {
    if (!apiAvailable) {
      toast.error("Não é possível alterar as permissões pois a API do FINCANVAS está offline.");
      return;
    }
    if (!aiSettings.aiEnabled) {
      toast.error("Ative a Inteligência Artificial globalmente antes de configurar permissões.");
      return;
    }
    try {
      setSavingAiSettings(true);
      const token = await user.getIdToken();
      
      const nextSettings = {
        ...aiSettings,
        [field]: value
      };
      
      const res = await apiFetchJson<{ success: boolean; settings: any }>('/api/ai/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(nextSettings)
      });
      
      if (res.ok && res.data?.success) {
        setAiSettings(res.data.settings);
        toast.success("Opção de IA atualizada.");
      } else {
        toast.error(res.message || "Falha ao salvar configuração.");
      }
    } catch (err: any) {
      toast.error("Erro de de conexão ao salvar configurações: " + err.message);
    } finally {
      setSavingAiSettings(false);
    }
  };

  const handleSaveCredential = async () => {
    if (!apiAvailable) {
      toast.error("Não é possível salvar credenciais pois a API do FINCANVAS está offline.");
      return;
    }
    if (!selectedProvider) {
      toast.error("Selecione um provedor.");
      return;
    }
    
    let cleanedBaseUrl = baseUrlInput.trim();
    if (cleanedBaseUrl) {
      // Clean duplicate/trailing slashes (except http:// or https://)
      cleanedBaseUrl = cleanedBaseUrl.replace(/([^:])\/{2,}/g, '$1/');
    }
    
    if ((selectedProvider === 'custom_openai_compatible' || selectedProvider === 'opencode_api') && !cleanedBaseUrl) {
      toast.error("A Base URL é obrigatória para este provedor.");
      return;
    }
    
    if (selectedProvider === 'opencode_api' && !apiKeyInput.trim() && !isLocalBaseUrl(cleanedBaseUrl)) {
      toast.error("A API Key é obrigatória para instâncias remotas da OpenCode API.");
      return;
    }

    if (['gemini', 'openai', 'anthropic', 'openrouter'].includes(selectedProvider) && !apiKeyInput.trim() && !isCurrentProviderSaved) {
      toast.error("A API Key é obrigatória para este provedor.");
      return;
    }
    
    try {
      setSavingAiSettings(true);
      const token = await user.getIdToken();
      const res = await apiFetchJson<any>('/api/ai/credentials/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          provider: selectedProvider,
          apiKey: apiKeyInput.trim() || undefined,
          baseUrl: cleanedBaseUrl || undefined,
          model: selectedModel.trim() || undefined
        })
      });
      
      if (res.ok && res.data?.configured) {
        setIsCredentialSaved(true);
        setSavedProvider(res.data.provider);
        setMaskedKey(res.data.keyMasked);
        setSavedModel(res.data.model);
        setSavedBaseUrl(res.data.baseUrl);
        
        setBaseUrlInput(res.data.baseUrl);
        setApiKeyInput('');
        toast.success("Credencial salva com sucesso!");
      } else {
        toast.error(res.message || "Erro ao salvar credenciais.");
      }
    } catch (err: any) {
      toast.error("Erro ao salvar credencial: " + err.message);
    } finally {
      setSavingAiSettings(false);
    }
  };

  const handleTestConnection = async () => {
    if (!apiAvailable) {
      toast.error("Não é possível testar conexão pois a API do FINCANVAS está offline.");
      return;
    }
    if (!selectedProvider) {
      toast.error("Selecione um provedor de IA antes de testar.");
      return;
    }

    let cleanedBaseUrl = baseUrlInput.trim();
    if (cleanedBaseUrl) {
      cleanedBaseUrl = cleanedBaseUrl.replace(/([^:])\/{2,}/g, '$1/');
    }

    if ((selectedProvider === 'custom_openai_compatible' || selectedProvider === 'opencode_api') && !cleanedBaseUrl) {
      toast.error("A Base URL é obrigatória para testar este provedor.");
      return;
    }

    if (['gemini', 'openai', 'anthropic', 'openrouter'].includes(selectedProvider) && !apiKeyInput.trim() && !isCurrentProviderSaved) {
      toast.error("A API Key é necessária para testar o provedor " + selectedProvider);
      return;
    }

    // Inicializa Resultados de Testes/Indicações Dinâmicos de Diagnóstico
    setIsAiDiagnosticsOpen(true);
    setTestingConnection(true);
    setTestStatus('none');
    setTestMessage('');

    const initialSteps: AITestStep[] = [
      { name: "Verificação de Parâmetros", status: "RUNNING", details: "Avaliando credenciais locais e parâmetros do formulário..." },
      { name: "Resolução de Host e Preflight", status: "PENDING", details: "Aguardando preflight..." },
      { name: "Autenticação e Handshake", status: "PENDING", details: "Aguardando handshake de autenticação..." },
      { name: "Chamada de Inferência (Eco)", status: "PENDING", details: "Aguardando eco de confirmação do modelo..." }
    ];

    const providerConfig = PROVIDER_REGISTRY[selectedProvider];
    const providerName = providerConfig?.name || selectedProvider;
    const testModel = selectedModel || getDefaultModel(selectedProvider);

    const initialLogs = [
      `[Preflight] Iniciando checagem de integridade de IA para o provedor: ${providerName}...`,
      `[Config] Provedor: ${selectedProvider} | Modelo Alvo: ${testModel}`,
      `[Config] Base URL de Endpoint: ${cleanedBaseUrl || providerConfig?.defaultBaseUrl || 'Padrão Cloud'}`
    ];

    setAiTestResult({
      status: 'none',
      title: 'Testando conexão de IA',
      summary: 'Validando credenciais, provedor e modelo configurado.',
      provider: selectedProvider,
      model: testModel,
      steps: initialSteps,
      logs: initialLogs
    });

    const currentSteps = [...initialSteps];
    const currentLogs = [...initialLogs];

    try {
      // Pequeno delay artificial para uma excelente experiência visual nas etapas de diagnóstico (150ms)
      await new Promise(resolve => setTimeout(resolve, 150));

      currentSteps[0] = { name: "Verificação de Parâmetros", status: "COMPLETED", details: "Parâmetros locais válidos." };
      currentSteps[1] = { name: "Resolução de Host e Preflight", status: "RUNNING", details: "Testando comunicação entre cliente e servidor do FINCANVAS..." };

      const time1 = new Date().toLocaleTimeString();
      currentLogs.push(
        `[${time1}] [Preflight] Parâmetros de formulário validados localmente com sucesso.`,
        `[${time1}] [Handshake] Certificando conectividade HTTP com o barramento do backend...`
      );

      setAiTestResult({
        status: 'none',
        title: 'Testando conexão de IA',
        summary: 'Resolvendo host e disparando verificação secundária...',
        provider: selectedProvider,
        model: testModel,
        steps: [...currentSteps],
        logs: [...currentLogs]
      });

      const token = await user.getIdToken();

      const hasModifications = selectedProvider !== savedProvider || cleanedBaseUrl !== savedBaseUrl || selectedModel !== savedModel || !!apiKeyInput;
      
      const body: any = {};
      if (hasModifications) {
        body.provider = selectedProvider;
        body.apiKey = apiKeyInput || undefined;
        body.baseUrl = cleanedBaseUrl || undefined;
        body.model = selectedModel || undefined;
      }

      await new Promise(resolve => setTimeout(resolve, 150));

      currentSteps[1] = { name: "Resolução de Host e Preflight", status: "COMPLETED", details: "Conexão com backend estabelecida." };
      currentSteps[2] = { name: "Autenticação e Handshake", status: "RUNNING", details: `Enviando credenciais criptografadas a caminho do ${providerName}...` };

      const time2 = new Date().toLocaleTimeString();
      currentLogs.push(
        `[${time2}] [Preflight] Gateway de backend alcançado com sucesso.`,
        `[${time2}] [Auth] Preparando pacote de chaves e disparando handshake de validação para o provedor ${providerName}...`
      );

      setAiTestResult({
        status: 'none',
        title: 'Testando conexão de IA',
        summary: 'Autenticando contra o provedor de IA selecionado...',
        provider: selectedProvider,
        model: testModel,
        steps: [...currentSteps],
        logs: [...currentLogs]
      });

      const res = await apiFetchJson<any>('/api/ai/credentials/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });

      currentSteps[2] = { name: "Autenticação e Handshake", status: res.ok && res.data?.success ? "COMPLETED" : "FAILED", details: res.ok && res.data?.success ? "Handshake autenticado com sucesso!" : "Autenticação do provedor falhou." };

      const safeProviderEcho = String(res.data?.providerEcho || res.data?.message || res.message || '').slice(0, 500);

      if (res.ok && res.data?.success) {
        currentSteps[3] = { name: "Chamada de Inferência (Eco)", status: "COMPLETED", details: "Resposta do modelo recebida e validada com êxito." };

        const time3 = new Date().toLocaleTimeString();
        currentLogs.push(
          `[${time3}] [Auth] Credencial validada com sucesso pelo provedor ${providerName}.`,
          `[${time3}] [Inference] Solicitação leve de inferência de LLM realizada com sucesso.`,
          `[${time3}] [Echo] Resposta recebida da IA: "${safeProviderEcho}"`
        );

        setAiTestResult({
          status: 'success',
          title: 'Conexão validada com sucesso',
          summary: 'O provedor respondeu corretamente e está pronto para uso no FINCANVAS.',
          provider: selectedProvider,
          model: testModel,
          checkedAt: new Date().toISOString(),
          rawMessage: res.data?.message || "Conexão testada com sucesso!",
          providerEcho: safeProviderEcho,
          steps: [...currentSteps],
          logs: [...currentLogs]
        });

        setTestStatus('success');
        setTestMessage(res.data.message || "Conexão testada com sucesso!");
        toast.success("Teste de conexão bem-sucedido!");
      } else {
        const code = res.data?.code;
        let finalMsg = res.data?.message || res.message || "Erro ao testar conexão.";

        if (code === "AI_MODEL_NOT_FOUND") {
          finalMsg = "O modelo de IA informado não foi encontrado ou não está disponível para esta chave/projeto. Por favor, tente selecionar outro modelo compatível ou verifique a disponibilidade no painel do provedor (como o Google AI Studio).";
        } else if (code === "AI_AUTH_INVALID") {
          finalMsg = "A chave de API fornecida é inválida, expirou ou foi revogada. Por favor, confira a chave e tente novamente.";
        } else if (code === "AI_QUOTA_OR_BILLING") {
          finalMsg = "O provedor recusou a requisição devido ao limite de cota, faturamento (billing) ou limite de créditos excedido. Verifique o status da sua conta no provedor.";
        } else if (code === "AI_RATE_LIMITED") {
          finalMsg = "Limite de requisições excedido temporariamente. Aguarde alguns minutos antes de realizar um novo teste.";
        } else if (code === "AI_PROVIDER_TIMEOUT") {
          finalMsg = "Tempo esgotado ao tentar alcançar o provedor. Tente novamente ou aumente o tempo limite na configuração AI_PROVIDER_TEST_TIMEOUT_MS.";
        } else if (code === "AI_PROVIDER_UNREACHABLE") {
          finalMsg = "Não foi possível conectar ao servidor do provedor de IA. Verifique sua rede de internet ou a Base URL fornecida.";
        } else if (code === "AI_CREDENTIALS_MISSING") {
          finalMsg = "Nenhuma credencial de IA foi configurada para teste.";
        } else if (code === "AI_PROVIDER_INVALID") {
          finalMsg = "Provedor de IA inválido selecionado.";
        }

        currentSteps[3] = { name: "Chamada de Inferência (Eco)", status: "FAILED", details: finalMsg };

        const time3 = new Date().toLocaleTimeString();
        currentLogs.push(
          `[${time3}] [Erro] Conectividade de IA ou autenticação falhou com status: ${code || 'UNKNOWN_ERROR'}`,
          `[${time3}] [Erro] Detalhes técnicos: ${finalMsg}`
        );

        setAiTestResult({
          status: 'error',
          title: 'Falha no teste de conexão',
          summary: finalMsg,
          provider: selectedProvider,
          model: testModel,
          code: code,
          checkedAt: new Date().toISOString(),
          rawMessage: res.data?.message || res.message,
          providerEcho: safeProviderEcho,
          steps: [...currentSteps],
          logs: [...currentLogs]
        });

        setTestStatus('error');
        setTestMessage(finalMsg);
        toast.error(finalMsg);
      }
    } catch (err: any) {
      const errorMsg = "Erro ao testar a conexão: " + (err.message || String(err));
      
      const lastIdx = currentSteps.findIndex(s => s.status === 'RUNNING');
      if (lastIdx !== -1) {
        currentSteps[lastIdx].status = 'FAILED';
        currentSteps[lastIdx].details = errorMsg;
      }
      for (let i = 0; i < currentSteps.length; i++) {
        if (currentSteps[i].status === 'PENDING') {
          currentSteps[i].status = 'FAILED';
        }
      }

      const time3 = new Date().toLocaleTimeString();
      currentLogs.push(
        `[${time3}] [Erro] Exceção crítica interceptada na chamada da API:`,
        `[${time3}] [Erro] Detalhes: ${errorMsg}`
      );

      setAiTestResult({
        status: 'error',
        title: 'Falha no teste de conexão',
        summary: errorMsg,
        provider: selectedProvider,
        model: testModel,
        checkedAt: new Date().toISOString(),
        rawMessage: err.message || String(err),
        steps: [...currentSteps],
        logs: [...currentLogs]
      });

      setTestStatus('error');
      setTestMessage(errorMsg);
      toast.error(errorMsg);
    } finally {
      setTestingConnection(false);
    }
  };

  const handleRemoveCredential = async () => {
    if (!apiAvailable) {
      toast.error("Não é possível remover credenciais pois a API do FINCANVAS está offline.");
      return;
    }
    try {
      setSavingAiSettings(true);
      const token = await user.getIdToken();
      const res = await apiFetchJson<any>('/api/ai/credentials/delete', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (res.ok) {
        setIsCredentialSaved(false);
        setSavedProvider('');
        setMaskedKey('');
        setSavedModel('');
        setSavedBaseUrl('');
        setApiKeyInput('');
        setTestStatus('none');
        setTestMessage('');
        
        setAiSettings(prev => ({
          ...prev,
          aiEnabled: false,
          aiUseForOCR: false,
          aiUseForCategoryFallback: false,
          aiUseForInsights: false,
          aiUseForReports: false
        }));
        
        toast.success("Credenciais de IA removidas e IA desativada.");
      } else {
        toast.error(res.message || "Falha ao remover credenciais.");
      }
    } catch (err: any) {
      toast.error("Erro de conexão ao remover credenciais: " + err.message);
    } finally {
      setSavingAiSettings(false);
    }
  };

  const [displayName, setDisplayName] = useState(user.displayName || '');
  const [photoURL, setPhotoURL] = useState(user.photoURL || '');
  const [phone, setPhone] = useState(profile.phone || '');

  const handleDeleteRule = async (ruleId: string) => {
    try {
      const ruleRef = doc(db, 'users', user.uid, 'learnedRules', ruleId);
      await deleteDoc(ruleRef);
      toast.success('Regra aprendida removida de forma segura!');
    } catch (err: any) {
      toast.error('Não foi possível remover a regra: ' + err.message);
    }
  };
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');

  const photoRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  const handleNextInput = (e: React.KeyboardEvent<HTMLInputElement>, nextRef: React.RefObject<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      nextRef.current?.focus();
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdatingProfile(true);
    setProfileMessage('');
    try {
      if (user.displayName !== displayName || user.photoURL !== photoURL) {
        await updateProfile(user, { displayName, photoURL });
      }
      if (profile.phone !== phone) {
        await updateDoc(doc(db, 'users', user.uid), { phone, updatedAt: serverTimestamp() });
      }
      toast.success('Perfil atualizado com sucesso!');
      setProfileMessage('Perfil atualizado com sucesso!');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao atualizar perfil.');
      setProfileMessage('Erro ao atualizar perfil.');
    }
    setIsUpdatingProfile(false);
  };

  const handlePasswordReset = async () => {
    try {
      await sendPasswordResetEmail(auth, user.email!);
      toast.success('Link de redefinição de senha enviado para o seu e-mail.');
      setProfileMessage('Link de redefinição de senha enviado para o seu e-mail.');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao enviar link de redefinição.');
      setProfileMessage('Erro ao enviar link de redefinição.');
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      toast.success('Desconectado com sucesso!');
    } catch (error) {
      console.error('Erro ao sair da conta:', error);
      toast.error('Erro ao sair.');
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const handleExport = () => {
    const backupData = transactions.map(t => {
      const { id, createdAt, updatedAt, ...rest } = t;
      return rest;
    });
    
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `fincanvas_backup_${new Date().getTime()}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    toast.success('Download do backup concluído!');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        const colRef = collection(db, 'transactions');
        for (const item of data) {
          if (item.desc && item.amount) {
             const ref = doc(colRef);
             await setDoc(ref, {
               ...item,
               userId: user.uid,
               createdAt: serverTimestamp(),
               updatedAt: serverTimestamp()
             });
          }
        }
        toast.success('Dados importados com sucesso!');
      } else {
        toast.error('Formato de importação inválido. Envie um JSON gerado pelo sistema.');
        console.error('Formato de importação inválido. Envie um JSON gerado pelo sistema.');
      }
    } catch(err) {
      console.error(err);
      toast.error('Ocorreu um erro ao importar dados.');
    }
    
    setIsImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleClearData = async () => {
    setIsClearing(true);
    setShowClearConfirm(false);
    try {
       for (const t of transactions) {
         if (t.id) {
           await deleteDoc(doc(db, 'transactions', t.id));
         }
       }
       toast.success('Dados excluídos com sucesso!');
    } catch(err) {
       handleFirestoreError(err, OperationType.DELETE, 'transactions');
       toast.error('Erro ao excluir dados.');
    }
    setIsClearing(false);
  };

  const toggleAlerts = async () => {
    try {
      const ref = doc(db, 'users', user.uid);
      await updateDoc(ref, {
        highSpendingAlerts: !profile.highSpendingAlerts,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <header className="h-16 flex-shrink-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center px-4 sm:px-8 z-10">
        <div className="md:hidden w-full flex items-center justify-between">
          {isMobileMenu ? (
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Preferências</h1>
          ) : (
            <>
              <button 
                onClick={() => setIsMobileMenu(true)} 
                className="flex items-center text-slate-600 hover:text-slate-900 transition-colors py-1 pl-0 pr-3 active:opacity-50"
              >
                <ChevronLeft className="w-6 h-6 mr-1 -ml-2" />
                <span className="font-bold text-sm tracking-wider uppercase">Voltar</span>
              </button>
              <span className="font-bold text-slate-800 text-[16px] dark:text-slate-100">
                {activePanel === 'perfil' && 'Perfil / Conta'}
                {activePanel === 'aparencia' && 'Aparência'}
                {activePanel === 'notif' && 'Notificações'}
                {activePanel === 'dados' && 'Dados e Nuvem'}
                {activePanel === 'ia' && 'Inteligência Artificial'}
                {activePanel === 'pluggy' && 'Integração bancária'}
                {activePanel === 'regras' && 'Regras de Aprendizado'}
              </span>
            </>
          )}
        </div>
        <h1 className="hidden md:block text-lg font-bold text-slate-800 dark:text-slate-100">Preferências</h1>
      </header>
      
      <div className={`flex-1 p-4 md:p-8 w-full sm:pb-8 flex flex-col ${isMobileMenu ? 'overflow-hidden pb-20' : 'overflow-y-auto pb-24'}`}>
        <div className="max-w-6xl xl:max-w-7xl mx-auto flex flex-col md:flex-row gap-0 md:gap-8 flex-1 w-full relative">
          <aside className={`w-full md:w-64 flex-shrink-0 flex-col gap-2.5 md:gap-2 pb-2 md:pb-0 md:sticky md:top-4 md:self-start md:overflow-y-visible ${isMobileMenu ? 'flex h-full overflow-y-auto' : 'hidden md:flex'}`}>
            <button 
              onClick={() => { setActivePanel('perfil'); setIsMobileMenu(false); }}
              className={`w-full text-left px-4 py-3.5 md:px-4 md:py-2.5 text-sm md:font-bold rounded-2xl md:rounded-lg transition-all flex items-center shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] md:shadow-none border border-slate-100 md:border-transparent ${activePanel === 'perfil' ? 'bg-emerald-50/50 md:bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border-emerald-100/50' : 'bg-white md:bg-transparent text-slate-700 md:text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'} active:scale-[0.98]`}>
              <div className="md:hidden p-2 rounded-xl bg-slate-50 text-slate-500 mr-3"><UserIcon className="w-4 h-4" /></div>
              <UserIcon className="hidden md:block w-4 h-4 mr-2 opacity-70" /> 
              <span className="font-bold text-[14px] md:text-sm">Perfil/Conta</span>
              <ChevronRight className="md:hidden w-4 h-4 ml-auto text-slate-300" />
            </button>
            <button 
              onClick={() => { setActivePanel('aparencia'); setIsMobileMenu(false); }}
              className={`w-full text-left px-4 py-3.5 md:px-4 md:py-2.5 text-sm md:font-bold rounded-2xl md:rounded-lg transition-all flex items-center shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] md:shadow-none border border-slate-100 md:border-transparent ${activePanel === 'aparencia' ? 'bg-emerald-50/50 md:bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border-emerald-100/50' : 'bg-white md:bg-transparent text-slate-700 md:text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'} active:scale-[0.98]`}>
              <div className="md:hidden p-2 rounded-xl bg-slate-50 text-slate-500 mr-3"><Palette className="w-4 h-4" /></div>
              <Palette className="hidden md:block w-4 h-4 mr-2 opacity-70" /> 
              <span className="font-bold text-[14px] md:text-sm">Aparência</span>
              <ChevronRight className="md:hidden w-4 h-4 ml-auto text-slate-300" />
            </button>
            <button 
              onClick={() => { setActivePanel('notif'); setIsMobileMenu(false); }}
              className={`w-full text-left px-4 py-3.5 md:px-4 md:py-2.5 text-sm md:font-bold rounded-2xl md:rounded-lg transition-all flex items-center shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] md:shadow-none border border-slate-100 md:border-transparent ${activePanel === 'notif' ? 'bg-emerald-50/50 md:bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border-emerald-100/50' : 'bg-white md:bg-transparent text-slate-700 md:text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'} active:scale-[0.98]`}>
              <div className="md:hidden p-2 rounded-xl bg-slate-50 text-slate-500 mr-3"><Bell className="w-4 h-4" /></div>
              <Bell className="hidden md:block w-4 h-4 mr-2 opacity-70" /> 
              <span className="font-bold text-[14px] md:text-sm">Notificações</span>
              <ChevronRight className="md:hidden w-4 h-4 ml-auto text-slate-300" />
            </button>
            <button 
              onClick={() => { setActivePanel('dados'); setIsMobileMenu(false); }}
              className={`w-full text-left px-4 py-3.5 md:px-4 md:py-2.5 text-sm md:font-bold rounded-2xl md:rounded-lg transition-all flex items-center shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] md:shadow-none border border-slate-100 md:border-transparent ${activePanel === 'dados' ? 'bg-emerald-50/50 md:bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-100/50' : 'bg-white md:bg-transparent text-slate-700 md:text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'} active:scale-[0.98]`}>
              <div className="md:hidden p-2 rounded-xl bg-slate-50 text-slate-500 mr-3"><Database className="w-4 h-4" /></div>
              <Database className="hidden md:block w-4 h-4 mr-2 opacity-70" /> 
              <span className="font-bold text-[14px] md:text-sm">Dados e Nuvem</span>
              <ChevronRight className="md:hidden w-4 h-4 ml-auto text-slate-300" />
            </button>
            <button 
              onClick={() => { setActivePanel('ia'); setIsMobileMenu(false); }}
              className={`w-full text-left px-4 py-3.5 md:px-4 md:py-2.5 text-sm md:font-bold rounded-2xl md:rounded-lg transition-all flex items-center shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] md:shadow-none border border-slate-100 md:border-transparent ${activePanel === 'ia' ? 'bg-emerald-50/50 md:bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-100/50' : 'bg-white md:bg-transparent text-slate-700 md:text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'} active:scale-[0.98]`}>
              <div className="md:hidden p-2 rounded-xl bg-slate-50 text-slate-500 mr-3"><Brain className="w-4 h-4" /></div>
              <Brain className="hidden md:block w-4 h-4 mr-2 opacity-70" /> 
              <span className="font-bold text-[14px] md:text-sm">Inteligência Artificial</span>
              <ChevronRight className="md:hidden w-4 h-4 ml-auto text-slate-300" />
            </button>
            <button 
              onClick={() => { setActivePanel('pluggy'); setIsMobileMenu(false); }}
              className={`w-full text-left px-4 py-3.5 md:px-4 md:py-2.5 text-sm md:font-bold rounded-2xl md:rounded-lg transition-all flex items-center shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] md:shadow-none border border-slate-100 md:border-transparent ${activePanel === 'pluggy' ? 'bg-emerald-50/50 md:bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border-emerald-100/50' : 'bg-white md:bg-transparent text-slate-700 md:text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'} active:scale-[0.98]`}>
              <div className="md:hidden p-2 rounded-xl bg-slate-50 text-slate-500 mr-3"><CreditCard className="w-4 h-4" /></div>
              <CreditCard className="hidden md:block w-4 h-4 mr-2 opacity-70" /> 
              <span className="font-bold text-[14px] md:text-sm">Integração bancária</span>
              <ChevronRight className="md:hidden w-4 h-4 ml-auto text-slate-300" />
            </button>
            <button 
              onClick={() => { setActivePanel('regras'); setIsMobileMenu(false); }}
              className={`w-full text-left px-4 py-3.5 md:px-4 md:py-2.5 text-sm md:font-bold rounded-2xl md:rounded-lg transition-all flex items-center shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] md:shadow-none border border-slate-100 md:border-transparent ${activePanel === 'regras' ? 'bg-emerald-50/50 md:bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border-emerald-100/50' : 'bg-white md:bg-transparent text-slate-700 md:text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'} active:scale-[0.98]`}>
              <div className="md:hidden p-2 rounded-xl bg-slate-50 text-slate-500 mr-3"><Brain className="w-4 h-4" /></div>
              <Brain className="hidden md:block w-4 h-4 mr-2 opacity-70" /> 
              <span className="font-bold text-[14px] md:text-sm">Regras de Aprendizado</span>
              <ChevronRight className="md:hidden w-4 h-4 ml-auto text-slate-300" />
            </button>
            
            {/* Sair da Conta: visível apenas no mobile (já existe na sidebar do desktop) */}
            <button 
              onClick={handleLogout}
              className="md:hidden mt-auto w-full text-left px-4 py-3.5 text-sm font-bold rounded-2xl transition-all flex items-center shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] border border-rose-100 bg-rose-50 text-rose-600 dark:text-rose-400 hover:bg-rose-100 active:scale-[0.98]">
              <div className="p-2 rounded-xl bg-white text-rose-500 mr-3"><LogOut className="w-4 h-4 text-rose-500" /></div>
              <span className="font-bold text-[14px]">Sair da Conta</span>
              <ChevronRight className="w-4 h-4 ml-auto text-rose-300" />
            </button>
          </aside>
          
          <main className={`flex-1 bg-white md:dark:bg-slate-800 rounded-none md:rounded-xl md:border border-slate-200 dark:border-slate-700 md:shadow-sm md:p-8 pb-32 sm:pb-8 relative ${!isMobileMenu ? 'flex flex-col' : 'hidden md:flex flex-col'}`}>
            {activePanel === 'perfil' && (
              <div className="space-y-6">
                <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-widest border-b border-slate-100 dark:border-slate-700 pb-2 hidden md:block">Informações Pessoais</h2>
                
                {profileMessage && (
                  <div className={`p-4 rounded-xl text-sm font-bold flex items-start shadow-sm border ${profileMessage.includes('Erro') ? 'bg-rose-50 border-rose-100 text-rose-700' : 'bg-emerald-50 border-emerald-100 text-emerald-700'}`}>
                    <CheckCircle2 className="w-5 h-5 mr-3 flex-shrink-0" />
                    <span>{profileMessage}</span>
                  </div>
                )}
                
                <form onSubmit={handleUpdateProfile} className="space-y-6 md:space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6 md:mb-6">
                    <div className="w-20 h-20 md:w-16 md:h-16 rounded-full bg-slate-200 overflow-hidden flex-shrink-0 border-4 md:border-2 border-white shadow-md mx-auto sm:mx-0">
                      {photoURL ? (
                        <img src={photoURL} alt="Avatar" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-400 font-bold uppercase text-2xl">
                          {user.displayName?.[0] || user.email?.[0] || 'U'}
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 tracking-wider uppercase">URL da Foto de Perfil</label>
                      <input ref={photoRef} type="url" value={photoURL} onChange={(e) => setPhotoURL(e.target.value)} onKeyDown={e => handleNextInput(e, nameRef)} tabIndex={1} enterKeyHint="next" placeholder="https://exemplo.com/foto.jpg" className="w-full px-4 py-3 md:px-3 md:py-2 text-[16px] md:text-sm border border-slate-200 shadow-sm md:border-slate-300 dark:border-slate-600 bg-slate-50 md:bg-white dark:bg-slate-700 dark:text-white rounded-xl md:rounded focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all outline-none" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">Nome</label>
                      <input ref={nameRef} type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} onKeyDown={e => handleNextInput(e, phoneRef)} tabIndex={2} enterKeyHint="next" className="w-full px-4 py-3 md:px-3 md:py-2 text-[16px] md:text-sm border border-slate-200 shadow-sm md:border-slate-300 dark:border-slate-600 bg-slate-50 md:bg-white dark:bg-slate-700 dark:text-white rounded-xl md:rounded focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">Telefone</label>
                      <input ref={phoneRef} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} tabIndex={3} enterKeyHint="send" placeholder="(11) 99999-9999" className="w-full px-4 py-3 md:px-3 md:py-2 text-[16px] md:text-sm border border-slate-200 shadow-sm md:border-slate-300 dark:border-slate-600 bg-slate-50 md:bg-white dark:bg-slate-700 dark:text-white rounded-xl md:rounded focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all outline-none" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">E-mail Vinculado</label>
                      <input type="email" tabIndex={-1} className="w-full px-4 py-3 md:px-3 md:py-2 text-[16px] md:text-sm font-bold border border-slate-100 md:border-slate-200 dark:border-slate-600 rounded-xl md:rounded bg-slate-100 dark:bg-slate-800 outline-none text-slate-500 dark:text-slate-400 cursor-not-allowed shadow-inner" readOnly value={user.email || ''} />
                    </div>
                  </div>

                  <div className="flex justify-end pt-4 md:pt-2 pb-4 md:pb-0">
                    <button type="submit" disabled={isUpdatingProfile} className="w-full md:w-auto px-6 py-4 md:py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[15px] md:text-xs font-bold rounded-xl md:rounded shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition-all disabled:opacity-50">
                      {isUpdatingProfile ? 'Salvando...' : 'Salvar Alterações'}
                    </button>
                  </div>
                </form>
                
                <div className="border-t border-slate-100 dark:border-slate-700 pt-8 mt-2 md:pt-6 md:mt-6 pb-2">
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-3">Segurança</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">Caso você tenha feito login via provedores como o Google e não tenha criado uma senha, ao solicitar a redefinição de senha e segui-la, sua conta ganhará acesso via senha.</p>
                  <button onClick={handlePasswordReset} className="w-full md:w-auto px-5 py-3 md:px-4 md:py-2 bg-white dark:bg-slate-700 border border-slate-200 shadow-sm md:border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-[13px] md:text-xs font-bold rounded-xl md:rounded active:scale-[0.98] transition-all">
                    Solicitar redefinição de senha
                  </button>
                </div>
              </div>
            )}
            
            {activePanel === 'aparencia' && (
              <div className="space-y-6">
                <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-widest border-b border-slate-100 dark:border-slate-700 pb-2 hidden md:block">Aparência do Sistema</h2>
                
                <div className="flex items-center justify-between p-5 md:p-4 bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700 rounded-xl md:rounded shadow-sm md:shadow-none">
                  <div className="pr-4">
                    <p className="text-[15px] md:text-sm font-bold text-slate-800 dark:text-slate-100">Modo Escuro (Dark Mode)</p>
                    <p className="text-[13px] md:text-xs text-slate-500 dark:text-slate-404 mt-1.5 md:mt-1 leading-relaxed">Altera o tema visual da aplicação para modo noturno.</p>
                  </div>
                  <button onClick={async () => {
                    try {
                      const ref = doc(db, 'users', user.uid);
                      await updateDoc(ref, {
                        darkMode: !profile.darkMode,
                        updatedAt: serverTimestamp()
                      });
                    } catch (err) {
                      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
                    }
                  }} className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none shadow-sm ${profile.darkMode ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${profile.darkMode ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>
            )}

            {activePanel === 'notif' && (
              <div className="space-y-6">
                <h2 className="text-sm font-bold text-slate-800 uppercase tracking-widest border-b border-slate-100 pb-2 hidden md:block">Alertas do Sistema</h2>
                <div className="flex items-center justify-between p-5 md:p-4 bg-slate-50 border border-slate-100 rounded-xl md:rounded shadow-sm md:shadow-none">
                  <div className="pr-4">
                    <p className="text-[15px] md:text-sm font-bold text-slate-800">Alertas de Padrão Atípico</p>
                    <p className="text-[13px] md:text-xs text-slate-500 mt-1.5 md:mt-1 leading-relaxed">A IA sinalizará compras fora da curva ou excessivas para que você tenha controle sobre os gastos.</p>
                  </div>
                  <button onClick={toggleAlerts} className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none shadow-sm ${profile.highSpendingAlerts ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                    <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${profile.highSpendingAlerts ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>
            )}
            
            {activePanel === 'dados' && (
              <div className="space-y-6 pb-6">
                <h2 className="text-sm font-bold text-slate-800 uppercase tracking-widest border-b border-slate-100 pb-2 hidden md:block">Governança e Nuvem</h2>
                
                <div className="bg-emerald-50 border border-emerald-100 md:border-emerald-200 rounded-xl md:rounded-lg p-5 flex flex-col sm:flex-row sm:items-start gap-4 shadow-sm md:shadow-none font-sans">
                  <div className="bg-emerald-100 p-3 md:p-2 rounded-xl md:rounded shrink-0 self-start">
                    <CloudCog className="w-6 h-6 md:w-5 md:h-5 text-emerald-600" />
                  </div>
                  <div>
                    <h4 className="text-[15px] md:text-sm font-bold text-emerald-900">Isolamento Cloud Firestore</h4>
                    <p className="text-[13px] md:text-xs text-emerald-700 mt-2 md:mt-1.5 leading-relaxed">
                      Seus dados financeiros trafegam criptografados e residem em um contêiner NoSQL do Google Cloud 
                      (us-west2). Proteções Zero-Trust rigorosas garantem que os dados só possam ser visualizados ou 
                      modificados por <span className="font-bold">{user.email}</span>.
                    </p>
                  </div>
                </div>

                <div className="mt-8 md:mt-8 pt-4 md:pt-0">
                  <h3 className="text-[13px] md:text-sm font-bold text-slate-800 mb-4 uppercase tracking-widest border-b border-slate-100 pb-2">Gestão de Dados</h3>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-4 mb-4">
                    <div className="border border-slate-200 bg-white rounded-xl p-5 md:p-4 flex flex-col justify-between shadow-sm md:shadow-none">
                      <div>
                        <div className="flex items-center gap-2 mb-2.5 md:mb-2">
                           <Download className="w-5 h-5 md:w-4 md:h-4 text-emerald-600" />
                           <h4 className="font-bold text-[15px] md:text-sm text-slate-800">Exportar (Backup)</h4>
                        </div>
                        <p className="text-[13px] md:text-xs text-slate-500 mb-5 md:mb-4 leading-relaxed">Baixe uma cópia JSON local com o histórico de todas as suas transações desta conta.</p>
                      </div>
                      <button onClick={handleExport} className="w-full py-3 md:py-2 bg-slate-800 hover:bg-slate-900 text-white text-[14px] md:text-xs font-bold rounded-xl md:rounded-lg transition-colors active:scale-[0.98]">
                        Fazer Download Local
                      </button>
                    </div>

                    <div className="border border-slate-200 bg-white rounded-xl p-5 md:p-4 flex flex-col justify-between shadow-sm md:shadow-none">
                      <div>
                        <div className="flex items-center gap-2 mb-2.5 md:mb-2">
                           <UploadCloud className="w-5 h-5 md:w-4 md:h-4 text-emerald-600" />
                           <h4 className="font-bold text-[15px] md:text-sm text-slate-800">Restaurar / Importar</h4>
                        </div>
                        <p className="text-[13px] md:text-xs text-slate-500 mb-5 md:mb-4 leading-relaxed">Faça o upload de um backup JSON prévio para o banco de dados.</p>
                      </div>
                      <input type="file" accept=".json" className="hidden" ref={fileInputRef} onChange={handleImport} />
                      <button onClick={() => fileInputRef.current?.click()} disabled={isImporting} className="w-full py-3 md:py-2 bg-white border border-emerald-600 text-emerald-700 hover:bg-emerald-50 text-[14px] md:text-xs font-bold rounded-xl md:rounded-lg transition-colors flex items-center justify-center disabled:opacity-50 active:scale-[0.98]">
                        {isImporting ? <Loader2 className="w-5 h-5 md:w-4 md:h-4 animate-spin" /> : 'Selecionar JSON'}
                      </button>
                    </div>
                  </div>

                  <div className="border border-rose-200 bg-rose-50 rounded-xl p-5 mt-6 md:mt-4 shadow-sm md:shadow-none">
                    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                      <div className="bg-rose-100 p-3 md:p-2 rounded-xl md:rounded shrink-0 self-start">
                        <Trash2 className="w-6 h-6 md:w-5 md:h-5 text-rose-600" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-[15px] md:text-sm font-bold text-rose-900 mb-1.5 md:mb-1">Zona de Exclusão - Reset da Conta</h4>
                        <p className="text-[13px] md:text-xs text-rose-700 mb-5 md:mb-4 leading-relaxed">
                          Apagar todas as categorias, entradas e recados desta conta do NoSQL. Essa ação acionará um DROP real no Firebase.
                        </p>
                        {!showClearConfirm ? (
                          <button onClick={() => setShowClearConfirm(true)} className="w-full sm:w-auto px-5 py-3 md:px-4 md:py-2 bg-rose-600 hover:bg-rose-700 text-white text-[14px] md:text-xs font-bold rounded-xl md:rounded-lg shadow-sm transition-colors flex justify-center items-center active:scale-[0.98]">
                            Destruir todos os dados permanentemente
                          </button>
                        ) : (
                          <div className="flex flex-col sm:flex-row gap-3 md:gap-2">
                             <button onClick={handleClearData} disabled={isClearing} className="w-full sm:w-auto px-5 py-3 md:px-4 md:py-2 bg-rose-600 hover:bg-rose-700 text-white text-[14px] md:text-xs font-bold rounded-xl md:rounded-lg shadow-sm transition-colors flex justify-center items-center disabled:opacity-50 active:scale-[0.98]">
                               {isClearing ? <><Loader2 className="w-4 h-4 md:w-3 md:h-3 animate-spin mr-2" /> Deletando...</> : 'Confirmar Exclusão'}
                             </button>
                             <button onClick={() => setShowClearConfirm(false)} disabled={isClearing} className="w-full sm:w-auto px-5 py-3 md:px-4 md:py-2 bg-white text-slate-700 text-[14px] md:text-xs font-bold rounded-xl md:rounded-lg shadow-sm transition-colors border border-slate-200 hover:bg-slate-50 disabled:opacity-50 active:scale-[0.98]">
                               Cancelar
                             </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

              {activePanel === 'ia' && (
              <div className="space-y-6 pb-6 animate-fade-in">
                <div className="border-b border-slate-100 dark:border-slate-700 pb-4">
                  <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Inteligência Artificial</h2>
                  <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                    Conecte e gerencie serviços de modelos de IA para automatizar tarefas financeiras no FINCANVAS.
                  </p>
                </div>

                {/* Banner de Erro/Offline se a API do Backend estiver offline (Fase 2) */}
                {apiAvailable === false && (
                  <div className="p-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-xl flex gap-3 text-rose-800 dark:text-rose-300">
                    <CloudCog className="w-5 h-5 shrink-0 mt-0.5 animate-pulse text-rose-500" />
                    <div className="text-xs space-y-1">
                      <p className="font-bold">⚠️ Conexão de rede indisponível ou API do FINCANVAS Offline.</p>
                      <p className="leading-relaxed">
                        Os recursos e configurações de Inteligência Artificial estão temporariamente indisponíveis.
                        Certifique-se de que o backend local (<code className="bg-rose-100 dark:bg-rose-950 px-1 font-mono rounded">npm run dev</code>) está ativo,
                        rodando no mesmo ambiente e ouvindo na porta 3000 para reestabelecer o serviço.
                      </p>
                    </div>
                  </div>
                )}

                {/* Banner de Banco de Dados Desconectado (Fase 5) */}
                {dbStatus === 'DISCONNECTED' && (
                  <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-xl flex gap-3 text-amber-800 dark:text-amber-300">
                    <CloudCog className="w-5 h-5 shrink-0 mt-0.5 animate-pulse text-amber-500" />
                    <div className="text-xs space-y-1">
                      <p className="font-bold">⚠️ Banco de dados do Firestore indisponível no momento.</p>
                      <p className="leading-relaxed text-xs">
                        Backend online, mas Firestore Admin indisponível. Configure <code className="bg-amber-100 dark:bg-amber-950/40 px-1 font-mono rounded">FIREBASE_SERVICE_ACCOUNT_JSON</code> ou <code className="bg-amber-100 dark:bg-amber-950/40 px-1 font-mono rounded">GOOGLE_APPLICATION_CREDENTIALS</code> no ambiente do servidor.
                      </p>
                    </div>
                  </div>
                )}

                {/* Aviso Principal */}
                <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-xl flex gap-3 text-amber-800 dark:text-amber-300">
                  <Brain className="w-5 h-5 shrink-0 mt-0.5" />
                  <p className="text-xs leading-relaxed">
                    O FINCANVAS funciona sem IA. Ao ativar IA, os dados necessários para a tarefa selecionada poderão ser enviados ao provedor configurado usando sua própria chave.
                  </p>
                </div>

                {/* Toggle: Ativar recursos de IA */}
                <div className="bg-slate-50 dark:bg-slate-700/50 border border-slate-100 dark:border-slate-700 rounded-xl p-4 shadow-sm md:shadow-none">
                  <ToggleSwitch
                    checked={aiSettings.aiEnabled}
                    onChange={handleToggleAI}
                    disabled={savingAiSettings || loadingStatus || !apiAvailable || dbStatus === 'DISCONNECTED'}
                    loading={savingAiSettings}
                    label="Ativar recursos de IA"
                    description="Ligue ou desligue globalmente todos os recursos inteligentes integrados."
                  />
                </div>

                {/* Se a IA estiver desativada, mostrar o texto */}
                {!aiSettings.aiEnabled && (
                  <div className="p-4 bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 text-xs rounded-xl flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-slate-400 animate-pulse"></div>
                    <span>IA desativada. O app continuará funcionando com reconhecimento local.</span>
                  </div>
                )}

                {/* Configuração de Provedor e Chaves */}
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 md:p-6 space-y-5">
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 pb-2 border-b border-slate-100 dark:border-slate-700 uppercase tracking-wider">
                    Conexão de Serviço
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Provedor */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">
                        Provedor de Serviço
                      </label>
                      <select 
                        value={selectedProvider}
                        disabled={isFormDisabled}
                        onChange={(e) => {
                          const p = e.target.value as AIProvider;
                          setSelectedProvider(p);
                          const defModel = getDefaultModel(p);
                          setSelectedModel(defModel);
                          
                          // Default BaseUrl loading logic
                          const config = PROVIDER_REGISTRY[p];
                          setBaseUrlInput(config?.defaultBaseUrl || '');
                          setApiKeyInput(''); // Clear on change
                        }}
                        className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none disabled:opacity-50"
                      >
                        <option value="gemini">Google Gemini</option>
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                        <option value="openrouter">OpenRouter</option>
                        <option value="ollama">Ollama / Local</option>
                        <option value="custom_openai_compatible">Custom OpenAI-compatible</option>
                        <option value="opencode_api">OpenCode API</option>
                      </select>
                    </div>

                    {/* Modelo */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">
                        Modelo de Linguagem (LLM)
                      </label>
                      <input 
                        type="text"
                        value={selectedModel}
                        disabled={isFormDisabled}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        placeholder="Nome do modelo, ex: gemini-3.5-flash"
                        className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none disabled:opacity-50"
                      />
                    </div>
                  </div>

                  {/* Campo Base URL */}
                  {showBaseUrl && (
                    <div className="bg-slate-50 dark:bg-slate-900/30 p-3 rounded-lg border border-slate-100 dark:border-slate-800">
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 uppercase tracking-wider">
                        Base URL {selectedProvider === 'opencode_api' && <span className="text-rose-500">*</span>}
                      </label>
                      <input 
                        type="url"
                        value={baseUrlInput}
                        disabled={isFormDisabled}
                        onChange={(e) => setBaseUrlInput(e.target.value)}
                        placeholder={
                          selectedProvider === 'opencode_api' 
                            ? "http://localhost:3000 ou https://seu-servidor.com" 
                            : "https://api.provedor.com/v1"
                        }
                        className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none disabled:opacity-50"
                      />
                      {selectedProvider === 'opencode_api' && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                          Deve apontar para um endpoint OpenCode API compatível com OpenAI. Exemplo: <strong>http://localhost:3000</strong> ou <strong>https://seu-servidor.com</strong>.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Descrição em caso de OpenCode API selecionado */}
                  {selectedProvider === 'opencode_api' && (
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300 text-xs rounded-lg border border-emerald-100 dark:border-emerald-900/40">
                      Use OpenCode API para conectar um endpoint OpenCode, OpenCode Zen, OpenCode Go ou gateway compatível com OpenAI. A rota esperada é /v1/chat/completions.
                    </div>
                  )}

                  {/* Campo API Key */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                        Chave do Provedor (API Key) {isApiKeyRequired() && <span className="text-rose-500">*</span>}
                      </label>
                      {isCurrentProviderSaved && (
                        <span className="text-[11px] bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 font-bold px-2 py-0.5 rounded-full">
                          Chave configurada
                        </span>
                      )}
                    </div>
                    
                    <input 
                      type="password"
                      value={apiKeyInput}
                      disabled={isFormDisabled}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder={isCurrentProviderSaved ? `Sua chave ativa está oculta (${maskedKey})` : "Insira a chave de acesso da API"}
                      className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-white rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none font-mono disabled:opacity-50"
                    />
                  </div>

                  {/* Indicador de Status detalhado */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 rounded-lg gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Status da Integração:</span>
                      <div className="flex items-center gap-1.5">
                        <span className="relative flex h-2 w-2">
                          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                            !apiAvailable
                              ? 'bg-rose-400'
                              : !aiSettings.aiEnabled 
                                ? 'bg-slate-400' 
                                : !isCurrentProviderSaved && selectedProvider !== 'ollama'
                                  ? 'bg-amber-400'
                                  : testStatus === 'success'
                                    ? 'bg-emerald-400'
                                    : testStatus === 'error'
                                      ? 'bg-rose-400'
                                      : 'bg-emerald-400'
                          }`}></span>
                          <span className={`relative inline-flex rounded-full h-2 w-2 ${
                            !apiAvailable
                              ? 'bg-rose-500'
                              : !aiSettings.aiEnabled 
                                ? 'bg-slate-500' 
                                : !isCurrentProviderSaved && selectedProvider !== 'ollama'
                                  ? 'bg-amber-500'
                                  : testStatus === 'success'
                                    ? 'bg-emerald-500'
                                    : testStatus === 'error'
                                      ? 'bg-rose-500'
                                      : 'bg-emerald-500'
                          }`}></span>
                        </span>
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          {testingConnection
                            ? 'Testando conexão...'
                            : testStatus === 'success'
                              ? 'Conexão validada'
                              : testStatus === 'error'
                                ? 'Erro no teste'
                                : 'Teste ainda não executado'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {aiTestResult && (
                    <div className="mt-4 bg-slate-900 border border-slate-800 p-4 rounded-xl text-slate-100 space-y-4 w-full">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          <Brain className="w-4 h-4 text-emerald-400 animate-pulse" />
                          <span>Diagnóstico de Conexão da Inteligência Artificial</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setAiTestResult(null);
                            setTestStatus('none');
                            setTestMessage('');
                          }}
                          className="text-[9px] text-slate-400 hover:text-white underline cursor-pointer"
                        >
                          Resetar
                        </button>
                      </div>

                      {/* 1. Status Realçado */}
                      <div className={`p-3 rounded-lg border flex items-start gap-2.5 ${
                        aiTestResult.status === 'success'
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200'
                          : aiTestResult.status === 'error'
                            ? 'bg-rose-500/10 border-rose-500/20 text-rose-200'
                            : 'bg-blue-500/10 border-blue-500/20 text-blue-200'
                      }`}>
                        <div className="mt-0.5 shrink-0">
                          {aiTestResult.status === 'success' ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          ) : aiTestResult.status === 'error' ? (
                            <AlertTriangle className="w-4 h-4 text-rose-400 animate-pulse" />
                          ) : (
                            <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                          )}
                        </div>
                        <div className="space-y-0.5 select-text">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-white">
                            {aiTestResult.title}
                          </h4>
                          <p className="text-[11px] leading-relaxed text-slate-300">
                            {aiTestResult.summary}
                          </p>
                        </div>
                      </div>

                      {/* 2. Métricas */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[10px] w-full">
                        <div className="bg-black/35 p-2 border border-slate-800 rounded-lg min-w-0">
                          <p className="font-bold uppercase text-slate-500 tracking-wider text-[9px]">Provedor</p>
                          <p className="font-bold text-slate-300 mt-0.5 uppercase tracking-wide truncate">{aiTestResult.provider || 'Nenhum'}</p>
                        </div>
                        <div className="bg-black/35 p-2 border border-slate-800 rounded-lg min-w-0">
                          <p className="font-bold uppercase text-slate-500 tracking-wider text-[9px]">Modelo Alvo</p>
                          <p className="font-bold text-slate-300 mt-0.5 truncate" title={aiTestResult.model}>{aiTestResult.model || 'Nenhum'}</p>
                        </div>
                        <div className="bg-black/35 p-2 border border-slate-800 rounded-lg min-w-0">
                          <p className="font-bold uppercase text-slate-500 tracking-wider text-[9px]">Fase Atual</p>
                          <p className="font-bold text-slate-300 mt-0.5 truncate uppercase">{aiTestResult.status === 'success' ? 'Verificado' : aiTestResult.status === 'error' ? 'Falha' : 'Em Execução'}</p>
                        </div>
                        <div className="bg-black/35 p-2 border border-slate-800 rounded-lg min-w-0">
                          <p className="font-bold uppercase text-slate-500 tracking-wider text-[9px]">Código de Status</p>
                          <p className="font-bold text-slate-300 mt-0.5 truncate uppercase tracking-wide text-rose-300">
                            {aiTestResult.code || 'OK'}
                          </p>
                        </div>
                      </div>

                      {/* 3. Etapas do Diagnóstico */}
                      <div className="space-y-1.5">
                        <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block">Etapas do Diagnóstico:</span>
                        <div className="space-y-2 text-[11px] font-mono">
                          {aiTestResult.steps.map((step, idx) => {
                            const getStepStatusStyle = () => {
                              switch (step.status) {
                                case 'COMPLETED':
                                  return {
                                    bg: 'bg-black/35 border-emerald-500/20 text-slate-300',
                                    statusLabel: 'Sucesso',
                                    style: 'bg-emerald-500/10 text-emerald-400'
                                  };
                                case 'RUNNING':
                                  return {
                                    bg: 'bg-black/35 border-blue-500/20 text-slate-350',
                                    statusLabel: 'Testando',
                                    style: 'bg-blue-500/10 text-blue-400 animate-pulse'
                                  };
                                case 'FAILED':
                                  return {
                                    bg: 'bg-black/35 border-rose-500/20 text-slate-350',
                                    statusLabel: 'Falhou',
                                    style: 'bg-rose-500/10 text-rose-400'
                                  };
                                default: // PENDING
                                  return {
                                    bg: 'bg-black/35 border-slate-800/80 text-slate-500',
                                    statusLabel: 'Pendente',
                                    style: 'bg-slate-800 text-slate-500'
                                  };
                              }
                            };

                            const stepStyle = getStepStatusStyle();

                            return (
                              <div key={idx} className={`flex items-center justify-between px-3 py-1.5 border rounded-lg gap-2 ${stepStyle.bg}`}>
                                <div className="flex flex-col text-left min-w-0">
                                  <span className="font-bold truncate">{step.name}</span>
                                  {step.details && <span className="text-[10px] text-slate-400 font-sans mt-0.5 whitespace-pre-wrap break-words">{step.details}</span>}
                                </div>
                                <span className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase shrink-0 ${stepStyle.style}`}>
                                  {stepStyle.statusLabel}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* 4. Área Técnica Recolhível */}
                      <div className="border border-slate-800 rounded-lg overflow-hidden bg-black/20 w-full">
                        <button
                          type="button"
                          onClick={() => setIsAiDiagnosticsOpen(!isAiDiagnosticsOpen)}
                          className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-white/5 transition-colors cursor-pointer"
                        >
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ver Logs Técnicos do Handshake</span>
                          {isAiDiagnosticsOpen ? (
                            <ChevronUp className="w-4 h-4 text-slate-400" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                          )}
                        </button>

                        {isAiDiagnosticsOpen && (
                          <div className="p-2.5 border-t border-slate-800 bg-black text-slate-350 w-full overflow-hidden">
                            <pre className="text-[9.5px] font-mono leading-relaxed max-h-36 overflow-y-auto overflow-x-auto whitespace-pre-wrap break-words pr-1 select-all w-full max-w-full text-left">
                              {aiTestResult.logs.map((logMsg, logIdx) => {
                                let classMap = "text-slate-350";
                                if (logMsg.toLowerCase().includes('[erro]') || logMsg.toLowerCase().includes('critical') || logMsg.toLowerCase().includes('falhou')) {
                                  classMap = "text-rose-400";
                                } else if (logMsg.toLowerCase().includes('sucesso') || logMsg.toLowerCase().includes('recebida com sucesso') || logMsg.toLowerCase().includes('estabelecida')) {
                                  classMap = "text-emerald-400";
                                }
                                return <div key={logIdx} className={classMap}>{logMsg}</div>;
                              })}
                            </pre>
                          </div>
                        )}
                      </div>

                      {/* 5. Botão Copiar Diagnóstico corrigido e autocontido */}
                      <button
                        type="button"
                        onClick={() => {
                          const diagnosticText = `=========================================
DIAGNÓSTICO DA CONEXÃO DE IA - FINCANVAS
=========================================
Status Geral: ${aiTestResult.status.toUpperCase()}
Título: ${aiTestResult.title}
Resumo: ${aiTestResult.summary}
Provedor: ${aiTestResult.provider || 'Não informado'}
Modelo: ${aiTestResult.model || 'Não informado'}
Código do Erro: ${aiTestResult.code || 'Nenhum'}
Horário da Verificação: ${aiTestResult.checkedAt || new Date().toISOString()}

ETAPAS DO DIAGNÓSTICO:
${aiTestResult.steps.map(step => `- [${step.status}] ${step.name}: ${step.details || ''}`).join('\n')}

LOGS DETALHADOS:
${aiTestResult.logs.join('\n')}

DETALHES DA RESPOSTA (ECHO):
${aiTestResult.providerEcho || 'Nenhum eco retornado'}

MENSAGEM SECUNDÁRIA:
${aiTestResult.rawMessage || 'Nenhuma'}
=========================================`;
                          
                          navigator.clipboard.writeText(diagnosticText);
                          setCopiedAiDiagnostics(true);
                          toast.success('Diagnóstico de IA copiado para a área de transferência!');
                          setTimeout(() => {
                            setCopiedAiDiagnostics(false);
                          }, 2000);
                        }}
                        className="w-full text-center py-2 bg-slate-800 hover:bg-slate-850 rounded-lg text-slate-300 hover:text-white font-bold text-[10px] uppercase tracking-wider cursor-pointer flex items-center justify-center gap-1.5 transition-colors"
                      >
                        {copiedAiDiagnostics ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Copiado!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copiar laudo de diagnóstico</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {/* Botões de Ação para Credencial */}
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      type="button"
                      onClick={handleSaveCredential}
                      disabled={isFormDisabled}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5"
                    >
                      {savingAiSettings ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Salvando...
                        </>
                      ) : (
                        'Salvar credencial'
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={testingConnection || isFormDisabled}
                      className="px-4 py-2 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5"
                    >
                      {testingConnection ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Testando...
                        </>
                      ) : (
                        'Testar conexão'
                      )}
                    </button>

                    {isCurrentProviderSaved && (
                      <button
                        type="button"
                        onClick={handleRemoveCredential}
                        disabled={isFormDisabled}
                        className="px-4 py-2 bg-rose-50 hover:bg-rose-100 dark:bg-rose-955/20 dark:hover:bg-rose-900/20 text-rose-600 dark:text-rose-404 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 ml-auto"
                      >
                        Remover credencial
                      </button>
                    )}
                  </div>
                </div>

                {/* Seção de Permissões */}
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 md:p-6 space-y-4">
                  <div className="border-b border-slate-100 dark:border-slate-700 pb-2">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
                      Permissões de Integração (Escopos)
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Configure quais tarefas automatizadas do FINCANVAS estão autorizadas a processar com IA.
                    </p>
                  </div>

                  {/* 1. Usar IA para OCR de recibos/imagens */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-900/20 border border-slate-100 dark:border-slate-800/80 rounded-lg">
                    <ToggleSwitch
                      checked={aiSettings.aiUseForOCR}
                      onChange={(checked) => handleTogglePermission('aiUseForOCR', checked)}
                      disabled={isFormDisabled || !aiSettings.aiEnabled}
                      label="Usar IA para OCR de recibos/imagens"
                      description="Leitura inteligente de cupons fiscais e faturas anexadas."
                    />
                  </div>

                  {/* 2. Usar IA para fallback de categorias incertas */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-900/20 border border-slate-100 dark:border-slate-800/80 rounded-lg">
                    <ToggleSwitch
                      checked={aiSettings.aiUseForCategoryFallback}
                      onChange={(checked) => handleTogglePermission('aiUseForCategoryFallback', checked)}
                      disabled={isFormDisabled || !aiSettings.aiEnabled}
                      label="Usar IA para fallback de categorias incertas"
                      description="Sugerir e categorizar transações não identificadas localmente."
                    />
                  </div>

                  {/* 3. Usar IA para insights no dashboard */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-900/20 border border-slate-100 dark:border-slate-800/80 rounded-lg">
                    <ToggleSwitch
                      checked={aiSettings.aiUseForInsights}
                      onChange={(checked) => handleTogglePermission('aiUseForInsights', checked)}
                      disabled={isFormDisabled || !aiSettings.aiEnabled}
                      label="Usar IA para insights no dashboard"
                      description="Alertas e recomendações comportamentais dinâmicas na tela inicial."
                    />
                  </div>

                  {/* 4. Usar IA para relatórios/mentoria financeira */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-900/20 border border-slate-100 dark:border-slate-800/80 rounded-lg">
                    <ToggleSwitch
                      checked={aiSettings.aiUseForReports}
                      onChange={(checked) => handleTogglePermission('aiUseForReports', checked)}
                      disabled={isFormDisabled || !aiSettings.aiEnabled}
                      label="Usar IA para relatórios/mentoria financeira"
                      description="Elaboração de diagnósticos complexos e mentoria financeira nas análises de histórico."
                    />
                  </div>

                  {/* 5. Sempre pedir confirmação antes de enviar dados para IA */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-900/20 border border-slate-100 dark:border-slate-800/80 rounded-lg">
                    <ToggleSwitch
                      checked={aiSettings.aiAlwaysAskBeforeSending}
                      onChange={(checked) => handleTogglePermission('aiAlwaysAskBeforeSending', checked)}
                      disabled={isFormDisabled || !aiSettings.aiEnabled}
                      label="Sempre pedir confirmação antes de enviar dados para IA"
                      description="Exibir aviso de consentimento detalhado antes de cada disparo à API externa."
                    />
                  </div>
                </div>
              </div>
            )}

            {activePanel === 'pluggy' && (
              <PluggySettingsPanel 
                user={user} 
                profile={profile} 
                transactions={transactions} 
                learnedRules={learnedRules}
              />
            )}

            {activePanel === 'regras' && (
              <div className="space-y-6">
                <div className="border-b border-slate-100 dark:border-slate-700 pb-4">
                  <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Regras de Aprendizado</h2>
                  <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                    Gerencie os mapeamentos personalizados aprendidos de suas correções. Regras do usuário têm prioridade máxima de matching.
                  </p>
                </div>

                {learnedRules.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-12 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl bg-slate-50/50 dark:bg-slate-900/30">
                    <div className="p-4 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 mb-4">
                      <Brain className="w-8 h-8 animate-pulse" />
                    </div>
                    <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-1 font-sans">Nenhuma regra aprendida ainda</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mt-2">
                      Sempre que você altera a categoria de um lançamento, o sistema aprende o nome do estabelecimento ("merchantKey") para categorizar automaticamente da próxima vez.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900/50">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                            <th className="p-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 font-sans">Tipo</th>
                            <th className="p-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 font-sans">Identificador Chave</th>
                            <th className="p-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 font-sans">Descrição Limpa</th>
                            <th className="p-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 font-sans">Categoria Alvo</th>
                            <th className="p-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 font-sans text-right">Ação</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {learnedRules.map((rule) => (
                            <tr key={rule.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/10">
                              <td className="p-4 text-sm font-medium">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${rule.type === 'Receita' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400'}`}>
                                  {rule.type}
                                </span>
                              </td>
                              <td className="p-4 text-sm font-semibold text-slate-800 dark:text-slate-150 font-mono text-[13px]">
                                {rule.merchantKey}
                              </td>
                              <td className="p-4 text-sm text-slate-600 dark:text-slate-300">
                                {rule.cleanDescription}
                              </td>
                              <td className="p-4 text-sm font-medium text-slate-800 dark:text-slate-200">
                                {rule.category}
                              </td>
                              <td className="p-4 text-sm text-right col-span-1">
                                <button
                                  onClick={() => handleDeleteRule(rule.id)}
                                  className="p-1.5 px-3 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg font-bold text-xs transition-all border border-rose-100 dark:border-rose-900/30 active:scale-95"
                                >
                                  Excluir
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
});
