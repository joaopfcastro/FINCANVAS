import React, { useState, useEffect, useRef } from 'react';
import { doc, updateDoc, serverTimestamp, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, Transaction } from '../App';
import { User } from 'firebase/auth';
import { 
  classifyPluggyDirection, 
  normalizeInstitutionName, 
  cleanDescriptionLocally,
  shouldIncludeInSaldoTotal
} from '../lib/pluggyNormalizer';
import { 
  KeyRound, Eye, EyeOff, Check, Trash2, Loader2, Database, Info, 
  CheckCircle2, ChevronRight, Key, RefreshCw, Radio, CreditCard, Link, Copy, AlertTriangle, ShieldCheck, ChevronDown, Settings2, Sliders, Play, Lock, CopyCheck, Sparkles, Activity
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';

interface PluggySettingsPanelProps {
  user: User;
  profile: UserProfile;
  transactions: Transaction[];
  learnedRules?: any[];
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

// --- SETUP STEP INTERFACE & RENDERING ---
interface SetupStepProps {
  number: number;
  title: string;
  description: string;
  status: 'pending' | 'current' | 'completed' | 'attention';
}

const SetupStep = ({ number, title, description, status }: SetupStepProps) => {
  const getStatusStyle = () => {
    switch (status) {
      case 'completed':
        return {
          bg: 'bg-emerald-50/70 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900/40',
          badge: 'bg-emerald-500 text-white dark:bg-emerald-600',
          text: 'text-slate-900 dark:text-slate-100 font-semibold',
          desc: 'text-slate-500 dark:text-slate-400',
          icon: <Check className="w-3.5 h-3.5 stroke-[3px]" />
        };
      case 'current':
        return {
          bg: 'bg-blue-50/70 border-blue-200 dark:bg-blue-950/20 dark:border-blue-900/40 ring-1 ring-blue-500/20',
          badge: 'bg-blue-600 text-white',
          text: 'text-blue-900 dark:text-blue-200 font-bold',
          desc: 'text-blue-700/80 dark:text-blue-300/80',
          icon: <span className="text-xs font-bold leading-none">{number}</span>
        };
      case 'attention':
        return {
          bg: 'bg-rose-50/70 border-rose-200 dark:bg-rose-950/20 dark:border-rose-900/40 animate-pulse',
          badge: 'bg-rose-600 text-white',
          text: 'text-rose-900 dark:text-rose-200 font-semibold',
          desc: 'text-rose-700 dark:text-rose-300',
          icon: <AlertTriangle className="w-3.5 h-3.5" />
        };
      default: // pending
        return {
          bg: 'bg-slate-50/50 border-slate-200 dark:bg-slate-900/20 dark:border-slate-800/60',
          badge: 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
          text: 'text-slate-400 dark:text-slate-500',
          desc: 'text-slate-400/80 dark:text-slate-600',
          icon: <span className="text-xs leading-none">{number}</span>
        };
    }
  };

  const style = getStatusStyle();

  return (
    <div className={`p-4 rounded-2xl border flex gap-3.5 items-start transition-all duration-200 ${style.bg}`}>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${style.badge}`}>
        {style.icon}
      </div>
      <div className="space-y-1">
        <h4 className={`text-xs uppercase tracking-wider ${style.text}`}>{title}</h4>
        <p className={`text-[11px] leading-relaxed ${style.desc}`}>{description}</p>
      </div>
    </div>
  );
};

// --- ADVANCED ACCORDION CONTAINER ---
interface AdvancedAccordionProps {
  title: string;
  icon: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const AdvancedAccordion = ({ title, icon, isOpen, onToggle, children }: AdvancedAccordionProps) => {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs transition-all duration-200">
      <button
        type="button"
        className="w-full px-5 py-4 flex items-center justify-between text-left focus:outline-none cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-slate-500 dark:text-slate-400">{icon}</span>
          <span className="font-bold text-xs text-slate-700 dark:text-slate-300">{title}</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden border-t border-slate-100 dark:border-slate-800"
          >
            <div className="p-5 space-y-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export function PluggySettingsPanel({ user, profile, transactions, learnedRules = [] }: PluggySettingsPanelProps) {
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
  const [showManualForm, setShowManualForm] = useState(false);
  const [isLoadingConnect, setIsLoadingConnect] = useState(false);
  const [isTestingPluggy, setIsTestingPluggy] = useState(false);
  const [isSyncingPluggy, setIsSyncingPluggy] = useState(false);
  const [pluggySyncStep, setPluggySyncStep] = useState('');
  const [pluggyItems, setPluggyItems] = useState<any[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  
  // Advanced Accordions Collapsed states (All off by default)
  const [isCredentialsOpen, setIsCredentialsOpen] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [isWebhooksOpen, setIsWebhooksOpen] = useState(false);
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);

  // Auto-scrolling ref to keys setup
  const credentialsRef = useRef<HTMLDivElement>(null);

  // --- DIAGNOSTICS & WEBHOOKS STATE ---
  const [diagnoseSteps, setDiagnoseSteps] = useState<any[] | null>(null);
  const [diagnoseLogs, setDiagnoseLogs] = useState<string[]>([]);
  const [copiedStates, setCopiedStates] = useState<Record<string, boolean>>({});
  const [pluggyWebhooks, setPluggyWebhooks] = useState<any[]>([]);
  const [isLoadingWebhooks, setIsLoadingWebhooks] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [selectedEvent, setSelectedEvent] = useState('item/updated');
  const [isWebhookSecretConfigured, setIsWebhookSecretConfigured] = useState(false);
  const [isRegisteringWebhook, setIsRegisteringWebhook] = useState(false);
  const [capturedEvents, setCapturedEvents] = useState<any[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);

  // Custom modal configuration
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    actionLabel: string;
    actionType: 'danger' | 'info';
    onConfirm: () => void;
  } | null>(null);

  // Sync parent pluggyItemIds into local optimistic array
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

  // Handle open credentials accordion smoothly
  const handleFocusCredentialsSetup = () => {
    setIsCredentialsOpen(true);
    setTimeout(() => {
      credentialsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  };

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
      setIsCredentialsOpen(false);
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
          setIsCredentialsOpen(false);
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
                  setLocalItemIds(updatedIds);
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
        setIsDiagnosticsOpen(true);
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
      setLocalItemIds(updatedIds);

      await updateDoc(doc(db, 'users', user.uid), {
        pluggyItemIds: updatedIds,
        updatedAt: serverTimestamp()
      });
      setManualItemIdInput('');
      setShowManualForm(false);
      toast.dismiss('validate-item');
      toast.success(`Conexão (${valData.item?.connector || 'Pluggy'}) vinculada com sucesso!`);
      await loadPluggyItems();
    } catch (err: any) {
      toast.dismiss('validate-item');
      console.error(err);
      toast.error('Erro ao salvar o ID ou validar no Firestore.');
    }
  };

  // --- UNIFY DISCONNECT ---
  const handleRemoveManualItemId = async (idPost: string, silent = false) => {
    if (silent) {
      await executeRemoveManualItemId(idPost);
      return;
    }

    setConfirmModal({
      isOpen: true,
      title: 'Desvincular Conexão?',
      description: 'Tem certeza que deseja desvincular esta conta integrada do FINCANVAS? Seus lançamentos históricos de extratos já importados serão mantidos intactos, mas novas importações não serão possíveis para esta conta bancária.',
      actionLabel: 'Desvincular',
      actionType: 'danger',
      onConfirm: async () => {
        setConfirmModal(null);
        await executeRemoveManualItemId(idPost);
      }
    });
  };

  const executeRemoveManualItemId = async (idPost: string) => {
    const updated = localItemIds.filter((item: string) => item !== idPost);
    setLocalItemIds(updated);
    setPluggyItems(prev => prev.filter(item => item.id !== idPost));

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        pluggyItemIds: updated,
        updatedAt: serverTimestamp()
      });
      toast.success('Conexão removida com sucesso!');
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao salvar alteração. Restaurando conexões prévias.');
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
          itemIds: localItemIds,
          learnedRules
        })
      });

      const data = await safeJsonClient(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Problema de resposta no servidor de sincronização.');
      }

      // Upsert retrieved account balances
      const incomingAccounts = data.accounts || [];
      if (incomingAccounts.length > 0) {
        const balancesCol = collection(db, 'accountBalances');
        const qBalances = query(balancesCol, where('userId', '==', user.uid));
        const currentBalancesSnap = await getDocs(qBalances);
        
        const existingDocsMap = new Map<string, { id: string, includeInSaldoTotal: boolean, includeReason: string }>();
        currentBalancesSnap.docs.forEach(docSnap => {
          const bData = docSnap.data();
          if (bData.accountId) {
            existingDocsMap.set(bData.accountId, {
              id: docSnap.id,
              includeInSaldoTotal: bData.includeInSaldoTotal !== undefined ? bData.includeInSaldoTotal : true,
              includeReason: bData.includeReason || ''
            });
          }
        });

        for (const acc of incomingAccounts) {
          const existing = existingDocsMap.get(acc.accountId);
          let include = true;
          let reason = 'Saldo disponível';

          if (existing) {
            include = existing.includeInSaldoTotal;
            reason = existing.includeReason;
          } else {
            const decision = shouldIncludeInSaldoTotal(acc.accountType, acc.accountSubtype);
            include = decision.include;
            reason = decision.reason;
          }

          const docPayload = {
            userId: user.uid,
            provider: 'pluggy',
            itemId: acc.itemId || null,
            accountId: acc.accountId,
            bankName: acc.bankName,
            bankRawName: acc.bankRawName || null,
            accountName: acc.accountName,
            accountRawName: acc.accountRawName || null,
            accountLabel: acc.accountLabel,
            accountType: acc.accountType,
            accountSubtype: acc.accountSubtype || null,
            number: acc.number || null,
            balance: typeof acc.balance === 'number' ? acc.balance : 0,
            currencyCode: acc.currencyCode || 'BRL',
            includeInSaldoTotal: include,
            includeReason: reason,
            status: acc.status || 'ACTIVE',
            sourceRaw: acc.sourceRaw || null,
            lastSyncedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          };

          if (existing) {
            const docRef = doc(db, 'accountBalances', existing.id);
            await setDoc(docRef, docPayload, { merge: true });
          } else {
            const docRef = doc(balancesCol);
            await setDoc(docRef, {
              ...docPayload,
              createdAt: serverTimestamp()
            });
          }
        }
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

      setPluggySyncStep(`Reconhecendo transações com motor local. Gravando ${filterToInsert.length} transações...`);

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
          updatedAt: serverTimestamp(),
          // Persist the full normalized metadata:
          rawAmount: itemToSave.rawAmount !== undefined ? itemToSave.rawAmount : null,
          sourceRaw: itemToSave.sourceRaw || null,
          bankRawName: itemToSave.bankRawName || null,
          accountRawName: itemToSave.accountRawName || null,
          accountLabel: itemToSave.accountLabel || null,
          accountId: itemToSave.accountId || null,
          itemId: itemToSave.itemId || null,
          pluggyType: itemToSave.pluggyType || null,
          accountType: itemToSave.accountType || null,
          accountSubtype: itemToSave.accountSubtype || null,
          operationType: itemToSave.operationType || null,
          paymentData: itemToSave.paymentData || null,
          merchant: itemToSave.merchant || null,
          detectedDirection: itemToSave.detectedDirection || itemToSave.type,
          directionConfidence: itemToSave.directionConfidence !== undefined ? itemToSave.directionConfidence : null,
          directionReason: itemToSave.directionReason || null,
          isLikelyInternalTransfer: itemToSave.isLikelyInternalTransfer !== undefined ? itemToSave.isLikelyInternalTransfer : false,
          shouldIgnoreInTotals: itemToSave.shouldIgnoreInTotals !== undefined ? itemToSave.shouldIgnoreInTotals : false,
        } as any);
      }

      setPluggySyncStep(`Concluído! ${filterToInsert.length} transações adicionadas e reconhecidas localmente.`);
      toast.success(`${filterToInsert.length} transações importadas com sucesso!`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Falha na sincronização.');
      setPluggySyncStep('Ocorreu um erro inesperado.');
    } finally {
      setIsSyncingPluggy(false);
    }
  };

  // --- HISTORICAL AUDIT AND HIGH-TOUCH SANITIZER ENGINE ---
  const getAuditReport = () => {
    let mismatchedFields = 0;
    let dirtyBankNames = 0;
    let totalAuditable = 0;

    for (const t of transactions) {
      if (!t.pluggyId) continue;
      totalAuditable++;

      const direction = classifyPluggyDirection({
        amount: t.rawAmount !== undefined ? t.rawAmount : (t.type === 'Receita' ? t.amount : -Math.abs(t.amount)),
        pluggyType: t.pluggyType || (t.type === 'Receita' ? 'CREDIT' : 'DEBIT'),
        accountType: t.accountType,
        accountSubtype: t.accountSubtype,
        description: t.descriptionRaw || t.desc,
        operationType: t.operationType,
        originalCategory: t.cat,
      });

      const institution = normalizeInstitutionName({
        connectorName: t.source,
        providerName: t.source,
        itemName: t.source,
        accountName: t.source,
      });

      const needsTypeUpdate = t.type !== direction.detectedDirection;
      const needsSourceUpdate = t.source !== institution.source;

      if (needsTypeUpdate) mismatchedFields++;
      if (needsSourceUpdate) dirtyBankNames++;
    }

    return { totalAuditable, mismatchedFields, dirtyBankNames };
  };

  const handleReprocessAllTransactions = async () => {
    setIsReprocessing(true);
    try {
      let correctedCount = 0;
      for (const t of transactions) {
        if (!t.pluggyId || !t.id) continue;

        const direction = classifyPluggyDirection({
          amount: t.rawAmount !== undefined ? t.rawAmount : (t.type === 'Receita' ? t.amount : -Math.abs(t.amount)),
          pluggyType: t.pluggyType || (t.type === 'Receita' ? 'CREDIT' : 'DEBIT'),
          accountType: t.accountType,
          accountSubtype: t.accountSubtype,
          description: t.descriptionRaw || t.desc,
          operationType: t.operationType,
          originalCategory: t.cat,
        });

        const institution = normalizeInstitutionName({
          connectorName: t.source,
          providerName: t.source,
          itemName: t.source,
          accountName: t.source,
        });

        const needsTypeUpdate = t.type !== direction.detectedDirection;
        const needsAmountUpdate = t.amount !== direction.normalizedAmount;
        const needsSourceUpdate = t.source !== institution.source;
        const needsDescriptionClean = t.desc !== cleanDescriptionLocally(t.desc);

        if (needsTypeUpdate || needsAmountUpdate || needsSourceUpdate || needsDescriptionClean || !t.bankRawName) {
          const docRef = doc(db, 'transactions', t.id);
          await updateDoc(docRef, {
            type: direction.detectedDirection,
            amount: direction.normalizedAmount,
            source: institution.source,
            desc: cleanDescriptionLocally(t.desc),
            updatedAt: serverTimestamp(),
            // Ensure fields are fully populated:
            rawAmount: t.rawAmount !== undefined ? t.rawAmount : (t.type === 'Receita' ? t.amount : -Math.abs(t.amount)),
            bankRawName: t.bankRawName || institution.bankRawName,
            detectedDirection: direction.detectedDirection,
            directionConfidence: direction.confidence,
            directionReason: direction.reason,
            isLikelyInternalTransfer: direction.isLikelyInternalTransfer,
            shouldIgnoreInTotals: direction.shouldIgnoreInTotals
          });
          correctedCount++;
        }
      }
      toast.success(`${correctedCount} transações históricas foram analisadas, corrigidas e gravadas com sucesso!`);
    } catch (err: any) {
      console.error(err);
      toast.error('Falha ao auditar e reprocessar dados históricos.');
    } finally {
      setIsReprocessing(false);
    }
  };

  // --- WEBHOOK CLIENT METHODS ---
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
          event: selectedEvent,
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
        if (data.webhookSecretConfigured) {
          setIsWebhookSecretConfigured(true);
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

  // Unique status badge calculations
  const renderStatusBadge = () => {
    if (!hasPluggyKeys) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-xs font-semibold dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/40">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
          Credenciais pendentes
        </span>
      );
    }
    if (hasOutdatedItems) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-50 text-rose-700 border border-rose-200 rounded-full text-xs font-semibold dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-900/40 animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
          Ação necessária
        </span>
      );
    }
    if (isAwaitingItemIds) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-xs font-semibold dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/40">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
          Pronto para conectar
        </span>
      );
    }
    if (isSyncingPluggy) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-xs font-semibold dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/40 animate-pulse">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
          Sincronizando
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-semibold dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/40">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
        Sincronizado
      </span>
    );
  };

  return (
    <div className="space-y-6 w-full max-w-7xl mx-auto pb-12 font-sans overflow-x-hidden">
      
      {/* 1. CLEAN HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-emerald-500 shrink-0" />
            Integração bancária
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Conecte suas contas pelo Meu Pluggy e sincronize lançamentos automaticamente.
          </p>
        </div>
        <div className="flex shrink-0 self-start sm:self-center">
          {renderStatusBadge()}
        </div>
      </div>

      {/* 2. CARD PRINCIPAL: CONFIGURAÇÃO DO MEU PLUGGY */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
        <div>
          <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <Sliders className="w-4 h-4 text-emerald-500" />
            Configuração do Meu Pluggy
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Acompanhe o fluxo de ativação simples para liberar a consolidação automática.
          </p>
        </div>

        {/* GUIDED STEPS TIMELINE WRAPPER (Responsive: Row on desktop, Stacked on mobile) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SetupStep
            number={1}
            title="Etapa 1: Credenciais"
            description={hasPluggyKeys ? "Credenciais salvas e operacionais no servidor." : "Ponto de acesso API e chaves cadastrais do Pluggy pendentes."}
            status={hasPluggyKeys ? "completed" : "current"}
          />
          <SetupStep
            number={2}
            title="Etapa 2: Conta bancária"
            description={
              !hasPluggyKeys ? "Aguardando definição das chaves cadastrais." :
              isAwaitingItemIds ? "Pronto para vincular as primeiras contas." :
              hasOutdatedItems ? "Contas vinculadas precisam de atenção imediata." : "Contas vinculadas com sucesso à sua dashboard."
            }
            status={
              !hasPluggyKeys ? "pending" :
              isAwaitingItemIds ? "current" :
              hasOutdatedItems ? "attention" : "completed"
            }
          />
          <SetupStep
            number={3}
            title="Etapa 3: Sincronização"
            description={
              isAwaitingItemIds ? "Aguardando vinculação ativa de uma conta principal." :
              isSyncingPluggy ? "Executando carga e classificação dinâmica por Inteligência Artificial." : "Lançamentos e extratos prontos para sincronismo."
            }
            status={
              (!hasPluggyKeys || isAwaitingItemIds) ? "pending" :
              isSyncingPluggy ? "current" : "completed"
            }
          />
        </div>
      </div>

      {/* 3. CARD PRINCIPAL CONTEXTUAL (SAVES CLUTTER) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
        
        {/* CASE A: NO CREDENTIALS CONFIGURED */}
        {!hasPluggyKeys && (
          <div className="space-y-4">
            <div className="flex gap-4 items-start">
              <div className="bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 p-3 rounded-2xl shrink-0">
                <AlertTriangle className="w-6 h-6 animate-pulse" />
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-sm text-slate-900 dark:text-slate-150">Passo 1: Chaves cadastrais necessárias</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Para habilitar qualquer sincronismo, você precisa cadastrar as credenciais do Pluggy no sistema. Obtenha chaves de desenvolvimento gratuitas acessando o console de parceiros.
                </p>
              </div>
            </div>
            
            <div className="pt-2">
              <button
                type="button"
                onClick={handleFocusCredentialsSetup}
                className="w-full sm:w-auto h-11 px-6 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
              >
                <Key className="w-4 h-4" />
                <span>Adicionar credenciais da Pluggy</span>
              </button>
            </div>
          </div>
        )}

        {/* CASE B: CREDENTIALS OK, BUT NO ACCOUNTS CONNECTED */}
        {hasPluggyKeys && isAwaitingItemIds && (
          <div className="space-y-4">
            <div className="flex gap-4 items-start">
              <div className="bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 p-4 rounded-xl shrink-0">
                <Link className="w-5 h-5 animate-spin-slow" />
              </div>
              <div className="space-y-1 flex-1">
                <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">Passo 2: Vincule sua primeira conta bancária</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Suas credenciais cadastrais estão corretas! Use o painel blindado e seguro do <strong>Pluggy Connect</strong> para vincular sua instituição financeira.
                </p>
              </div>
            </div>

            <div className="pt-2 space-y-3">
              <button
                type="button"
                onClick={() => handleOpenPluggyConnect()}
                disabled={isLoadingConnect}
                className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] md:w-auto md:px-6"
              >
                {isLoadingConnect ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-200 animate-pulse" />
                )}
                <span>Conectar conta pelo Meu Pluggy</span>
              </button>

              {/* Discreet Manual entry toggle */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowManualForm(!showManualForm)}
                  className="text-xs text-slate-400 hover:text-emerald-600 font-bold transition-colors underline cursor-pointer"
                >
                  {showManualForm ? "Ocultar entrada manual" : "Já tenho um Item ID existencial (Avançado)"}
                </button>
              </div>

              {/* Expansible input uuid */}
              <AnimatePresence>
                {showManualForm && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3 max-w-xl"
                  >
                    <div className="space-y-1">
                      <label htmlFor="manual_uuid" className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">UUID do Item ID da Pluggy</label>
                      <div className="flex gap-2">
                        <input
                          id="manual_uuid"
                          type="text"
                          value={manualItemIdInput}
                          onChange={(e) => setManualItemIdInput(e.target.value)}
                          placeholder="Ex: 88fa38cc-a3bf-4874-9582-12efea85a9bc"
                          className="flex-1 bg-white dark:bg-black text-slate-850 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500 h-10 w-full"
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={handleSaveManualItemId}
                          className="h-10 px-4 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer shrink-0"
                        >
                          Vincular ID
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* CASE C: ACCOUNTS CONNECTED - MAIN SYNC CONTEXT */}
        {hasPluggyKeys && !isAwaitingItemIds && (
          <div className="space-y-4">
            <div className="flex gap-4 items-start">
              <div className="bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 p-4 rounded-xl shrink-0">
                <RefreshCw className={`w-5 h-5 ${isSyncingPluggy ? 'animate-spin' : ''}`} />
              </div>
              <div className="space-y-1 flex-1">
                <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">Passo 3: Sincronize suas transações</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Contas vinculadas operacionais no FINCANVAS. Sincronize os dados com segurança para importar os últimos 30 dias de extratos categorizados com Inteligência Artificial.
                </p>
              </div>
            </div>

            {pluggySyncStep && (
              <div className="bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-slate-800 p-3.5 rounded-xl text-xs font-mono text-emerald-600 dark:text-emerald-400 flex items-center leading-relaxed">
                {isSyncingPluggy && <Loader2 className="w-4 h-4 mr-2.5 animate-spin text-emerald-500" />}
                <span>{pluggySyncStep}</span>
              </div>
            )}

            <div className="pt-2">
              <button
                type="button"
                onClick={handleSyncPluggyTransactions}
                disabled={isSyncingPluggy}
                className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] md:w-auto md:px-6"
              >
                {isSyncingPluggy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Sincronizando transações...</span>
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

      {/* 4. CARD 3: CONTAS VINCULADAS */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <Database className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
            Contas vinculadas ({localItemIds.length})
          </h3>
          {localItemIds.length > 0 && (
            <button
              type="button"
              onClick={loadPluggyItems}
              disabled={isLoadingItems}
              className="text-xs font-bold text-emerald-600 hover:text-emerald-700 disabled:opacity-40 flex items-center gap-1.5 cursor-pointer py-1.5 px-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-lg transition-colors"
            >
              {isLoadingItems ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              <span>Atualizar status</span>
            </button>
          )}
        </div>

        {/* LOADING & EMPTY CONNECTIONS */}
        {isLoadingItems && localItemIds.length > 0 && pluggyItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-3">
            <Loader2 className="w-7 h-7 animate-spin text-emerald-500" />
            <span className="text-xs">Carregando detalhes das conexões no servidor...</span>
          </div>
        ) : localItemIds.length === 0 ? (
          <div className="py-12 text-center bg-slate-50/50 dark:bg-black/20 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl space-y-3">
            <p className="font-bold text-xs text-slate-700 dark:text-slate-350">Nenhuma conta integrada conectada</p>
            <p className="text-[11px] text-slate-400 max-w-sm mx-auto leading-relaxed">
              Vincule sua primeira instituição bancária para começar a monitorar seus extratos automaticamente!
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {unifiedConnections.map((conn) => {
              const matchesError = ["OUTDATED", "LOGIN_ERROR", "NEEDS_RECONNECT"].includes(conn.status);
              
              const colorMaps: Record<string, string> = {
                UPDATED: 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/40',
                UPDATING: 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/40',
                OUTDATED: 'bg-amber-50 text-amber-700 border-amber-150 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/40 animate-pulse',
                LOGIN_ERROR: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/20 dark:text-rose-450 dark:border-rose-900/4 dark:border-rose-900/40',
                PENDING_REGISTRATION: 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700',
              };

              const statusHumanLabel: Record<string, string> = {
                UPDATED: 'Sincronizada',
                UPDATING: 'Atualizando',
                OUTDATED: 'Precisa reconectar',
                LOGIN_ERROR: 'Erro de login',
                PENDING_REGISTRATION: 'ID salvo',
              };

              return (
                <div 
                  key={conn.id}
                  className="p-4 bg-slate-50/40 dark:bg-black/30 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    {conn.imageUrl ? (
                      <img 
                        src={conn.imageUrl} 
                        alt={conn.name} 
                        className="w-10 h-10 object-contain rounded-xl bg-white dark:bg-slate-800 p-1.5 border border-slate-200 dark:border-slate-700 shrink-0 shadow-2xs" 
                        referrerPolicy="no-referrer" 
                      />
                    ) : (
                      <div className="w-10 h-10 bg-slate-200 dark:bg-slate-800 rounded-xl flex items-center justify-center font-bold text-slate-500 dark:text-slate-400 text-xs shrink-0">
                        {conn.name?.[0]?.toUpperCase() || 'B'}
                      </div>
                    )}
                    <div className="min-w-0 space-y-1">
                      <h4 className="font-bold text-xs text-slate-800 dark:text-slate-200 truncate pr-2">
                        {conn.name}
                      </h4>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-400 font-mono" title={conn.id}>
                          ID: {conn.id.substring(0, 8)}...{conn.id.substring(conn.id.length - 8)}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(conn.id, `itemid-${conn.id}`)}
                          className="p-1 hover:bg-slate-150 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 rounded-md transition-colors shrink-0 cursor-pointer"
                          aria-label={`Copiar Item ID ${conn.id}`}
                        >
                          {copiedStates[`itemid-${conn.id}`] ? (
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Actions & humanized badge */}
                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 border-t border-slate-100 dark:border-slate-800/60 pt-3 sm:pt-0 sm:border-0">
                    <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold border shrink-0 uppercase tracking-wider ${colorMaps[conn.status] || 'bg-slate-100 text-slate-600 border-slate-200/60 dark:bg-slate-800'}`}>
                      {statusHumanLabel[conn.status] || conn.status}
                    </span>

                    <div className="flex items-center gap-2">
                      {matchesError && (
                        <button
                          type="button"
                          onClick={() => handleOpenPluggyConnect(conn.id)}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] rounded-lg transition-all shadow-xs cursor-pointer"
                        >
                          Reconectar
                        </button>
                      )}
                      
                      <button
                        type="button"
                        onClick={() => handleRemoveManualItemId(conn.id)}
                        className="p-1.5 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/15 rounded-xl transition-colors cursor-pointer shrink-0"
                        title="Desvincular do FINCANVAS"
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

      {/* 5. CARD 4: SINCRONIZAÇÃO */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
        <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200 flex items-center gap-2 border-b border-slate-100 dark:border-slate-850 pb-3">
          <RefreshCw className="w-4.5 h-4.5 text-emerald-500" />
          Sincronização
        </h3>

        {localItemIds.length === 0 ? (
          <div className="py-4 text-center text-xs text-slate-400 italic">
            Conecte uma conta primeiro nas etapas acima para poder operar os sincronismos.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Visual indicators row */}
            <div className="grid grid-cols-3 gap-3 bg-slate-50/50 dark:bg-black/20 border border-slate-150 dark:border-slate-800 p-4 rounded-xl text-center text-xs font-mono">
              <div>
                <span className="text-slate-400 block text-[9px] uppercase tracking-wider font-bold">Conexões</span>
                <span className="text-slate-800 dark:text-slate-100 font-bold text-sm mt-1 block">{localItemIds.length}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[9px] uppercase tracking-wider font-bold">Janela</span>
                <span className="text-slate-805 dark:text-slate-100 font-bold text-sm mt-1 block">Últimos 30 dias</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[9px] uppercase tracking-wider font-bold">Estado</span>
                <span className={`font-bold text-sm mt-1 block ${hasOutdatedItems ? 'text-amber-500' : 'text-emerald-500'}`}>
                  {hasOutdatedItems ? 'Reconectar' : 'Operacional'}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed leading-normal">
              A sincronização automática coleta seus extratos, descarta registros duplicados e aplica identificadores automáticos em poucos segundos.
            </p>

            <button
              type="button"
              onClick={handleSyncPluggyTransactions}
              disabled={isSyncingPluggy}
              className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
            >
              {isSyncingPluggy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Sincronizando transações...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current text-white/80" />
                  <span>Sincronizar transações agora</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* 6. AVANÇADO (CLOSED COLLAPSED ACCORDIONS BY DEFAULT) */}
      <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800">
        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest pl-1">Avançado</h4>

        {/* Accordion 1 - Detalhes das Credenciais */}
        <div ref={credentialsRef}>
          <AdvancedAccordion
            title="Detalhes das credenciais"
            icon={<ShieldCheck className="w-4.5 h-4.5" />}
            isOpen={isCredentialsOpen}
            onToggle={() => setIsCredentialsOpen(!isCredentialsOpen)}
          >
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-sans mb-3">
              Monitore se os pares de chaves estão salvos no servidor de back-end. Você pode optar por salvá-las na nuvem NoSQL ou no armazenamento local do seu navegador.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border border-slate-100 dark:border-slate-800 p-4 rounded-xl bg-slate-50/30 dark:bg-black/10">
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-1.5 pt-1">
                  <span className="text-slate-400">Chaves de produção:</span>
                  <span className={`font-bold ${isPluggyConfiguredOnServer ? 'text-emerald-600' : 'text-slate-450'}`}>
                    {isPluggyConfiguredOnServer ? 'Definidas (Servidor)' : 'Ausente'}
                  </span>
                </div>
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-1.5 pt-1">
                  <span className="text-slate-400">Chaves do perfil:</span>
                  <span className={`font-bold ${checkHasPluggyKeys() ? 'text-emerald-600' : 'text-amber-500'}`}>
                    {checkHasPluggyKeys() ? 'Cadastradas' : 'Não cadastradas'}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-slate-400">Gateway SDK base:</span>
                  <span className="text-[10px] bg-slate-150 dark:bg-slate-800 px-1.5 py-0.5 rounded font-bold text-slate-600 dark:text-slate-300">
                    Pluggy V2 API
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2 justify-center">
                <button
                  type="button"
                  onClick={handleTestPluggyKeys}
                  disabled={isTestingPluggy || !hasPluggyKeys}
                  className="w-full h-10 px-4 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-45"
                >
                  {isTestingPluggy ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  <span>Testar comunicação das chaves</span>
                </button>
              </div>
            </div>

            {/* FORM PARA EDIÇÃO DE CHAVES */}
            <form onSubmit={handleSaveCustomKeys} className="space-y-4 pt-3 border-t border-slate-100 dark:border-slate-800">
              <p className="text-[11px] text-slate-400 leading-normal">
                Você pode obter chaves de desenvolvimento gratuitas no painel de desenvolvedores da Pluggy (<strong>developer.pluggy.ai</strong>).
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label htmlFor="pluggy_id_form" className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Client ID</label>
                  <input
                    id="pluggy_id_form"
                    type="text"
                    value={pluggyClientId}
                    onChange={(e) => setPluggyClientId(e.target.value)}
                    placeholder="Chave pública Pluggy Client"
                    className="w-full h-10 bg-slate-50 dark:bg-black text-slate-850 dark:text-slate-100 border border-slate-200 dark:border-slate-705 border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-xs font-mono focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="pluggy_secret_form" className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Client Secret</label>
                  <div className="relative">
                    <input
                      id="pluggy_secret_form"
                      type={showClientSecret ? 'text' : 'password'}
                      value={pluggyClientSecret}
                      onChange={(e) => setPluggyClientSecret(e.target.value)}
                      placeholder="Chave secreta obtida no painel"
                      className="w-full h-10 bg-slate-50 dark:bg-black text-slate-850 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-lg pl-3 pr-10 py-2 text-xs font-mono focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowClientSecret(!showClientSecret)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showClientSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Persistência de chaves */}
              <div className="bg-slate-50/50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-805 space-y-1.5">
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Local de salvamento das chaves</span>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-slate-650 dark:text-slate-400 cursor-pointer">
                    <input
                      type="radio"
                      name="storeMethod"
                      checked={storageMethod === 'cloud'}
                      onChange={() => setStorageMethod('cloud')}
                      className="text-emerald-600 focus:ring-emerald-500 shrink-0"
                    />
                    <span>Nuvem (Salvar no Firestore de forma protegida)</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-slate-650 dark:text-slate-400 cursor-pointer">
                    <input
                      type="radio"
                      name="storeMethod"
                      checked={storageMethod === 'local'}
                      onChange={() => setStorageMethod('local')}
                      className="text-emerald-600 focus:ring-emerald-500 shrink-0"
                    />
                    <span>Local (Salvar somente no seu navegador)</span>
                  </label>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-1">
                <button
                  type="submit"
                  disabled={isSavingCustomKeys}
                  className="px-5 h-10 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-colors active:scale-[0.98]"
                >
                  {isSavingCustomKeys ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  <span>Salvar chaves cadastrais</span>
                </button>

                {(profile.pluggyClientId || localStorage.getItem('PREF_PLUGGY_CLIENT_ID')) && (
                  <button
                    type="button"
                    onClick={handleRemoveCustomKeys}
                    disabled={isSavingCustomKeys}
                    className="px-5 h-10 hover:bg-rose-50 dark:hover:bg-rose-950/20 text-rose-600 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Apagar chaves cadastradas</span>
                  </button>
                )}
              </div>
            </form>
          </AdvancedAccordion>
        </div>

        {/* Accordion 2 - Diagnóstico técnico */}
        <AdvancedAccordion
          title="Diagnóstico técnico"
          icon={<Sliders className="w-4.5 h-4.5" />}
          isOpen={isDiagnosticsOpen}
          onToggle={() => setIsDiagnosticsOpen(!isDiagnosticsOpen)}
        >
          <div className="space-y-4">
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
              Execute testes de handshakes com os endpoints do barramento da API do Pluggy para checar se há chaves expiradas ou conexões inválidas.
            </p>

            {diagnoseSteps ? (
              <div className="space-y-3.5 bg-slate-900 border border-slate-800 p-4 rounded-xl text-slate-100">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-[10px] font-bold uppercase text-slate-405 text-slate-400">Status dos testes da API</span>
                  <button
                    type="button"
                    onClick={() => { setDiagnoseSteps(null); setDiagnoseLogs([]); }}
                    className="text-[9px] text-slate-400 hover:text-white underline cursor-pointer"
                  >
                    Resetar
                  </button>
                </div>

                <div className="space-y-2 text-[11px] font-mono">
                  {diagnoseSteps.map((step, uIdx) => (
                    <div key={uIdx} className="flex items-center justify-between bg-black/35 px-3 py-1.5 border border-slate-800 rounded-lg">
                      <span className="text-slate-300">{step.name}</span>
                      <span className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase ${
                        step.status === 'COMPLETED' ? 'bg-emerald-500/10 text-emerald-400' :
                        step.status === 'RUNNING' ? 'bg-blue-500/10 text-blue-450 text-blue-400 animate-pulse' :
                        step.status === 'FAILED' ? 'bg-rose-500/10 text-rose-400' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {step.status === 'COMPLETED' ? 'Sucesso' : step.status === 'RUNNING' ? 'Testando' : step.status}
                      </span>
                    </div>
                  ))}
                </div>

                {diagnoseLogs.length > 0 && (
                  <div className="space-y-1.5 font-sans">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Logs de Handshake:</span>
                    <pre className="p-2.5 bg-black text-[9px] font-mono text-slate-350 rounded-lg max-h-36 overflow-auto leading-relaxed border border-slate-800 w-full max-w-full whitespace-pre-wrap break-all">
                      {diagnoseLogs.map((lgMsg, lgIdx) => {
                        let classMap = "text-slate-350";
                        if (lgMsg.toLowerCase().includes('[erro]') || lgMsg.toLowerCase().includes('fail')) classMap = "text-rose-400";
                        if (lgMsg.toLowerCase().includes('ok') || lgMsg.toLowerCase().includes('sucesso')) classMap = "text-emerald-400";
                        return <div key={lgIdx} className={classMap}>{lgMsg}</div>;
                      })}
                    </pre>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => copyToClipboard(diagnoseLogs.join('\n'), 'diagnoselogs')}
                  className="w-full text-center py-2 bg-slate-800 hover:bg-slate-850 rounded-lg text-slate-300 hover:text-white font-semibold text-[10px] uppercase tracking-wider cursor-pointer"
                >
                  {copiedStates['diagnoselogs'] ? "Copiado!" : "Copiar todos os registros"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleTestPluggyKeys}
                disabled={isTestingPluggy || !hasPluggyKeys}
                className="w-full h-11 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
              >
                {isTestingPluggy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                <span>Rodar testes de diagnóstico</span>
              </button>
            )}
          </div>
        </AdvancedAccordion>

        {/* Accordion 3 - Webhooks e eventos */}
        <AdvancedAccordion
          title="Webhooks e eventos"
          icon={<Radio className="w-4.5 h-4.5" />}
          isOpen={isWebhooksOpen}
          onToggle={() => setIsWebhooksOpen(!isWebhooksOpen)}
        >
          <div className="space-y-4">
            <div className="bg-indigo-50/50 dark:bg-indigo-950/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
              <p className="text-xs text-slate-650 dark:text-slate-300 leading-relaxed">
                <strong>Atualizações Assíncronas:</strong> Ao configurar um webhook, as atualizações de contas bancárias e novas transações se integram silenciosamente sempre que os conectores realizarem cargas.
              </p>
            </div>

            <form onSubmit={handleRegisterWebhook} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label htmlFor="webhook_input" className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block font-sans">URL do Listener de Entrada</label>
                  <div className="flex gap-2">
                    <input
                      id="webhook_input"
                      type="url"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                      className="flex-1 h-10 bg-slate-50 dark:bg-black text-slate-850 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(webhookUrl, 'webhook-url')}
                      className="h-10 px-3 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-250 transition-colors flex items-center justify-center cursor-pointer shrink-0"
                      title="Copiar URL"
                    >
                      {copiedStates['webhook-url'] ? (
                        <Check className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label htmlFor="webhook_event_select" className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block font-sans">Evento do Webhook</label>
                  <select
                    id="webhook_event_select"
                    value={selectedEvent}
                    onChange={(e) => setSelectedEvent(e.target.value)}
                    className="w-full h-10 bg-slate-50 dark:bg-black text-slate-850 dark:text-slate-100 border border-slate-200 dark:border-slate-805 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer text-slate-700 dark:text-slate-350"
                  >
                    <option value="all">Todos os Eventos (all)</option>
                    <option value="item/created">Item Criado (item/created)</option>
                    <option value="item/updated">Item Atualizado (item/updated)</option>
                    <option value="item/error">Erro no Item (item/error)</option>
                    <option value="item/waiting_user_input">Aguardando Login/MFA (item/waiting_user_input)</option>
                    <option value="item/waiting_user_action">Aguardando Ação do Usuário (item/waiting_user_action)</option>
                    <option value="item/login_succeeded">Login com Sucesso (item/login_succeeded)</option>
                    <option value="transactions/created">Transações Criadas (transactions/created)</option>
                    <option value="transactions/updated">Transações Atualizadas (transactions/updated)</option>
                    <option value="transactions/deleted">Transações Apagadas (transactions/deleted)</option>
                    <option value="connector/status_updated">Status do Conector Atualizado (connector/status_updated)</option>
                  </select>
                </div>
              </div>

              {/* Status & Security Indicators */}
              <div className="flex flex-wrap gap-2 pt-1">
                {isWebhookSecretConfigured ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50/70 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-semibold dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/40">
                    <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                    <span>Seguro (Segredo x-fincanvas-webhook-secret configurado)</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-50/70 text-amber-700 border border-amber-200 rounded-full text-[10px] font-semibold dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/40">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-500 animate-pulse" />
                    <span>Inseguro (Recomendado configurar PLUGGY_WEBHOOK_SECRET)</span>
                  </span>
                )}

                {webhookUrl && (webhookUrl.includes('localhost') || webhookUrl.includes('127.0.0.1')) && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-50/70 text-blue-700 border border-blue-200 rounded-full text-[10px] font-semibold dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-900/40">
                    <Info className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                    <span>Em desenvolvimento (localhost permitido)</span>
                  </span>
                )}
              </div>

              {/* HTTPS Warning Alert */}
              {webhookUrl && !webhookUrl.startsWith('https://') && !(webhookUrl.includes('localhost') || webhookUrl.includes('127.0.0.1')) && (
                <div className="p-3 bg-rose-50/80 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-xl flex gap-2.5 items-start">
                  <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold text-xs text-rose-900 dark:text-rose-200">HTTPS Requerido em Produção</p>
                    <p className="text-[10px] leading-relaxed text-rose-700 dark:text-rose-350">
                      A API em produção do Pluggy exige que a URL do Webhook utilize protocolo HTTPS seguro com SSL para processamento eletrônico de callbacks.
                    </p>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={isRegisteringWebhook}
                className="w-full h-10 bg-slate-800 hover:bg-slate-900 disabled:opacity-45 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 active:scale-[0.99]"
              >
                {isRegisteringWebhook ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link className="w-3.5 h-3.5 text-emerald-400" />}
                <span>Registrar Webhook operacional</span>
              </button>
            </form>

            {/* List Webhooks */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-450 text-slate-400 uppercase tracking-wider block">Listeners Ativos no Gateway</span>
                <button
                  type="button"
                  onClick={loadPluggyWebhooks}
                  disabled={isLoadingWebhooks}
                  className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md cursor-pointer transition-colors"
                  aria-label="Atualizar webhooks"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${isLoadingWebhooks ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {isLoadingWebhooks ? (
                <div className="flex justify-center items-center py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
                </div>
              ) : pluggyWebhooks.length === 0 ? (
                <div className="p-3 text-center border border-dashed border-slate-250 dark:border-slate-800 text-[11px] text-slate-400 italic rounded-xl bg-slate-50/50">
                  Nenhum webhook ativo cadastrado na conta do Pluggy.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {pluggyWebhooks.map((wh) => (
                    <div key={wh.id} className="p-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between gap-3 font-mono text-[10px] text-slate-700 dark:text-slate-300 animate-fadeIn">
                      <div className="min-w-0 pr-1 space-y-1">
                        <span className="bg-indigo-50/80 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400 text-[8px] px-1.5 py-0.5 rounded font-bold uppercase">{wh.event}</span>
                        <p className="truncate text-slate-400 mt-1 leading-none text-[9px]">{wh.url}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteWebhook(wh.id)}
                        className="p-1 hover:bg-rose-50 dark:hover:bg-rose-950/15 text-rose-500 rounded transition-colors shrink-0 cursor-pointer"
                        title="Deletar Webhook"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Audit Logs Webhooks */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 font-sans text-left">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Logs de Auditoria</span>
                <button
                  type="button"
                  onClick={loadCapturedEvents}
                  disabled={isLoadingEvents}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-705 border border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-350 rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoadingEvents ? 'animate-spin' : ''}`} />
                  <span>Atualizar eventos</span>
                </button>
              </div>

              {isLoadingEvents ? (
                <div className="flex justify-center items-center py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
                </div>
              ) : capturedEvents.length === 0 ? (
                <div className="py-8 px-4 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/30 dark:bg-black/10 flex flex-col items-center justify-center gap-2.5">
                  <Activity className="w-6 h-6 text-slate-400 dark:text-slate-600 animate-pulse" />
                  <div className="space-y-1">
                    <p className="font-bold text-xs text-slate-700 dark:text-slate-300">Nenhum evento recebido ainda</p>
                    <p className="text-[10px] text-slate-400 max-w-sm mx-auto leading-relaxed">
                      Os eventos transmitidos pela API da Pluggy serão registrados aqui em tempo real assim que ocorrerem alterações nas contas vinculadas.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-0.5 font-mono text-[9px] text-left">
                  {capturedEvents.map((evt) => {
                    const dateObj = new Date(evt.receivedAt);
                    const formattedDate = dateObj.toLocaleDateString('pt-BR') + ' ' + dateObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                    return (
                      <div key={evt.id} className="p-3 bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-slate-805 rounded-xl space-y-1.5">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="font-bold text-slate-800 dark:text-slate-100">{evt.event}</span>
                          <span className="text-slate-450 text-slate-400">{formattedDate}</span>
                        </div>
                        <div className="space-y-0.5 text-slate-500 leading-tight">
                          <div>ID: {evt.itemId}</div>
                          <div className="flex items-center justify-between">
                            <span>Status:</span>
                            <span className="text-emerald-500 font-bold uppercase">{evt.status}</span>
                          </div>
                        </div>
                        <details className="outline-none">
                          <summary className="cursor-pointer text-slate-400 hover:text-slate-600 outline-none select-none text-[8px] uppercase tracking-wider font-bold">Ver Payload JSON</summary>
                          <pre className="bg-black text-slate-300 p-2 rounded-lg mt-1 max-h-24 overflow-auto font-mono text-[8px] leading-relaxed border border-slate-800 w-full max-w-full whitespace-pre-wrap break-all">
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
        </AdvancedAccordion>

        {/* Accordion 4 - Saneamento e Auditoria de Histórico */}
        <AdvancedAccordion
          title="Saneamento e auditoria de histórico"
          icon={<Sparkles className="w-4.5 h-4.5 text-emerald-500 shrink-0" />}
          isOpen={isAuditOpen}
          onToggle={() => setIsAuditOpen(!isAuditOpen)}
        >
          <div className="space-y-4 font-sans">
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-sans">
              Nosso motor híbrido de saneamento analisa todas as transações importadas no sistema em busca de divergências de sinais ou classificações incorretas geradas por versões legadas da IA ou da API.
            </p>

            {(() => {
              const report = getAuditReport();
              const hasIssues = report.mismatchedFields > 0 || report.dirtyBankNames > 0;

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="p-3 bg-slate-50 dark:bg-black/20 border border-slate-100 dark:border-slate-800 rounded-xl">
                      <span className="text-[10px] text-slate-400 font-medium block uppercase tracking-wider">Transações analisadas</span>
                      <span className="text-lg font-bold text-slate-700 dark:text-slate-300 block mt-1">{report.totalAuditable}</span>
                    </div>
                    <div className="p-3 bg-slate-50 dark:bg-black/20 border border-slate-100 dark:border-slate-800 rounded-xl">
                      <span className="text-[10px] text-slate-405 text-slate-400 font-medium block uppercase tracking-wider">Erros de Direção (Receita/Despesa)</span>
                      <span className={`text-lg font-bold block mt-1 ${report.mismatchedFields > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                        {report.mismatchedFields}
                      </span>
                    </div>
                    <div className="p-3 bg-slate-50 dark:bg-black/20 border border-slate-100 dark:border-slate-800 rounded-xl">
                      <span className="text-[10px] text-slate-400 font-medium block uppercase tracking-wider">Nomes Técnicos Sujos</span>
                      <span className={`text-lg font-bold block mt-1 ${report.dirtyBankNames > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                        {report.dirtyBankNames}
                      </span>
                    </div>
                  </div>

                  {hasIssues ? (
                    <div className="p-4 bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/60 rounded-xl text-slate-705 dark:text-slate-300 space-y-3">
                      <div className="flex gap-2.5 items-start">
                        <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <p className="font-bold text-xs text-slate-800 dark:text-slate-200">Inconsistências Identificadas!</p>
                          <p className="text-[11px] leading-relaxed text-slate-605 text-slate-400">
                            Encontramos lançamentos no histórico que estão com direção financeira contrária (por exemplo, compras de cartão de crédito marcadas como Receita) ou com nomes de instituições sujos (por exemplo, como 'MEU PUGGLY - NU PAGAMENTOS').
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleReprocessAllTransactions}
                        disabled={isReprocessing}
                        className="w-full h-10 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-xs rounded-lg flex items-center justify-center gap-2 cursor-pointer shadow-xs transition-colors"
                      >
                        {isReprocessing ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin text-white" />
                            <span>Saneando e atualizando lote...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>Sanear e Reclassificar Histórico de Transações</span>
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className="p-4 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 rounded-xl text-slate-600 dark:text-slate-300">
                      <div className="flex gap-2.5 items-center">
                        <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
                        <div>
                          <p className="font-bold text-xs text-slate-850 dark:text-slate-200">Sinalização 100% Segura e Normalizada</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-sans">Nenhuma divergência de dados ou classificação foi identificada nos registros importados por Pluggy.</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </AdvancedAccordion>
      </div>

      {/* GLOBAL CONFIRMATION MODAL OVERLAY (Pure React custom confirm panel - never blocks container frame) */}
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
                <div className={`p-2.5 rounded-xl ${confirmModal.actionType === 'danger' ? 'bg-rose-50 text-rose-500 dark:bg-rose-950/20' : 'bg-emerald-50 text-emerald-500 dark:bg-emerald-950/20'} shrink-0`}>
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200">{confirmModal.title}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-sans">{confirmModal.description}</p>
                </div>
              </div>

              <div className="flex gap-2.5 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmModal(null)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-xs rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
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
