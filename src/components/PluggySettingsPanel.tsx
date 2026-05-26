import React, { useState, useEffect, useRef } from 'react';
import { doc, updateDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, Transaction } from '../App';
import { User } from 'firebase/auth';
import { 
  KeyRound, Eye, EyeOff, Check, Trash2, Loader2, Database, Info, 
  CheckCircle2, ChevronRight, Key, RefreshCw, Radio, CreditCard, Link, Copy, AlertTriangle, ShieldCheck, ChevronDown, Settings2, Sliders
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';

interface PluggySettingsPanelProps {
  user: User;
  profile: UserProfile;
  transactions: Transaction[];
}

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

export function PluggySettingsPanel({ user, profile, transactions }: PluggySettingsPanelProps) {
  // --- ESTADOS DE API PLUGGY ---
  const [pluggyClientId, setPluggyClientId] = useState(profile.pluggyClientId || localStorage.getItem('PREF_PLUGGY_CLIENT_ID') || '');
  const [pluggyClientSecret, setPluggyClientSecret] = useState((profile.pluggyClientSecret || localStorage.getItem('PREF_PLUGGY_CLIENT_SECRET')) ? '••••••••••••••••' : '');
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [storageMethod, setStorageMethod] = useState<'cloud' | 'local'>(localStorage.getItem('PREF_PLUGGY_CLIENT_SECRET') ? 'local' : 'cloud');
  const [isSavingCustomKeys, setIsSavingCustomKeys] = useState(false);
  const [isPluggyConfiguredOnServer, setIsPluggyConfiguredOnServer] = useState(false);
  const [manualItemIdInput, setManualItemIdInput] = useState('');
  const [isLoadingConnect, setIsLoadingConnect] = useState(false);
  const [isTestingPluggy, setIsTestingPluggy] = useState(false);
  const [isSyncingPluggy, setIsSyncingPluggy] = useState(false);
  const [isCreatingSandbox, setIsCreatingSandbox] = useState(false);
  const [pluggySyncStep, setPluggySyncStep] = useState('');
  const [pluggyItems, setPluggyItems] = useState<any[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [diagnoseSteps, setDiagnoseSteps] = useState<any[] | null>(null);
  const [diagnoseLogs, setDiagnoseLogs] = useState<string[]>([]);
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});

  // Accordions status
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [isWebhooksOpen, setIsWebhooksOpen] = useState(false);
  const [isCredentialsFormOpen, setIsCredentialsFormOpen] = useState(false);

  // --- ESTADOS DOS WEBHOOKS PLUGGY ---
  const [pluggyWebhooks, setPluggyWebhooks] = useState<any[]>([]);
  const [isLoadingWebhooks, setIsLoadingWebhooks] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [isRegisteringWebhook, setIsRegisteringWebhook] = useState(false);
  const [capturedEvents, setCapturedEvents] = useState<any[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);

  // --- REQUISITOS DE AUXILIARES ---
  const getPluggyHeaders = () => {
    let cid = pluggyClientId;
    let csec = pluggyClientSecret;

    if (csec === '••••••••••••••••') {
      csec = localStorage.getItem('PREF_PLUGGY_CLIENT_SECRET') || profile.pluggyClientSecret || '';
    }

    if (!cid) {
      cid = localStorage.getItem('PREF_PLUGGY_CLIENT_ID') || profile.pluggyClientId || '';
    }
    if (!csec) {
      csec = localStorage.getItem('PREF_PLUGGY_CLIENT_SECRET') || profile.pluggyClientSecret || '';
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (cid && cid.trim()) {
      headers['x-pluggy-client-id'] = cid.trim();
      headers['pluggyClientId'] = cid.trim();
    }
    if (csec && csec.trim()) {
      headers['x-pluggy-client-secret'] = csec.trim();
      headers['pluggyClientSecret'] = csec.trim();
    }

    return headers;
  };

  const checkHasPluggyKeys = () => {
    const headers = getPluggyHeaders();
    return !!(headers['x-pluggy-client-id'] && headers['x-pluggy-client-secret']);
  };
  const hasPluggyKeys = isPluggyConfiguredOnServer || checkHasPluggyKeys();

  // --- COPIAR PARA ÁREA DE TRANSFERÊNCIA ---
  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedStates(prev => ({ ...prev, [key]: true }));
    toast.success('Copiado para a área de transferência!');
    setTimeout(() => {
      setCopiedStates(prev => ({ ...prev, [key]: false }));
    }, 2000);
  };

  // --- SALVAR CREDENCIAIS ---
  const handleSaveCustomKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pluggyClientId.trim()) {
      toast.error('O Client ID é obrigatório.');
      return;
    }
    if (!pluggyClientSecret.trim()) {
      toast.error('O Client Secret é obrigatório.');
      return;
    }

    setIsSavingCustomKeys(true);
    try {
      let actualSecret = pluggyClientSecret;
      if (pluggyClientSecret === '••••••••••••••••') {
        actualSecret = localStorage.getItem('PREF_PLUGGY_CLIENT_SECRET') || profile.pluggyClientSecret || '';
      }

      if (storageMethod === 'local') {
        localStorage.setItem('PREF_PLUGGY_CLIENT_ID', pluggyClientId.trim());
        localStorage.setItem('PREF_PLUGGY_CLIENT_SECRET', actualSecret.trim());
        
        await updateDoc(doc(db, 'users', user.uid), {
          pluggyClientId: '',
          pluggyClientSecret: '',
          updatedAt: serverTimestamp()
        });
      } else {
        await updateDoc(doc(db, 'users', user.uid), {
          pluggyClientId: pluggyClientId.trim(),
          pluggyClientSecret: actualSecret.trim(),
          updatedAt: serverTimestamp()
        });

        localStorage.removeItem('PREF_PLUGGY_CLIENT_ID');
        localStorage.removeItem('PREF_PLUGGY_CLIENT_SECRET');
      }

      toast.success('Credenciais salvas com sucesso!');
      setIsCredentialsFormOpen(false);
      await loadPluggyItems();
    } catch (err) {
      console.error(err);
      toast.error('Erro ao salvar as credenciais da Pluggy.');
    } finally {
      setIsSavingCustomKeys(false);
    }
  };

  const handleRemoveCustomKeys = async () => {
    if (!window.confirm('Tem certeza que deseja apagar suas credenciais personalizadas da Pluggy?')) return;
    
    setIsSavingCustomKeys(true);
    try {
      localStorage.removeItem('PREF_PLUGGY_CLIENT_ID');
      localStorage.removeItem('PREF_PLUGGY_CLIENT_SECRET');
      
      await updateDoc(doc(db, 'users', user.uid), {
        pluggyClientId: '',
        pluggyClientSecret: '',
        updatedAt: serverTimestamp()
      });

      setPluggyClientId('');
      setPluggyClientSecret('');
      toast.success('Chaves de API removidas com sucesso.');
      setPluggyItems([]);
      setIsCredentialsFormOpen(false);
    } catch (err) {
      console.error(err);
      toast.error('Falha ao remover chaves.');
    } finally {
      setIsSavingCustomKeys(false);
    }
  };

  // --- CONECTAR COM PLUGGY CONNECT ---
  const handleOpenPluggyConnect = async (reconnectItemId?: string) => {
    setIsLoadingConnect(true);
    try {
      const res = await fetch('/api/pluggy/connect_token', {
        method: 'POST',
        headers: getPluggyHeaders(),
        body: JSON.stringify({ clientUserId: user.uid, itemId: reconnectItemId })
      });
      const data = await safeJsonClient(res);
      if (!res.ok || !data.success || !data.connectToken) {
        throw new Error(data.error || 'Erro ao gerar token para o Pluggy Connect.');
      }

      const connectToken = data.connectToken;

      if (!(window as any).PluggyConnect) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://connect.pluggy.ai/v2/connect.js';
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Erro ao carregar script do Pluggy Connect.'));
          document.body.appendChild(script);
        });
      }

      const pluggyConnect = new (window as any).PluggyConnect({
        connectToken,
        onSuccess: async (connectData: any) => {
          console.log('[Pluggy Connect SUCCESS event]:', connectData);
          const itemId = connectData.item?.id;
          if (itemId) {
            toast.success(`Conexão com ${connectData.item?.connector?.name || 'sua instituição'} efetuada com sucesso!`);
            
            try {
              toast.loading('Validando conexão com a Pluggy...', { id: 'validate-new-item' });
              const valRes = await fetch('/api/pluggy/validate_item', {
                method: 'POST',
                headers: getPluggyHeaders(),
                body: JSON.stringify({ itemId })
              });
              const valData = await safeJsonClient(valRes);
              if (valRes.ok && valData.ok) {
                const currentItemIds = profile.pluggyItemIds || [];
                if (!currentItemIds.includes(itemId)) {
                  await updateDoc(doc(db, 'users', user.uid), {
                    pluggyItemIds: [...currentItemIds, itemId],
                    updatedAt: serverTimestamp()
                  });
                }
                toast.dismiss('validate-new-item');
                toast.success(`Conta sincronizada e conectada: ${valData.item?.connector || 'Pluggy'}!`);
                await loadPluggyItems();
              } else {
                toast.dismiss('validate-new-item');
                toast.error(valData.message || 'Falha ao validar a nova conexão.');
              }
            } catch (err: any) {
              toast.dismiss('validate-new-item');
              console.error(err);
              toast.error('Erro na validação pós-conexão.');
            }
          }
        },
        onError: (error: any) => {
          console.error('[Pluggy Connect ERROR event]:', error);
          toast.error('Ocorreu um erro no widget da Pluggy.');
        }
      });

      if (typeof pluggyConnect.init === 'function') {
        pluggyConnect.init();
      } else if (typeof pluggyConnect.open === 'function') {
        pluggyConnect.open();
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Erro ao inicializar o Pluggy Connect.');
    } finally {
      setIsLoadingConnect(false);
    }
  };

  // --- TESTAR CONEXÃO & DIAGNÓSTICO ---
  const handleTestPluggyKeys = async () => {
    if (!hasPluggyKeys) {
      toast.error('Adicione as credenciais do Pluggy antes de testar.');
      return;
    }
    setIsTestingPluggy(true);
    setDiagnoseSteps([
      { name: "Verificação de Parâmetros", status: "RUNNING", details: "Lendo campos..." },
      { name: "Handshake de Autenticação", status: "PENDING", details: "Aguardando..." },
      { name: "Mapeamento de Workspace", status: "PENDING", details: "Aguardando..." },
      { name: "Verificação de Itens Relacionados", status: "PENDING", details: "Aguardando..." }
    ]);
    setDiagnoseLogs(["[Preflight] Iniciando checagem detalhada de rotas..."]);
    
    try {
      const res = await fetch('/api/pluggy/diagnose', {
        method: 'POST',
        headers: getPluggyHeaders(),
        body: JSON.stringify({
          itemIds: profile.pluggyItemIds || []
        })
      });
      const data = await safeJsonClient(res);
      if (data.steps) {
        setDiagnoseSteps(data.steps);
      }
      if (data.logs) {
        setDiagnoseLogs(data.logs);
      }
      
      if (res.ok && data.success) {
        toast.success('Par de credenciais Pluggy testado e validado com sucesso!');
        setIsDiagnosticsOpen(true); // Open diagnostics to show green steps
        await loadPluggyItems();
      } else {
        toast.error(data.error || 'Falha no diagnóstico das chaves Pluggy.');
      }
    } catch (err: any) {
      console.error(err);
      setDiagnoseLogs(prev => [...prev, `[ERRO] Falha ao contatar servidor de diagnóstico: ${err.message || err}`]);
      toast.error('Não foi possível se comunicar com o sistema de diagnóstico.');
    } finally {
      setIsTestingPluggy(false);
    }
  };

  // --- PROVISIONAR SANDBOX (ITAÚ SANDBOX) ---
  const handleCreateSandbox = async () => {
    if (!hasPluggyKeys) {
      toast.error('Configure e salve as chaves da Pluggy antes de obter bancos de teste.');
      return;
    }
    setIsCreatingSandbox(true);
    try {
      const res = await fetch('/api/pluggy/create_sandbox', {
        method: 'POST',
        headers: getPluggyHeaders(),
        body: JSON.stringify({ bankConnectorId: 2 })
      });
      const data = await safeJsonClient(res);
      if (res.ok && data.success) {
        const itemId = data.item?.id;
        if (itemId) {
          const currentItemIds = profile.pluggyItemIds || [];
          if (!currentItemIds.includes(itemId)) {
            const updatedItemIds = [...currentItemIds, itemId];
            await updateDoc(doc(db, 'users', user.uid), {
              pluggyItemIds: updatedItemIds,
              updatedAt: serverTimestamp()
            });
          }
        }
        toast.success('Banco de testes (Itaú Sandbox) adicionado à sua conta Pluggy!');
        await loadPluggyItems();
      } else {
        toast.error(data.error || 'Houve um erro no provisionamento do sandbox.');
      }
    } catch (err) {
      console.error(err);
      toast.error('Erro ao acionar provisionamento.');
    } finally {
      setIsCreatingSandbox(false);
    }
  };

  // --- VALIDAR E VINCULAR ITEM ID MANUAL ---
  const handleSaveManualItemId = async () => {
    const rawId = manualItemIdInput.trim();
    if (!rawId) {
      toast.error('O campo do ID não pode estar vazio.');
      return;
    }
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(rawId)) {
      toast.error('O ID informado é inválido. Certifique-se de que é um UUID de conexão válido do Pluggy.');
      return;
    }

    const currentItemIds = profile.pluggyItemIds || [];
    if (currentItemIds.includes(rawId)) {
      toast.error('Este Item ID já está cadastrado nesta conta.');
      return;
    }

    try {
      toast.loading('Validando ID de Conexão com a Pluggy...', { id: 'validate-item' });
      const valRes = await fetch('/api/pluggy/validate_item', {
        method: 'POST',
        headers: getPluggyHeaders(),
        body: JSON.stringify({ itemId: rawId })
      });
      const valData = await safeJsonClient(valRes);
      
      if (!valRes.ok || !valData.ok) {
        toast.dismiss('validate-item');
        toast.error(valData.message || 'ID de conexão inválido ou inacessível.');
        return;
      }

      const updatedItemIds = [...currentItemIds, rawId];
      await updateDoc(doc(db, 'users', user.uid), {
        pluggyItemIds: updatedItemIds,
        updatedAt: serverTimestamp()
      });
      setManualItemIdInput('');
      toast.dismiss('validate-item');
      toast.success(`ID de Conexão (${valData.item?.connector || 'Pluggy'}) cadastrado e validado com sucesso!`);
      await loadPluggyItems();
    } catch (err: any) {
      toast.dismiss('validate-item');
      console.error(err);
      toast.error('Erro ao salvar o ID ou validar no Firestore.');
    }
  };

  const handleRemoveManualItemId = async (idPost: string) => {
    if (!window.confirm(`Deseja desativar e desvincular o Item ID ${idPost}?`)) {
      return;
    }
    try {
      const updatedItemIds = (profile.pluggyItemIds || []).filter((item: string) => item !== idPost);
      await updateDoc(doc(db, 'users', user.uid), {
        pluggyItemIds: updatedItemIds,
        updatedAt: serverTimestamp()
      });
      toast.success('ID de Conexão removido com sucesso!');
      await loadPluggyItems();
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao remover o ID do Firestore.');
    }
  };

  // --- CARREGAR CONEXÕES ---
  const loadPluggyItems = async () => {
    const headers = getPluggyHeaders();
    if (!hasPluggyKeys) return;
    setIsLoadingItems(true);
    try {
      const res = await fetch('/api/pluggy/list_items', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemIds: profile.pluggyItemIds || []
        })
      });
      const data = await safeJsonClient(res);
      if (res.ok && data.success) {
        setPluggyItems(data.items || []);
      } else {
        console.warn(data.error || 'Erro ao carregar conexões do Pluggy.');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingItems(false);
    }
  };

  const handleDeletePluggyItem = async (itemId: string) => {
    if (!window.confirm('Tem certeza que deseja remover esta conexão bancária da sua conta Pluggy? Esta ação removerá o consentimento de acesso.')) {
      return;
    }
    try {
      const res = await fetch('/api/pluggy/delete_item', {
        method: 'POST',
        headers: getPluggyHeaders(),
        body: JSON.stringify({ itemId })
      });
      const data = await safeJsonClient(res);
      if (res.ok && data.success) {
        toast.success(data.message || 'Conexão deletada com sucesso!');
        const updatedItemIds = (profile.pluggyItemIds || []).filter((id: string) => id !== itemId);
        await updateDoc(doc(db, 'users', user.uid), {
          pluggyItemIds: updatedItemIds,
          updatedAt: serverTimestamp()
        });
        await loadPluggyItems();
      } else {
        toast.error(data.error || 'Erro ao remover conexão da Pluggy.');
      }
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao acionar a exclusão.');
    }
  };

  // --- SINCRONIZAR TRANSACÕES EM LOTE ---
  const handleSyncPluggyTransactions = async () => {
    if (!hasPluggyKeys) {
      toast.error('A integração da Pluggy não está configurada e ativada.');
      return;
    }
    setIsSyncingPluggy(true);
    setPluggySyncStep('Iniciando handshake seguro com a API do Pluggy...');
    try {
      const res = await fetch('/api/pluggy/sync', {
        method: 'POST',
        headers: getPluggyHeaders(),
        body: JSON.stringify({
          categories: profile.categories || [],
          itemIds: profile.pluggyItemIds || []
        })
      });

      const data = await safeJsonClient(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Ocorreu um problema de canal no servidor.');
      }

      const list: any[] = data.transactions || [];
      if (data.message) {
        toast.info(data.message);
      }

      if (list.length === 0) {
        setPluggySyncStep('Verificado: Nenhuma nova transação encontrada nos últimos 30 dias.');
        toast.success('Sincronização concluída! Tudo atualizado.');
        return;
      }

      setPluggySyncStep(`Localizados ${list.length} registros. Verificando duplicidades...`);

      const existingCounts: Record<string, number> = {};
      const existingPluggyIds = new Set<string>();

      for (const t of transactions) {
        if (t.pluggyId) {
          existingPluggyIds.add(t.pluggyId);
        }
        const key = makeKey(t.date, t.desc, t.amount, t.source, t.type);
        existingCounts[key] = (existingCounts[key] || 0) + 1;
      }

      const filterToInsert: any[] = [];
      let skippedCount = 0;

      for (const candidate of list) {
        if (candidate.pluggyId && existingPluggyIds.has(candidate.pluggyId)) {
          skippedCount++;
          continue;
        }
        const key = makeKey(candidate.date, candidate.desc, candidate.amount, candidate.source, candidate.type);
        if (existingCounts[key] && existingCounts[key] > 0) {
          existingCounts[key]--;
          skippedCount++;
        } else {
          filterToInsert.push(candidate);
        }
      }

      if (filterToInsert.length === 0) {
        setPluggySyncStep(`Concluído: ${skippedCount} entradas descartadas por já estarem registradas.`);
        toast.success(`Tudo atualizado! Todas as novas transações já constavam no sistema.`);
        return;
      }

      setPluggySyncStep(`Análise com IA concluída. Gravando ${filterToInsert.length} novas transações no Firestore...`);

      const colRef = doc(db, 'users', user.uid); // dummy to fetch collection securely
      const transactionsCollectionRef = doc(db, 'transactions', 'dummy').parent; // node path

      for (const itemToSave of filterToInsert) {
        const docRef = doc(transactionsCollectionRef);
        await setDoc(docRef, {
          date: itemToSave.date,
          desc: itemToSave.desc,
          cat: itemToSave.cat,
          type: itemToSave.type,
          amount: itemToSave.amount,
          source: itemToSave.source,
          pluggyId: itemToSave.pluggyId,
          userId: user.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        } as any);
      }

      setPluggySyncStep(`Importação concluída. ${filterToInsert.length} transações adicionadas e categorizadas com IA.`);
      toast.success(`${filterToInsert.length} transações importadas com sucesso!`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Houve uma falha na sincronização.');
      setPluggySyncStep('Ocorreu um erro inesperado na sincronização.');
    } finally {
      setIsSyncingPluggy(false);
    }
  };

  // --- WEBHOOKS INTEGRATION ---
  const loadPluggyWebhooks = async () => {
    if (!hasPluggyKeys) return;
    setIsLoadingWebhooks(true);
    try {
      const res = await fetch('/api/pluggy/list_webhooks', {
        method: 'POST',
        headers: getPluggyHeaders(),
        body: JSON.stringify({})
      });
      const data = await safeJsonClient(res);
      if (res.ok && data.success) {
        setPluggyWebhooks(data.webhooks || []);
      } else {
        console.warn(data.error || 'Erro ao carregar webhooks.');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingWebhooks(false);
    }
  };

  const handleRegisterWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasPluggyKeys) {
      toast.error('Configure as chaves Pluggy antes de criar webhooks.');
      return;
    }
    if (!webhookUrl.trim()) {
      toast.error('URL do webhook é obrigatória.');
      return;
    }
    setIsRegisteringWebhook(true);
    try {
      const res = await fetch('/api/pluggy/create_webhook', {
        method: 'POST',
        headers: getPluggyHeaders(),
        body: JSON.stringify({
          event: 'item/updated',
          url: webhookUrl.trim()
        })
      });
      const data = await safeJsonClient(res);
      if (res.ok && data.success) {
        toast.success('Webhook registrado com sucesso!');
        await loadPluggyWebhooks();
      } else {
        toast.error(data.error || 'Falha ao registrar webhook.');
      }
    } catch (err: any) {
      console.error(err);
      toast.error('Erro de requisição ao salvar webhook.');
    } finally {
      setIsRegisteringWebhook(false);
    }
  };

  const handleDeleteWebhook = async (webhookId: string) => {
    if (!window.confirm('Tem certeza que deseja apagar o registro desse webhook no Pluggy?')) return;
    try {
      const res = await fetch('/api/pluggy/delete_webhook', {
        method: 'POST',
        headers: getPluggyHeaders(),
        body: JSON.stringify({ webhookId })
      });
      const data = await safeJsonClient(res);
      if (res.ok && data.success) {
        toast.success('Webhook excluído do Pluggy!');
        await loadPluggyWebhooks();
      } else {
        toast.error(data.error || 'Falha ao remover webhook.');
      }
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao excluir webhook.');
    }
  };

  const loadCapturedEvents = async () => {
    setIsLoadingEvents(true);
    try {
      const res = await fetch('/api/pluggy/webhook_events');
      const data = await safeJsonClient(res);
      if (res.ok && data.success) {
        setCapturedEvents(data.events || []);
      }
    } catch (err) {
      console.error('Erro ao buscar eventos do log:', err);
    } finally {
      setIsLoadingEvents(false);
    }
  };

  // --- INITIAL CHECK & TIMED INTERVAL LOAD (ONLY WHEN OPENED) ---
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setWebhookUrl(window.location.origin + '/api/pluggy/webhook_listener');
    }
    const checkServerCredentials = async () => {
      try {
        const res = await fetch('/api/pluggy/credentials_status');
        const data = await safeJsonClient(res);
        if (data.configured) {
          setIsPluggyConfiguredOnServer(true);
        }
      } catch (err) {
        console.error('Erro ao verificar credenciais do servidor:', err);
      }
    };
    checkServerCredentials();
  }, []);

  useEffect(() => {
    if (hasPluggyKeys) {
      loadPluggyItems();
      loadPluggyWebhooks();
      loadCapturedEvents();
    }
  }, [hasPluggyKeys, profile.pluggyItemIds]);

  // --- DERIVED GENERAL STATES (Phase 5) ---
  const hasOutdatedItems = pluggyItems.some(i => ["OUTDATED", "LOGIN_ERROR", "NEEDS_RECONNECT"].includes(i.status));
  const currentCredentialsState = !hasPluggyKeys ? "CredentialsAbsent" : "CredentialsConfigured";
  const itemIdsState = (!profile.pluggyItemIds || profile.pluggyItemIds.length === 0) ? "AwaitingItemIds" : "ItemIdsConfigured";

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto pb-12">
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 italic font-sans flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-emerald-500 shrink-0" />
            Integração Bancária
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Conecte suas contas com segurança utilizando a tecnologia <strong>Pluggy</strong>. Sincronize transações de forma automática e conte com o Gemini IA para enriquecer categoricamente suas finanças.
          </p>
        </div>
        
        {/* GLOBAL BADGE ON TOP */}
        <div className="flex shrink-0">
          {!hasPluggyKeys ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/40">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
              Credenciais Ausentes
            </span>
          ) : hasOutdatedItems ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/40 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
              Ação Requerida (Reconectar)
            </span>
          ) : itemIdsState === "AwaitingItemIds" ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/40">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
              Aguardando Primeira Conexão
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/40">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              Integração Ativa
            </span>
          )}
        </div>
      </div>

      {/* CHIA DE ALERTA SE CREDENCIAIS AUSENTES */}
      {!hasPluggyKeys && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/10 dark:to-orange-950/10 p-5 rounded-2xl border border-amber-200 dark:border-amber-900/30 flex flex-col md:flex-row gap-4 items-start md:items-center">
          <div className="bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 p-3 rounded-xl shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h4 className="font-bold text-sm text-amber-900 dark:text-amber-400">Servidor de Integração sem Configurações</h4>
            <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
              Para liberar o sincronismo automático e conectar suas contas reais, você precisa fornecer as credenciais do console administrativo do Pluggy.
            </p>
          </div>
          <button 
            type="button"
            onClick={() => setIsCredentialsFormOpen(true)}
            className="md:ml-auto w-full md:w-auto px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors shrink-0 whitespace-nowrap active:scale-[0.98]"
            aria-label="Abrir formulário de credenciais"
          >
            Adicionar Credenciais agora
          </button>
        </div>
      )}

      {/* GRID LAYOUT FOR DESKTOP */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
        
        {/* LEFT COLUMN - PRIMARY FLOW */}
        <div className="space-y-6">
          
          {/* FASE 7: AUTOMATIC CONNECTION VIA PLUGGY CONNECT */}
          {hasPluggyKeys && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
              <div className="flex gap-4">
                <div className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 p-3 rounded-xl shrink-0 h-fit">
                  <Link className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200">Conectar conta de forma automática</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Clique no botão abaixo para iniciar o fluxo oficial e seguro do <strong>Pluggy Connect</strong>. Você escolherá seu banco e digitará suas credenciais diretamente no ambiente blindado.
                  </p>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => handleOpenPluggyConnect()}
                  disabled={isLoadingConnect}
                  className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-55 text-white font-bold text-xs rounded-xl shadow-sm hover:shadow-emerald-600/10 cursor-pointer transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                  aria-busy={isLoadingConnect}
                >
                  {isLoadingConnect ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-200" />
                  )}
                  <span>Conectar conta com Pluggy</span>
                </button>
              </div>
            </div>
          )}

          {/* FASE 8: MANUAL ITEM ID ENTRY CONTROL */}
          {hasPluggyKeys && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4 font-sans">
              <div className="flex gap-4">
                <div className="bg-slate-50 dark:bg-slate-805 text-slate-500 dark:text-slate-400 p-3 rounded-xl shrink-0 h-fit">
                  <Sliders className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="space-y-1 flex-1">
                  <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200">Vincular ID de Conexão Manual</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Se você utiliza o plano gratuito "Personal/Developer" no console do Pluggy ou já possui conexões criadas, cole o <strong>Item ID</strong> (UUID) para acionar o sincronismo das transações.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-1">
                    <label htmlFor="manualItemId" className="sr-only">Identificador Único da Conexão (UUID)</label>
                    <input
                      id="manualItemId"
                      type="text"
                      value={manualItemIdInput}
                      onChange={(e) => setManualItemIdInput(e.target.value)}
                      placeholder="Ex: 88fa38cc-2a31-4874-bc48-abcde1234567"
                      className="w-full bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white h-11"
                      autoComplete="off"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveManualItemId}
                    className="h-11 px-5 bg-slate-800 hover:bg-slate-950 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-bold text-xs rounded-xl transition-colors shrink-0 active:scale-[0.98] w-full sm:w-auto"
                  >
                    Validar e Vincular ID
                  </button>
                </div>

                {/* HISTORIAL OF MANUAL ITEM IDS AS CHIPS LINKED */}
                <div className="space-y-1.5 pt-1">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">IDs de conexões associadas no Firestore ({profile.pluggyItemIds?.length || 0})</span>
                  {(!profile.pluggyItemIds || profile.pluggyItemIds.length === 0) ? (
                    <div className="text-xs text-slate-400 italic bg-slate-50/50 dark:bg-slate-950/20 px-3 py-3 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center">
                      Nenhum ID de conexão pendente ou configurado manualmente.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {profile.pluggyItemIds.map((id: string) => (
                        <div key={id} className="flex items-center gap-2 bg-slate-50/70 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 py-1.5 pl-3 pr-2.5 rounded-xl text-xs font-mono text-slate-700 dark:text-slate-300">
                          <span className="truncate max-w-[130px] sm:max-w-[240px]" title={id}>{id}</span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(id, `manual-id-${id}`)}
                            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 rounded-md transition-colors shrink-0 cursor-pointer"
                            aria-label={`Copiar ID ${id}`}
                          >
                            {copiedStates[`manual-id-${id}`] ? (
                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveManualItemId(id)}
                            className="p-1 hover:bg-rose-50 dark:hover:bg-rose-950/20 text-rose-500 rounded-md transition-colors shrink-0 cursor-pointer"
                            aria-label={`Remover ID ${id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* FASE 9: ACTIVE LINKED CONNECTIONS LIST */}
          {hasPluggyKeys && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <Database className="w-4 h-4 text-emerald-500" />
                  Conexões vinculadas ({pluggyItems.length})
                </h3>
                <button
                  type="button"
                  onClick={loadPluggyItems}
                  disabled={isLoadingItems}
                  className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 disabled:opacity-50 cursor-pointer h-10 px-2 rounded-lg"
                  aria-label="Atualizar conexões"
                >
                  {isLoadingItems ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  <span>Atualizar</span>
                </button>
              </div>

              {isLoadingItems ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                  <span className="text-xs">Consultando contas associadas do Pluggy...</span>
                </div>
              ) : pluggyItems.length === 0 ? (
                <div className="p-8 text-center bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1.5">
                  <p className="font-semibold text-xs text-slate-700 dark:text-slate-300">Nenhum banco ou conta vinculado</p>
                  <p className="text-[11px] text-slate-400 max-w-sm mx-auto leading-relaxed">
                    Sua conta de integração está ativa, mas ainda não localizamos registros de conexões de bancos associados no Firestore. Adicione conexões para sincronizar!
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pluggyItems.map((item) => {
                    const provider = item.connector || item.provider || {};
                    const isErrState = ["OUTDATED", "LOGIN_ERROR", "NEEDS_RECONNECT"].includes(item.status);
                    
                    const statusColors: any = {
                      UPDATED: 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/25 dark:text-emerald-400 dark:border-emerald-900/40',
                      UPDATING: 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/25 dark:text-blue-400 dark:border-blue-900/40',
                      OUTDATED: 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/25 dark:text-amber-400 dark:border-amber-900/40',
                      LOGIN_ERROR: 'bg-rose-50 text-rose-700 border-rose-100 dark:bg-rose-950/25 dark:text-rose-400 dark:border-rose-900/40',
                    };
                    
                    const statusLabels: any = {
                      UPDATED: 'Sincronizado',
                      UPDATING: 'Atualizando...',
                      OUTDATED: 'Reconectar',
                      LOGIN_ERROR: 'Erro de senha',
                    };

                    return (
                      <div key={item.id} className="p-3 bg-slate-50/50 dark:bg-slate-950 border border-slate-150 dark:border-slate-805 rounded-xl flex items-center justify-between gap-3 shadow-xs font-sans">
                        <div className="flex items-center gap-3 min-w-0">
                          {provider.imageUrl ? (
                            <img 
                              src={provider.imageUrl} 
                              alt={provider.name || 'Conector'} 
                              className="w-9 h-9 object-contain rounded-lg bg-white dark:bg-slate-800 p-1 border border-slate-200 dark:border-slate-700 shrink-0" 
                              referrerPolicy="no-referrer" 
                            />
                          ) : (
                            <div className="w-9 h-9 bg-slate-200 dark:bg-slate-800 rounded-lg flex items-center justify-center font-bold text-slate-600 dark:text-slate-350 text-xs shrink-0 uppercase">
                              {provider.name?.[0] || 'B'}
                            </div>
                          )}
                          <div className="min-w-0">
                            <h4 className="font-bold text-xs text-slate-800 dark:text-slate-200 truncate">{provider.name || 'Instituição Bancária'}</h4>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] text-slate-400 font-mono truncate max-w-[130px] sm:max-w-[200px]">ID: {item.id}</span>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(item.id, `item-id-${item.id}`)}
                                className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-250 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                                aria-label="Copiar ID da União"
                              >
                                {copiedStates[`item-id-${item.id}`] ? (
                                  <Check className="w-3 h-3 text-emerald-500" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrinks-0 font-sans">
                          {isErrState ? (
                            <button
                              type="button"
                              onClick={() => handleOpenPluggyConnect(item.id)}
                              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] rounded-lg transition-all shadow-xs shrink-0 cursor-pointer"
                            >
                              Corrigir
                            </button>
                          ) : (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${statusColors[item.status] || 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800'}`}>
                              {statusLabels[item.status] || item.status}
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={() => handleDeletePluggyItem(item.id)}
                            className="p-1.5 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg transition-colors cursor-pointer shrink-0"
                            aria-label="Excluir conector"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* FASE 10: SYNC AND MASS EXPORTATION BOARD */}
          {hasPluggyKeys && (
            <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-md shadow-emerald-950/5 space-y-4 text-slate-100">
              <div className="flex gap-4">
                <div className="bg-emerald-500/10 text-emerald-400 p-3 rounded-xl shrink-0 h-fit border border-emerald-500/20">
                  <RefreshCw className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-bold text-sm text-white">Sincronizar e categorizar contas</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Nossa IA fará varreduras completas no extrato de todas as instituições para coletar novos lançamentos em aberto, limpando textos comerciais e categorizando com <strong>Gemini AI</strong>.
                  </p>
                </div>
              </div>

              {/* CARD DETALHADO DE RESUMO ANTES DE ACIONAR */}
              <div className="grid grid-cols-3 gap-2 bg-black/40 border border-slate-800 p-3.5 rounded-xl text-center text-xs font-mono">
                <div>
                  <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider">Conexões</span>
                  <span className="text-white font-bold text-sm mt-0.5 block">{pluggyItems.length}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider">Erros</span>
                  <span className={`font-bold text-sm mt-0.5 block ${hasOutdatedItems ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {hasOutdatedItems ? 'Sim' : 'Não'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider">Intervalo</span>
                  <span className="text-white font-bold text-sm mt-0.5 block">30 dias</span>
                </div>
              </div>

              {pluggySyncStep && (
                <div 
                  className="bg-black/60 border border-slate-800 p-3 rounded-xl text-xs font-mono text-emerald-400 flex items-center leading-relaxed"
                  aria-live="polite"
                >
                  {isSyncingPluggy && <Loader2 className="w-4 h-4 mr-2.5 animate-spin text-emerald-500 shrink-0" />}
                  <span>{pluggySyncStep}</span>
                </div>
              )}

              <div>
                <button
                  type="button"
                  onClick={handleSyncPluggyTransactions}
                  disabled={isSyncingPluggy || pluggyItems.length === 0}
                  className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                >
                  {isSyncingPluggy ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Sincronizando transações e processando com IA...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 text-emerald-200" />
                      <span>Sincronizar dados bancários agora</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

        </div>

        {/* RIGHT COLUMN - SIDEBAR DETAILS AND STATUS */}
        <div className="space-y-6">
          
          {/* FASE 6: CREDENTIALS STATUS SUMMARY */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0" />
              <h3 className="font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">Status no Servidor</h3>
            </div>

            <div className="space-y-3 font-sans">
              <div className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Credenciais no Servidor:</span>
                <span className={`font-bold ${isPluggyConfiguredOnServer ? 'text-emerald-600' : 'text-slate-500'}`}>
                  {isPluggyConfiguredOnServer ? 'Configuradas (Env)' : 'Ausente'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="text-slate-500">Chaves Personalizadas:</span>
                <span className={`font-bold ${checkHasPluggyKeys() ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {checkHasPluggyKeys() ? 'Ativas (Perfil)' : 'Não configuradas'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs py-1.5">
                <span className="text-slate-500">Ambiente Pluggy:</span>
                <span className="font-mono text-[10px] text-slate-600 dark:text-slate-350 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-bold uppercase">Production/Sandbox</span>
              </div>
            </div>

            <div className="space-y-2 pt-1 font-sans">
              <button
                type="button"
                onClick={handleTestPluggyKeys}
                disabled={isTestingPluggy || !hasPluggyKeys}
                className="w-full text-center h-10 px-4 bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:pointer-events-none disabled:opacity-40"
              >
                {isTestingPluggy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                )}
                <span>Testar Autenticação</span>
              </button>

              <button
                type="button"
                onClick={() => setIsCredentialsFormOpen(!isCredentialsFormOpen)}
                className="w-full text-center h-10 px-4 bg-white hover:bg-slate-50 text-slate-700 font-bold border border-slate-200 text-xs rounded-xl transition-all cursor-pointer dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-slate-300 dark:border-slate-800 flex items-center justify-center gap-2"
              >
                <Settings2 className="w-3.5 h-3.5 text-slate-400" />
                <span>Configurações de Chaves</span>
                <ChevronDown className={`w-3.5 h-3.5 ml-auto text-slate-400 transition-transform ${isCredentialsFormOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>

            {/* EXPANDABLE COLLAPSED FORM TO PREVENT SENSITIVE FIELD DISCLOSURE OUT */}
            <AnimatePresence>
              {isCredentialsFormOpen && (
                <motion.form 
                  onSubmit={handleSaveCustomKeys}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="space-y-3.5 pt-3 border-t border-slate-100 dark:border-slate-800 overflow-hidden"
                >
                  <p className="text-[11px] text-slate-400 leading-relaxed leading-normal">
                    Obtenha seu par gratuito em <strong>developer.pluggy.ai</strong>. O Client Secret será salvo criptografado de forma invisível.
                  </p>
                  
                  <div className="space-y-1">
                    <label htmlFor="pluggy_client_id_input" className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Client ID</label>
                    <input
                      id="pluggy_client_id_input"
                      type="text"
                      value={pluggyClientId}
                      onChange={(e) => setPluggyClientId(e.target.value)}
                      placeholder="Cole o Client ID"
                      className="w-full bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="pluggy_client_secret_input" className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Client Secret</label>
                    <div className="relative">
                      <input
                        id="pluggy_client_secret_input"
                        type={showClientSecret ? 'text' : 'password'}
                        value={pluggyClientSecret}
                        onChange={(e) => setPluggyClientSecret(e.target.value)}
                        placeholder="Cole o Client Secret"
                        className="w-full bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-lg pl-3 pr-10 py-2 text-xs font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowClientSecret(!showClientSecret)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        aria-label={showClientSecret ? "Ocultar senha" : "Ver senha"}
                      >
                        {showClientSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="bg-slate-50/50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1.5">
                    <span className="text-[9px] font-bold text-slate-400 uppercase block tracking-wider">Armazenamento:</span>
                    <div className="flex flex-col gap-2">
                      <label className="flex items-start gap-1.5 text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer">
                        <input
                          type="radio"
                          name="storageMethodRight"
                          checked={storageMethod === 'cloud'}
                          onChange={() => setStorageMethod('cloud')}
                          className="mt-0.5 text-emerald-600 focus:ring-emerald-500 shrink-0"
                        />
                        <span><strong>Nuvem (Seguro):</strong> Salva criptografado no Firestore</span>
                      </label>
                      <label className="flex items-start gap-1.5 text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer">
                        <input
                          type="radio"
                          name="storageMethodRight"
                          checked={storageMethod === 'local'}
                          onChange={() => setStorageMethod('local')}
                          className="mt-0.5 text-emerald-600 focus:ring-emerald-500 shrink-0"
                        />
                        <span><strong>Apenas Local:</strong> Armazena em cache (LocalStorage)</span>
                      </label>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 pt-1">
                    <button
                      type="submit"
                      disabled={isSavingCustomKeys}
                      className="w-full text-center py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      {isSavingCustomKeys ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      <span>Salvar Credenciais</span>
                    </button>

                    {(profile.pluggyClientId || localStorage.getItem('PREF_PLUGGY_CLIENT_ID')) && (
                      <button
                        type="button"
                        onClick={handleRemoveCustomKeys}
                        disabled={isSavingCustomKeys}
                        className="w-full p-2 hover:bg-rose-50 dark:hover:bg-rose-950/20 text-rose-600 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Apagar Credenciais</span>
                      </button>
                    )}
                  </div>
                </motion.form>
              )}
            </AnimatePresence>
          </div>

          {/* FASE 11: TECHNICAL DIAGNOSTICS ACCORDION */}
          {hasPluggyKeys && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
              <button
                type="button"
                className="w-full px-5 py-4 flex items-center justify-between text-left focus:outline-none cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                onClick={() => setIsDiagnosticsOpen(!isDiagnosticsOpen)}
              >
                <div className="flex items-center gap-2">
                  <Sliders className="w-4.5 h-4.5 text-slate-500 dark:text-slate-400 shrink-0" />
                  <span className="font-bold text-xs text-slate-700 dark:text-slate-350">Diagnóstico técnico</span>
                </div>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isDiagnosticsOpen ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {isDiagnosticsOpen && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: 'auto' }}
                    exit={{ height: 0 }}
                    className="overflow-hidden border-t border-slate-100 dark:border-slate-800"
                  >
                    <div className="p-5 space-y-4">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal leading-relaxed">
                        Execute testes integrados de barramento para verificar o status operacional da API do Pluggy e do conector bancário.
                      </p>

                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={handleCreateSandbox}
                          disabled={isCreatingSandbox}
                          className="w-full h-10 px-4 bg-slate-50 hover:bg-slate-100 dark:bg-slate-950 dark:hover:bg-slate-900 border border-slate-200 dark:border-emerald-800 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                        >
                          {isCreatingSandbox ? <Loader2 className="w-4 h-4 animate-spin text-emerald-500" /> : <RefreshCw className="w-3.5 h-3.5 text-slate-500" />}
                          <span>Testar com Itaú Sandbox</span>
                        </button>
                      </div>

                      {diagnoseSteps && (
                        <div className="space-y-3.5 bg-slate-900 text-slate-100 p-4 rounded-xl border border-slate-800">
                          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                            <span className="text-[10px] font-bold uppercase text-slate-400">Status dos Testes</span>
                            <button
                              type="button"
                              onClick={() => { setDiagnoseSteps(null); setDiagnoseLogs([]); }}
                              className="text-[9px] text-slate-400 hover:text-white underline"
                              aria-label="Limpar histórico"
                            >
                              Limpar
                            </button>
                          </div>

                          <div className="space-y-2 text-[11px]">
                            {diagnoseSteps.map((step, idx) => (
                              <div key={idx} className="flex items-center justify-between bg-black/30 px-2.5 py-1.5 rounded-lg border border-slate-800">
                                <span className="font-medium text-slate-300">{step.name}</span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold ${
                                  step.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400' :
                                  step.status === 'RUNNING' ? 'bg-blue-500/10 text-blue-400 animate-pulse' :
                                  step.status === 'FAILED' ? 'bg-rose-500/10 text-rose-400' : 'bg-slate-800 text-slate-400'
                                }`}>
                                  {step.status === 'COMPLETED' ? 'OK' : step.status === 'RUNNING' ? 'PROCESSANDO...' : step.status}
                                </span>
                              </div>
                            ))}
                          </div>

                          {diagnoseLogs.length > 0 && (
                            <div className="space-y-1 pt-1.5">
                              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest block">Histórico de Log:</div>
                              <pre className="p-2.5 bg-black/95 text-[9px] font-mono text-slate-300 rounded-lg max-h-36 overflow-y-auto leading-relaxed border border-slate-800">
                                {diagnoseLogs.map((log, idx) => {
                                  let colorClass = "text-slate-300";
                                  if (log.toLowerCase().includes('[erro]') || log.toLowerCase().includes('fail')) colorClass = "text-rose-400";
                                  if (log.toLowerCase().includes('ok') || log.toLowerCase().includes('sucesso')) colorClass = "text-emerald-400";
                                  return <div key={idx} className={colorClass}>{log}</div>;
                                })}
                              </pre>
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => copyToClipboard(diagnoseLogs.join('\n'), 'diagnose-logs')}
                            className="w-full text-center py-2 bg-slate-850 hover:bg-slate-900 rounded-lg text-slate-300 hover:text-white font-medium text-[10px] uppercase tracking-wider"
                          >
                            Copiar Diagnóstico Completo
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* FASE 12: ADVANCED WEBHOOKS ACCORDION */}
          {hasPluggyKeys && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
              <button
                type="button"
                className="w-full px-5 py-4 flex items-center justify-between text-left focus:outline-none cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                onClick={() => setIsWebhooksOpen(!isWebhooksOpen)}
              >
                <div className="flex items-center gap-2">
                  <Radio className="w-4.5 h-4.5 text-slate-500 dark:text-slate-400 shrink-0" />
                  <span className="font-bold text-xs text-slate-700 dark:text-slate-350">Avançado: Webhooks</span>
                </div>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isWebhooksOpen ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {isWebhooksOpen && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: 'auto' }}
                    exit={{ height: 0 }}
                    className="overflow-hidden border-t border-slate-100 dark:border-slate-800"
                  >
                    <div className="p-5 space-y-4">
                      <div className="bg-indigo-50/50 dark:bg-indigo-950/20 p-3.5 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
                        <p className="text-[11px] text-slate-600 dark:text-indigo-300 leading-relaxed font-sans">
                          <strong>Notificações em Tempo Real:</strong> Os webhooks avisam automaticamente nossa central de IA quando transações bancárias forem geradas ou modificadas em background, sem precisar que o usuário faça sincronismo manual.
                        </p>
                      </div>

                      {/* CREATE NEW WEBHOOK FORM */}
                      <form onSubmit={handleRegisterWebhook} className="space-y-2.5 pt-1.5">
                        <div className="space-y-1">
                          <label htmlFor="webhookUrlRight" className="text-[10px] font-bold text-slate-500 dark:text-slate-400 tracking-wider">URL do Listener de Eventos</label>
                          <input
                            id="webhookUrlRight"
                            type="url"
                            value={webhookUrl}
                            onChange={(e) => setWebhookUrl(e.target.value)}
                            className="w-full bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={isRegisteringWebhook}
                          className="w-full h-9 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          {isRegisteringWebhook ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Link className="w-3.5 h-3.5" />}
                          <span>Ativar Webhook no Pluggy</span>
                        </button>
                      </form>

                      {/* WEBHOOKS CHANNELS SAVED */}
                      <div className="space-y-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Webhooks ativos</span>
                          <button
                            type="button"
                            onClick={loadPluggyWebhooks}
                            disabled={isLoadingWebhooks}
                            className="p-1 text-[11px] text-indigo-600 hover:text-indigo-700 flex items-center gap-0.5"
                          >
                            <RefreshCw className="w-3 h-3 text-indigo-500" />
                          </button>
                        </div>

                        {pluggyWebhooks.length === 0 ? (
                          <div className="p-3 text-center border border-dashed border-slate-200 dark:border-slate-800 text-xs text-slate-400 italic rounded-xl bg-slate-50/50">
                            Nenhum webhook registrado nesta conta da Pluggy.
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {pluggyWebhooks.map((wh) => (
                              <div key={wh.id} className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between gap-2.5 font-mono text-[10px] text-slate-700 dark:text-slate-350 shadow-xs">
                                <div className="min-w-0 pr-1">
                                  <span className="bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-400 text-[8px] px-1 py-0.5 rounded font-bold uppercase">{wh.event}</span>
                                  <p className="truncate text-slate-500 dark:text-slate-400 mt-1 leading-none">{wh.url}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteWebhook(wh.id)}
                                  className="p-1 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-md transition-colors shrink-0 cursor-pointer"
                                  title="Remover"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* WEBHOOKS AUDITOR LIST OF COGNITIVE EVENTS */}
                      <div className="space-y-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Eventos Capturados (Logs)</span>
                          <button
                            type="button"
                            onClick={loadCapturedEvents}
                            disabled={isLoadingEvents}
                            className="p-1 text-[11px] text-slate-600 hover:text-slate-800 flex items-center gap-0.5"
                          >
                            <RefreshCw className="w-3 h-3" />
                          </button>
                        </div>

                        {capturedEvents.length === 0 ? (
                          <div className="p-3.5 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/20 text-center text-[11px] text-slate-500 leading-normal leading-relaxed">
                            Nenhum webhook capturado no servidor até o momento. Lançamentos automáticos aparecerão aqui em tempo real!
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5">
                            {capturedEvents.map((evt) => {
                              const dateObj = new Date(evt.receivedAt);
                              const formattedDate = dateObj.toLocaleDateString('pt-BR') + ' ' + dateObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                              return (
                                <div key={evt.id} className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1.5 shadow-sm">
                                  <div className="flex items-center justify-between text-[10px] font-mono">
                                    <span className="font-bold text-slate-800 dark:text-slate-200 uppercase">{evt.event}</span>
                                    <span className="text-slate-400">{formattedDate}</span>
                                  </div>

                                  <div className="text-[9px] font-mono space-y-0.5 leading-normal">
                                    <span className="text-slate-400">ID: {evt.itemId}</span>
                                    <div className="flex items-center justify-between">
                                      <span className="text-slate-400">Status:</span>
                                      <span className="text-emerald-500 font-bold uppercase">{evt.status}</span>
                                    </div>
                                  </div>

                                  <details className="text-[8px] font-mono">
                                    <summary className="cursor-pointer text-slate-400 hover:text-slate-600 outline-none">Ver Payload Bruto</summary>
                                    <pre className="bg-black text-slate-300 p-2 rounded-lg max-h-24 overflow-auto scrollbar-thin mt-1 leading-normal">
                                      {JSON.stringify(evt.rawBody, null, 2)}
                                    </pre>
                                  </details>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

        </div>

      </div>

    </div>
  );
}
