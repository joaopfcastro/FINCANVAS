import React, { useState, useEffect } from 'react';
import { doc, updateDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, Transaction } from '../App';
import { User } from 'firebase/auth';
import { 
  KeyRound, Eye, EyeOff, Check, Trash2, Loader2, Database, Info, 
  CheckCircle2, ChevronRight, Key, RefreshCw, Radio, CreditCard, Link, Copy, AlertTriangle, ShieldCheck, ChevronDown, Settings2, Sliders, Play
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
  // --- LOCAL SYNCHRONIZED IDS (OPTIMISTIC STATE) ---
  const [localItemIds, setLocalItemIds] = useState<string[]>(profile.pluggyItemIds || []);
  
  // --- PLUGGY API CONNECT STATES ---
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
  const [pluggySyncStep, setPluggySyncStep] = useState('');
  const [pluggyItems, setPluggyItems] = useState<any[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [diagnoseSteps, setDiagnoseSteps] = useState<any[] | null>(null);
  const [diagnoseLogs, setDiagnoseLogs] = useState<string[]>([]);
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});

  // Collapsed Sections Default
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [isWebhooksOpen, setIsWebhooksOpen] = useState(true);
  const [isCredentialsFormOpen, setIsCredentialsFormOpen] = useState(false);

  // --- CUSTOM DIALOG/CONFIRM MODALS (Removes iframe window.confirm blocking) ---
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    actionLabel: string;
    actionType: 'danger' | 'info';
    onConfirm: () => void;
  } | null>(null);

  // --- WEBHOOKS STATE (FETCHED ONLY ON DEMAND) ---
  const [pluggyWebhooks, setPluggyWebhooks] = useState<any[]>([]);
  const [isLoadingWebhooks, setIsLoadingWebhooks] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [isRegisteringWebhook, setIsRegisteringWebhook] = useState(false);
  const [capturedEvents, setCapturedEvents] = useState<any[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);

  // Sync parent pluggyItemIds into our local optimistic array
  useEffect(() => {
    if (profile.pluggyItemIds) {
      setLocalItemIds(profile.pluggyItemIds);
    }
  }, [profile.pluggyItemIds]);

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

  // --- COPY UTILITY ---
  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedStates(prev => ({ ...prev, [key]: true }));
    toast.success('Copiado para a área de transferência!');
    setTimeout(() => {
      setCopiedStates(prev => ({ ...prev, [key]: false }));
    }, 2000);
  };

  // --- SAVE CUSTOM CREDENTIALS ---
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

  // --- REMOVE CUSTOM CREDENTIALS ---
  const handleRemoveCustomKeys = async () => {
    setConfirmModal({
      isOpen: true,
      title: 'Apagar Credenciais?',
      description: 'Tem certeza que deseja apagar suas credenciais personalizadas da Pluggy?',
      actionLabel: 'Apagar Chaves',
      actionType: 'danger',
      onConfirm: async () => {
        setConfirmModal(null);
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
      }
    });
  };

  // --- CONNECT VIA PLUGGY CONNECT WIDGET ---
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
            toast.success(`Conexão efetuada com sucesso!`);
            
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
                  const updatedIds = [...currentItemIds, itemId];
                  setLocalItemIds(updatedIds); // instant feed update
                  await updateDoc(doc(db, 'users', user.uid), {
                    pluggyItemIds: updatedIds,
                    updatedAt: serverTimestamp()
                  });
                }
                toast.dismiss('validate-new-item');
                toast.success(`Conta vinculada e conectada: ${valData.item?.connector || 'Pluggy'}!`);
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

  // --- DIAGNOSE CONNECTIONS ---
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
          itemIds: localItemIds
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
        setIsDiagnosticsOpen(true); // reveal results
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

  // --- ADD ITEM ID MANUALLY ---
  const handleSaveManualItemId = async () => {
    const rawId = manualItemIdInput.trim();
    if (!rawId) {
      toast.error('O campo do ID não pode estar vazio.');
      return;
    }
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(rawId)) {
      toast.error('ID inválido. Certifique-se de que inseriu um UUID válido no formato do Pluggy.');
      return;
    }

    if (localItemIds.includes(rawId)) {
      toast.error('Este ID de conexão já está cadastrado nesta conta.');
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

      const updatedIds = [...localItemIds, rawId];
      setLocalItemIds(updatedIds); // optimistic local update

      await updateDoc(doc(db, 'users', user.uid), {
        pluggyItemIds: updatedIds,
        updatedAt: serverTimestamp()
      });
      setManualItemIdInput('');
      toast.dismiss('validate-item');
      toast.success(`Conexão (${valData.item?.connector || 'Pluggy'}) vinculada com sucesso!`);
      await loadPluggyItems();
    } catch (err: any) {
      toast.dismiss('validate-item');
      console.error(err);
      toast.error('Erro ao salvar o ID ou validar no Firestore.');
    }
  };

  // --- UNIFIED DESVINCULAR (REMOVER DO FINCANVAS - GUARANTEED OPTIMISTIC SUCCESS) ---
  const handleRemoveManualItemId = async (idPost: string, silent = false) => {
    if (silent) {
      await executeRemoveManualItemId(idPost);
      return;
    }

    setConfirmModal({
      isOpen: true,
      title: 'Desvincular Conexão?',
      description: 'Tem certeza que deseja desvincular a conexão do FINCANVAS? Suas transações importadas serão mantidas, mas nenhum novo sincronismo será realizado para esse ID.',
      actionLabel: 'Desvincular',
      actionType: 'danger',
      onConfirm: async () => {
        setConfirmModal(null);
        await executeRemoveManualItemId(idPost);
      }
    });
  };

  const executeRemoveManualItemId = async (idPost: string) => {
    // Immediate optimistic state update
    const updated = localItemIds.filter((item: string) => item !== idPost);
    setLocalItemIds(updated);
    setPluggyItems(prev => prev.filter(item => item.id !== idPost));

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        pluggyItemIds: updated,
        updatedAt: serverTimestamp()
      });
      toast.success('Conexão desvinculada com sucesso!');
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao salvar alteração. Restaurando estado prévio.');
      setLocalItemIds(profile.pluggyItemIds || []);
      await loadPluggyItems();
    }
  };

  // --- FETCH PLUGGY ITEMS DETAILS ---
  const loadPluggyItems = async () => {
    const headers = getPluggyHeaders();
    if (!hasPluggyKeys || localItemIds.length === 0) {
      setPluggyItems([]);
      return;
    }
    setIsLoadingItems(true);
    try {
      const res = await fetch('/api/pluggy/list_items', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemIds: localItemIds
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

  // --- SYNC BANK TRANSACTIONS (WITH AI) ---
  const handleSyncPluggyTransactions = async () => {
    if (!hasPluggyKeys) {
      toast.error('A integração da Pluggy não está configurada.');
      return;
    }
    setIsSyncingPluggy(true);
    setPluggySyncStep('Conectando de forma segura ao gateway da Pluggy...');
    try {
      const res = await fetch('/api/pluggy/sync', {
        method: 'POST',
        headers: getPluggyHeaders(),
        body: JSON.stringify({
          categories: profile.categories || [],
          itemIds: localItemIds
        })
      });

      const data = await safeJsonClient(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Problema de resposta no servidor de sincronização.');
      }

      const list: any[] = data.transactions || [];
      if (data.message) {
        toast.info(data.message);
      }

      if (list.length === 0) {
        setPluggySyncStep('Tudo atualizado! Nenhuma nova transação nos últimos 30 dias.');
        toast.success('Sincronização concluída! Suas contas estão em dia.');
        return;
      }

      setPluggySyncStep(`Encontrados ${list.length} lançamentos recentes. Analisando duplicidades...`);

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
        setPluggySyncStep(`Concluído: ${skippedCount} entradas descartadas pois já estavam gravadas.`);
        toast.success(`Contas atualizadas! Todas as novas transações já constavam no sistema.`);
        return;
      }

      setPluggySyncStep(`Organizando com Inteligência Artificial. Gravando ${filterToInsert.length} transações...`);

      const colRef = doc(db, 'users', user.uid);
      const transactionsCollectionRef = doc(db, 'transactions', 'dummy').parent;

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

      setPluggySyncStep(`Concluído! ${filterToInsert.length} transações adicionadas e mapeadas pelo Gemini.`);
      toast.success(`${filterToInsert.length} transações importadas com sucesso!`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Falha na sincronização.');
      setPluggySyncStep('Ocorreu um erro inesperado.');
    } finally {
      setIsSyncingPluggy(false);
    }
  };

  // --- WEBHOOK CLIENT METHODS (CALLED ONLY WHEN WEBHOOK ACCORDION IS EXPLICITLY EXPANDED) ---
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
      toast.error('Configure as chaves Pluggy antes de registrar.');
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
        toast.success('Webhook registrado com sucesso no Pluggy!');
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
    setConfirmModal({
      isOpen: true,
      title: 'Excluir Webhook?',
      description: 'Tem certeza que deseja apagar este webhook no Pluggy?',
      actionLabel: 'Apagar Webhook',
      actionType: 'danger',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const res = await fetch('/api/pluggy/delete_webhook', {
            method: 'POST',
            headers: getPluggyHeaders(),
            body: JSON.stringify({ webhookId })
          });
          const data = await safeJsonClient(res);
          if (res.ok && data.success) {
            toast.success('Webhook removido!');
            await loadPluggyWebhooks();
          } else {
            toast.error(data.error || 'Falha ao remover webhook.');
          }
        } catch (err: any) {
          console.error(err);
          toast.error('Erro ao excluir webhook.');
        }
      }
    });
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
      console.error('Erro ao buscar logs:', err);
    } finally {
      setIsLoadingEvents(false);
    }
  };

  // --- INITIAL CHECK ---
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

  // Sync connections details
  useEffect(() => {
    if (hasPluggyKeys) {
      loadPluggyItems();
    }
  }, [hasPluggyKeys, localItemIds]);

  // Lazy Webhook loading
  useEffect(() => {
    if (hasPluggyKeys && isWebhooksOpen) {
      loadPluggyWebhooks();
      loadCapturedEvents();
    }
  }, [hasPluggyKeys, isWebhooksOpen]);

  // Derived indicators
  const hasOutdatedItems = pluggyItems.some(i => ["OUTDATED", "LOGIN_ERROR", "NEEDS_RECONNECT"].includes(i.status));
  const isAwaitingItemIds = localItemIds.length === 0;

  // --- MERGED STATE CHIPS & LOGICAL CONNECTIONS ---
  const unifiedConnections = localItemIds.map(id => {
    const fetchedDetail = pluggyItems.find(item => item.id === id);
    return {
      id,
      detail: fetchedDetail,
      hasDetails: !!fetchedDetail,
      status: fetchedDetail?.status || 'PENDING_REGISTRATION',
      name: fetchedDetail?.connector?.name || fetchedDetail?.provider?.name || "Banco / Conexão Adicionada",
      imageUrl: fetchedDetail?.connector?.imageUrl || fetchedDetail?.provider?.imageUrl || null
    };
  });

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto pb-12 font-sans overflow-x-hidden">
      
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-emerald-500 shrink-0" />
            Integração Bancária
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Sincronize transações de forma automática utilizando a tecnologia oficial do <strong>Pluggy Connect</strong>.
          </p>
        </div>
        
        {/* GLOBAL BADGE */}
        <div className="flex shrink-0">
          {!hasPluggyKeys ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/40">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
              Credenciais Ausentes
            </span>
          ) : hasOutdatedItems ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/20 dark:text-rose-404 dark:border-rose-905/40 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
              Ação Requerida (Reconectar)
            </span>
          ) : isAwaitingItemIds ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/40">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
              Aguardando Conexão
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/40">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              Conexão Ativa
            </span>
          )}
        </div>
      </div>

      {/* MISSING SECRETS ALERT BANNER */}
      {!hasPluggyKeys && (
        <div id="missing-secrets-alert" className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/15 dark:to-orange-950/15 p-5 rounded-2xl border border-amber-200 dark:border-amber-900/30 flex flex-col md:flex-row gap-4 items-start md:items-center transition-all">
          <div className="bg-amber-100 dark:bg-amber-905/30 text-amber-600 dark:text-amber-400 p-3 rounded-xl shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h4 className="font-bold text-sm text-amber-900 dark:text-amber-400">Servidor de Integração pendente de Chaves</h4>
            <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
              Para liberar o sincronismo e integrar suas contas, é necessário fornecer suas chaves cadastrais do Pluggy.
            </p>
          </div>
          <button 
            type="button"
            onClick={() => setIsCredentialsFormOpen(true)}
            className="md:ml-auto w-full md:w-auto px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all shrink-0 active:scale-[0.98]"
            aria-label="Configurar chaves"
          >
            Adicionar Credenciais
          </button>
        </div>
      )}

      {/* MAIN TWO-COLUMN RESPONSIVE LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
        
        {/* LEFT COLUMN: CORE FUNCTIONAL ACTIONS */}
        <div className="space-y-6 min-w-0">
          
          {/* SEC_1: CONNECT ACCOUNT VIA PLUGGY CONNECT */}
          {hasPluggyKeys && (
            <div id="pluggy-connect-card" className="bg-white dark:bg-slate-900 border border-slate-205 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
              <div className="flex gap-4">
                <div className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 p-3 rounded-xl shrink-0 h-fit">
                  <Link className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200">Conectar conta bancária de forma rápida</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Clique no botão abaixo para escolher sua instituição financeira. As credenciais de acesso são processadas de forma blindada pela infraestrutura da Pluggy.
                  </p>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => handleOpenPluggyConnect()}
                  disabled={isLoadingConnect}
                  className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
                  aria-busy={isLoadingConnect}
                >
                  {isLoadingConnect ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-250 animate-pulse" />
                  )}
                  <span>Conectar conta integrada agora</span>
                </button>
              </div>
            </div>
          )}

          {/* SEC_2: ALTERNATIVE MANUAL ITEM ID */}
          {hasPluggyKeys && (
            <div id="manual-item-card" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-805 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
              <div className="flex gap-4 flex-col sm:flex-row">
                <div className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-450 p-3 rounded-xl shrink-0 h-fit w-fit">
                  <Sliders className="w-5 h-5 text-emerald-600 dark:text-emerald-450" />
                </div>
                <div className="space-y-1 flex-1">
                  <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200">Vincular ID Existente Manualmente</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Já possui um ID criado no console do desenvolvedor da Pluggy? Insira-o abaixo para cadastrar.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-grow">
                    <label htmlFor="manual_item_uuid_input" className="sr-only">UUID de Conexão da Pluggy</label>
                    <input
                      id="manual_item_uuid_input"
                      type="text"
                      value={manualItemIdInput}
                      onChange={(e) => setManualItemIdInput(e.target.value)}
                      placeholder="Ex: 88fa38cc-a3bf-4874-9582-12efea85a9bc"
                      className="w-full bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white h-11"
                      autoComplete="off"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveManualItemId}
                    className="h-11 px-5 bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-bold text-xs rounded-xl transition-colors shrink-0 active:scale-[0.98] w-full sm:w-auto cursor-pointer"
                  >
                    Vincular Item ID
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SEC_3: THE UNIFIED CONNECTIONS LIST */}
          {hasPluggyKeys && (
            <div id="unified-connections-card" className="bg-white dark:bg-slate-900 border border-slate-202 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-50 dark:border-slate-805 pb-3">
                <h3 className="font-bold text-sm text-slate-805 dark:text-slate-200 flex items-center gap-2">
                  <Database className="w-4.5 h-4.5 text-emerald-500" />
                  Conexões vinculadas ({localItemIds.length})
                </h3>
                <button
                  type="button"
                  onClick={loadPluggyItems}
                  disabled={isLoadingItems || localItemIds.length === 0}
                  className="text-xs font-bold text-emerald-600 hover:text-emerald-700 disabled:opacity-40 flex items-center gap-1 cursor-pointer py-1.5 px-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors"
                  aria-label="Sincronizar conexões da Pluggy"
                >
                  {isLoadingItems ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  <span>Atualizar status</span>
                </button>
              </div>

              {isLoadingItems && localItemIds.length > 0 && pluggyItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                  <span className="text-xs">Requisitando conexões cadastradas no servidor...</span>
                </div>
              ) : localItemIds.length === 0 ? (
                <div className="py-10 text-center bg-slate-50/50 dark:bg-slate-950/25 border border-dashed border-slate-200 dark:border-slate-850 rounded-2xl space-y-2">
                  <p className="font-bold text-xs text-slate-700 dark:text-slate-300">Nenhuma conta conectada encontrada</p>
                  <p className="text-[11px] text-slate-400 max-w-sm mx-auto leading-relaxed">
                    Sua integração bancária está ativa. Conecte sua primeira conta de banco clicando no botão acima ou informe um Item ID existente para começar o rastreio!
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {unifiedConnections.map((conn) => {
                    const isErrState = ["OUTDATED", "LOGIN_ERROR", "NEEDS_RECONNECT"].includes(conn.status);
                    
                    const statusColors: any = {
                      UPDATED: 'bg-emerald-50 text-emerald-705 border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/40',
                      UPDATING: 'bg-blue-50 text-blue-705 border-blue-100 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/40',
                      OUTDATED: 'bg-amber-50 text-amber-705 border-amber-100 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/40',
                      LOGIN_ERROR: 'bg-rose-50 text-rose-705 border-rose-150 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900/40',
                      PENDING_REGISTRATION: 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700/50',
                    };
                    
                    const statusLabels: any = {
                      UPDATED: 'Sincronizado',
                      UPDATING: 'Buscando...',
                      OUTDATED: 'Precisa Reconectar',
                      LOGIN_ERROR: 'Erro de Senha',
                      PENDING_REGISTRATION: 'ID Gravado (Aguardando carga)',
                    };

                    return (
                      <div 
                        key={conn.id} 
                        className="p-4 bg-slate-50/50 dark:bg-slate-950 border border-slate-150 dark:border-slate-800 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs font-sans transition-all"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {conn.imageUrl ? (
                            <img 
                              src={conn.imageUrl} 
                              alt={conn.name} 
                              className="w-10 h-10 object-contain rounded-xl bg-white dark:bg-slate-800 p-1 border border-slate-200 dark:border-slate-700 shrink-0" 
                              referrerPolicy="no-referrer" 
                            />
                          ) : (
                            <div className="w-10 h-10 bg-slate-200 dark:bg-slate-800 rounded-xl flex items-center justify-center font-bold text-slate-500 dark:text-slate-400 text-xs shrink-0 uppercase">
                              {conn.name?.[0] || 'B'}
                            </div>
                          )}
                          <div className="min-w-0 space-y-0.5">
                            <h4 className="font-bold text-xs text-slate-800 dark:text-slate-200 truncate pr-2">
                              {conn.name}
                            </h4>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-slate-400 font-mono" title={conn.id}>
                                ID: {conn.id.substring(0, 8)}...{conn.id.substring(conn.id.length - 8)}
                              </span>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(conn.id, `item-id-${conn.id}`)}
                                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 rounded transition-colors shrink-0 cursor-pointer"
                                aria-label={`Copiar Item ID ${conn.id}`}
                              >
                                {copiedStates[`item-id-${conn.id}`] ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 border-t border-slate-100 dark:border-slate-850 pt-2 sm:pt-0 sm:border-0">
                          <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold border shrink-0 ${statusColors[conn.status] || 'bg-slate-100 text-slate-605 border-slate-200 dark:bg-slate-800/50'}`}>
                            {statusLabels[conn.status] || conn.status}
                          </span>

                          <div className="flex gap-1.5 items-center">
                            {isErrState && (
                              <button
                                type="button"
                                onClick={() => handleOpenPluggyConnect(conn.id)}
                                className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] rounded-lg transition-all shadow-xs shrink-0 cursor-pointer"
                                aria-label="Reconectar conta erro"
                              >
                                Reconectar
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRemoveManualItemId(conn.id)}
                              className="p-2 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-xl transition-colors cursor-pointer shrink-0"
                              aria-label={`Desvincular conector ${conn.name}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* SEC_4: PREMIUM UNIFIED CLEAR SYNC TRANSACTIONS BLOCK */}
          {hasPluggyKeys && (
            <div id="sync-transactions-card" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
              <div className="flex gap-4">
                <div className="bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 p-3 rounded-xl shrink-0 h-fit">
                  <RefreshCw className="w-5 h-5 animate-spin-slow" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-bold text-sm text-slate-805 dark:text-slate-200">Sincronizar lançamentos recentes</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Sincroniza transações dos últimos 30 dias de extrato das contas válidas vinculadas. Nossa engine limpa as descrições e categoriza automaticamente usando o <strong>Gemini AI</strong>.
                  </p>
                </div>
              </div>

              {/* DETAILS ROW WITH NUMERIC OVERVIEWS */}
              <div className="grid grid-cols-3 gap-2 bg-slate-50/50 dark:bg-slate-950 border border-slate-150 p-3.5 rounded-xl text-center text-xs font-mono">
                <div>
                  <span className="text-slate-450 block text-[9px] uppercase font-bold tracking-wider">Conexões</span>
                  <span className="text-slate-800 dark:text-slate-100 font-bold text-sm mt-0.5 block">{localItemIds.length}</span>
                </div>
                <div>
                  <span className="text-slate-450 block text-[9px] uppercase font-bold tracking-wider">Atenções</span>
                  <span className={`font-bold text-sm mt-0.5 block ${hasOutdatedItems ? 'text-rose-500' : 'text-emerald-500'}`}>
                    {hasOutdatedItems ? 'Sim' : 'Não'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-450 block text-[9px] uppercase font-bold tracking-wider">Janela</span>
                  <span className="text-slate-800 dark:text-slate-100 font-bold text-sm mt-0.5 block">30 dias</span>
                </div>
              </div>

              {/* LOGICAL CURRENT SYNCD STEP */}
              {pluggySyncStep && (
                <div 
                  className="bg-slate-50 dark:bg-black/40 border border-slate-200 dark:border-slate-850 p-3 rounded-xl text-xs font-mono text-emerald-600 dark:text-emerald-400 flex items-center leading-relaxed"
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
                  disabled={isSyncingPluggy || localItemIds.length === 0}
                  className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:pointer-events-none text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                >
                  {isSyncingPluggy ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Processando transações...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current text-emerald-200" />
                      <span>Sincronizar transações agora</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

        </div>

        {/* RIGHT COLUMN: TECHNICAL PANEL & METADATA DETAILS */}
        <div className="space-y-6">
          
          {/* CREDENTIALS METADATA STATUS */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-850 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
              <h3 className="font-bold text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">Status no Servidor</h3>
            </div>

            <div className="space-y-2 font-mono text-[11px] leading-relaxed">
              <div className="flex items-center justify-between py-1.5 border-b border-slate-105 dark:border-slate-805">
                <span className="text-slate-450">Chaves Servidor:</span>
                <span className={`font-bold ${isPluggyConfiguredOnServer ? 'text-emerald-650' : 'text-slate-450'}`}>
                  {isPluggyConfiguredOnServer ? 'Configuradas (Env)' : 'Ausente'}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-slate-105 dark:border-slate-805">
                <span className="text-slate-450">Chaves Custom:</span>
                <span className={`font-bold ${checkHasPluggyKeys() ? 'text-emerald-650' : 'text-amber-600'}`}>
                  {checkHasPluggyKeys() ? 'Ativas (Perfil)' : 'Não configuradas'}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-slate-450">API Base:</span>
                <span className="text-[10px] bg-slate-100 dark:bg-slate-850 px-1.5 py-0.5 rounded font-bold text-slate-650 dark:text-slate-300">Pluggy V2</span>
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={handleTestPluggyKeys}
                disabled={isTestingPluggy || !hasPluggyKeys}
                className="w-full h-10 px-4 bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
              >
                {isTestingPluggy ? (
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                )}
                <span>Testar Comunicação</span>
              </button>

              <button
                type="button"
                onClick={() => setIsCredentialsFormOpen(!isCredentialsFormOpen)}
                className="w-full h-10 px-4 bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-850 text-slate-700 dark:text-slate-350 border border-slate-205 dark:border-slate-800 font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Settings2 className="w-3.5 h-3.5 text-slate-400" />
                <span>Configurar Chaves API</span>
                <ChevronDown className={`w-3.5 h-3.5 ml-auto text-slate-400 transition-transform ${isCredentialsFormOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>

            {/* EXPANDABLE SENSITIVE FORM */}
            <AnimatePresence>
              {isCredentialsFormOpen && (
                <motion.form 
                  onSubmit={handleSaveCustomKeys}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800 overflow-hidden"
                >
                  <p className="text-[11px] text-slate-450 leading-relaxed">
                    Você pode obter chaves de desenvolvimento gratuitas no console da Pluggy (<strong>developer.pluggy.ai</strong>).
                  </p>
                  
                  <div className="space-y-1">
                    <label htmlFor="pluggy_client_id_right_input" className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Client ID</label>
                    <input
                      id="pluggy_client_id_right_input"
                      type="text"
                      value={pluggyClientId}
                      onChange={(e) => setPluggyClientId(e.target.value)}
                      placeholder="Identificador exclusivo"
                      className="w-full bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-xs font-mono focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="pluggy_client_secret_right_input" className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Client Secret</label>
                    <div className="relative">
                      <input
                        id="pluggy_client_secret_right_input"
                        type={showClientSecret ? 'text' : 'password'}
                        value={pluggyClientSecret}
                        onChange={(e) => setPluggyClientSecret(e.target.value)}
                        placeholder="Chave secreta"
                        className="w-full bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-lg pl-3 pr-10 py-2 text-xs font-mono focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowClientSecret(!showClientSecret)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        aria-label={showClientSecret ? "Ocultar Client Secret" : "Revelar Client Secret"}
                      >
                        {showClientSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="bg-slate-50/50 dark:bg-slate-950 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1 tracking-wide">
                    <span className="text-[9px] font-bold text-slate-400 uppercase block tracking-wider">Persistência da credencial</span>
                    <div className="flex flex-col gap-1.5">
                      <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer">
                        <input
                          type="radio"
                          name="storageMethodRight"
                          checked={storageMethod === 'cloud'}
                          onChange={() => setStorageMethod('cloud')}
                          className="text-emerald-605 focus:ring-emerald-500 shrink-0"
                        />
                        <span>Nuvem (Seguro no Firestore)</span>
                      </label>
                      <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer">
                        <input
                          type="radio"
                          name="storageMethodRight"
                          checked={storageMethod === 'local'}
                          onChange={() => setStorageMethod('local')}
                          className="text-emerald-610 focus:ring-emerald-500 shrink-0"
                        />
                        <span>Apenas Local (Navegador)</span>
                      </label>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5 pt-1">
                    <button
                      type="submit"
                      disabled={isSavingCustomKeys}
                      className="w-full text-center py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-colors"
                    >
                      {isSavingCustomKeys ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      <span>Salvar Credenciais</span>
                    </button>

                    {(profile.pluggyClientId || localStorage.getItem('PREF_PLUGGY_CLIENT_ID')) && (
                      <button
                        type="button"
                        onClick={handleRemoveCustomKeys}
                        disabled={isSavingCustomKeys}
                        className="w-full py-2 hover:bg-rose-50 dark:hover:bg-rose-950/20 text-rose-600 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Apagar Chaves salvas</span>
                      </button>
                    )}
                  </div>
                </motion.form>
              )}
            </AnimatePresence>
          </div>

          {/* DIAGNOSTICS LOGS COLLAPSIBLE (AVANÇADO) */}
          {hasPluggyKeys && (
            <div id="diagnostics-drawer" className="bg-white dark:bg-slate-900 border border-slate-201 dark:border-slate-850 rounded-2xl overflow-hidden shadow-xs">
              <button
                type="button"
                className="w-full px-5 py-4 flex items-center justify-between text-left focus:outline-none cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                onClick={() => setIsDiagnosticsOpen(!isDiagnosticsOpen)}
              >
                <div className="flex items-center gap-2">
                  <Sliders className="w-4.5 h-4.5 text-slate-500 dark:text-slate-400 shrink-0" />
                  <span className="font-bold text-xs text-slate-700 dark:text-slate-350">Informações de Diagnóstico</span>
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
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed font-sans">
                        Verifique dados das requisições brutas de handshake trocadas entre o servidor local e a API.
                      </p>

                      {diagnoseSteps && (
                        <div className="space-y-3.5 bg-slate-900 text-slate-100 p-4 rounded-xl border border-slate-800">
                          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                            <span className="text-[10px] font-bold uppercase text-slate-400">Verificação de barramento</span>
                            <button
                              type="button"
                              onClick={() => { setDiagnoseSteps(null); setDiagnoseLogs([]); }}
                              className="text-[9px] text-slate-400 hover:text-white underline"
                              aria-label="Limpar informações"
                            >
                              Limpar
                            </button>
                          </div>

                          <div className="space-y-2 text-[11px] font-mono">
                            {diagnoseSteps.map((step, idx) => (
                              <div key={idx} className="flex items-center justify-between bg-black/30 px-2.5 py-1.5 border border-slate-800 rounded-lg">
                                <span className="text-slate-300">{step.name}</span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                                  step.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400' :
                                  step.status === 'RUNNING' ? 'bg-blue-500/10 text-blue-400 animate-pulse' :
                                  step.status === 'FAILED' ? 'bg-rose-500/10 text-rose-400' : 'bg-slate-800 text-slate-400'
                                }`}>
                                  {step.status === 'COMPLETED' ? 'Sucesso' : step.status === 'RUNNING' ? 'Executando' : step.status}
                                </span>
                              </div>
                            ))}
                          </div>

                          {diagnoseLogs.length > 0 && (
                            <div className="space-y-1 pt-1.5 font-sans">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Registros do terminal:</span>
                              <pre className="p-2.5 bg-black text-[9px] font-mono text-slate-300 rounded-lg max-h-32 overflow-y-auto leading-relaxed border border-slate-800">
                                {diagnoseLogs.map((log, idx) => {
                                  let colorClass = "text-slate-350";
                                  if (log.toLowerCase().includes('[erro]') || log.toLowerCase().includes('fail')) colorClass = "text-rose-450";
                                  if (log.toLowerCase().includes('ok') || log.toLowerCase().includes('sucesso')) colorClass = "text-emerald-400";
                                  return <div key={idx} className={colorClass}>{log}</div>;
                                })}
                              </pre>
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => copyToClipboard(diagnoseLogs.join('\n'), 'diagnose-logs')}
                            className="w-full text-center py-2 bg-slate-800 hover:bg-slate-850 rounded-lg text-slate-300 hover:text-white font-medium text-[10px] uppercase tracking-wider"
                          >
                            Copiar Log Completo
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* WEBHOOKS ADVANCED ACCORDION (CARREGA APENAS SOB DEMANDA DE EXPANSÃO) */}
          {hasPluggyKeys && (
            <div id="webhooks-drawer" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-850 rounded-2xl overflow-hidden shadow-xs">
              <button
                type="button"
                className="w-full px-5 py-4 flex items-center justify-between text-left focus:outline-none cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                onClick={() => setIsWebhooksOpen(!isWebhooksOpen)}
              >
                <div className="flex items-center gap-2">
                  <Radio className="w-4.5 h-4.5 text-slate-500 dark:text-slate-400 shrink-0" />
                  <span className="font-bold text-xs text-slate-700 dark:text-slate-350">Webhooks & Eventos</span>
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
                        <p className="text-[11px] text-slate-650 dark:text-indigo-305 leading-relaxed">
                          <strong>Tempo Real:</strong> Permite que a Pluggy notifique nosso servidor imediatamente quando houver novos lançamentos.
                        </p>
                      </div>

                      {/* WEBHOOK REGISTER COMPENDIUM */}
                      <form onSubmit={handleRegisterWebhook} className="space-y-2 pt-1">
                        <div className="space-y-1">
                          <label htmlFor="webhookUrlInput" className="text-[10px] font-bold text-slate-500 font-sans block uppercase tracking-wider">URL do Listener</label>
                          <input
                            id="webhookUrlInput"
                            type="url"
                            value={webhookUrl}
                            onChange={(e) => setWebhookUrl(e.target.value)}
                            className="w-full bg-slate-50 dark:bg-slate-950 text-slate-805 dark:text-slate-100 border border-slate-205 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-505"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={isRegisteringWebhook}
                          className="w-full h-9 bg-indigo-605 hover:bg-indigo-700 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          {isRegisteringWebhook ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link className="w-3.5 h-3.5 text-emerald-400" />}
                          <span>Ativar Webhook no Pluggy</span>
                        </button>
                      </form>

                      {/* LIST DE WEBHOOKS ATIVOS */}
                      <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-slate-405 uppercase tracking-wider block">Registros no Gateway</span>
                          <button
                            type="button"
                            onClick={loadPluggyWebhooks}
                            disabled={isLoadingWebhooks}
                            className="p-1 hover:bg-slate-50 dark:hover:bg-slate-800 rounded"
                            aria-label="Atualizar webhooks"
                          >
                            <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
                          </button>
                        </div>

                        {isLoadingWebhooks ? (
                          <div className="flex justify-center items-center py-4">
                            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                          </div>
                        ) : pluggyWebhooks.length === 0 ? (
                          <div className="p-3 text-center border border-dashed border-slate-200 dark:border-slate-800 text-[11px] text-slate-400 italic rounded-xl bg-slate-50/50">
                            Nenhum webhook registrado na Pluggy.
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {pluggyWebhooks.map((wh) => (
                              <div key={wh.id} className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between gap-2.5 font-mono text-[10px] text-slate-700 dark:text-slate-300">
                                <div className="min-w-0 pr-1 space-y-1">
                                  <span className="bg-indigo-50 text-indigo-750 dark:bg-indigo-950/40 dark:text-indigo-400 text-[8px] px-1.5 py-0.5 rounded font-bold uppercase">{wh.event}</span>
                                  <p className="truncate text-slate-400 mt-1 leading-none">{wh.url}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteWebhook(wh.id)}
                                  className="p-1 hover:bg-rose-50 dark:hover:bg-rose-950/25 text-rose-500 rounded transition-colors shrink-0 cursor-pointer"
                                  aria-label="Deletar Webhook"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* WEBHOOK NOTIFICATION LOGS LIST */}
                      <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-sans">Logs de Auditoria</span>
                          <button
                            type="button"
                            onClick={loadCapturedEvents}
                            disabled={isLoadingEvents}
                            className="p-1 hover:bg-slate-50 dark:hover:bg-slate-800 rounded"
                            aria-label="Atualizar logs de auditoria"
                          >
                            <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
                          </button>
                        </div>

                        {isLoadingEvents ? (
                          <div className="flex justify-center items-center py-4">
                            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                          </div>
                        ) : capturedEvents.length === 0 ? (
                          <div className="p-3 text-center border border-dashed border-slate-200 dark:border-slate-800 text-[11px] text-slate-400 italic rounded-xl bg-slate-50/50 leading-relaxed">
                            Aguardando primeiras chamadas de webhook do Pluggy... Descrições e cargas recebidas aparecerão aqui.
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-52 overflow-y-auto pr-0.5 font-mono text-[9px]">
                            {capturedEvents.map((evt) => {
                              const dateObj = new Date(evt.receivedAt);
                              const formattedDate = dateObj.toLocaleDateString('pt-BR') + ' ' + dateObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                              return (
                                <div key={evt.id} className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-805 rounded-xl space-y-1.5">
                                  <div className="flex items-center justify-between text-[10px]">
                                    <span className="font-bold text-slate-850 dark:text-slate-100">{evt.event}</span>
                                    <span className="text-slate-400">{formattedDate}</span>
                                  </div>
                                  <div className="space-y-0.5 text-slate-500 leading-tight">
                                    <div>ID: {evt.itemId}</div>
                                    <div className="flex items-center justify-between">
                                      <span>Status:</span>
                                      <span className="text-emerald-500 font-bold uppercase">{evt.status}</span>
                                    </div>
                                  </div>
                                  <details>
                                    <summary className="cursor-pointer text-slate-450 hover:text-slate-650 outline-none">Payload</summary>
                                    <pre className="bg-black text-slate-350 p-2 rounded-lg mt-1 max-h-24 overflow-auto font-mono text-[8px] leading-relaxed">
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

      {/* GLOBAL CONFIRMATION MODAL OVERLAY (Saves us from iframe window.confirm blocking) */}
      <AnimatePresence>
        {confirmModal?.isOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800 space-y-4 text-left"
            >
              <div className="flex gap-3.5 items-start">
                <div className={`p-2.5 rounded-xl ${confirmModal.actionType === 'danger' ? 'bg-rose-50 text-rose-500 dark:bg-rose-950/30' : 'bg-emerald-50 text-emerald-500 dark:bg-emerald-950/30'} shrink-0`}>
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-bold text-sm text-slate-850 dark:text-slate-100">{confirmModal.title}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-404 leading-relaxed font-sans">{confirmModal.description}</p>
                </div>
              </div>

              <div className="flex gap-2.5 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmModal(null)}
                  className="px-4 py-2 bg-slate-105 dark:bg-slate-850 text-slate-650 dark:text-slate-300 font-bold text-xs rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmModal.onConfirm}
                  className={`px-4 py-2 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer ${
                    confirmModal.actionType === 'danger' 
                      ? 'bg-rose-600 hover:bg-rose-700' 
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {confirmModal.actionLabel}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
