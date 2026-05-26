import React, { useState, useRef } from 'react';
import { User, signOut, sendPasswordResetEmail, updateProfile } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { UserProfile, Transaction } from '../App';
import { doc, updateDoc, serverTimestamp, collection, setDoc, deleteDoc } from 'firebase/firestore';
import { User as UserIcon, Bell, LogOut, Info, CloudCog, Download, UploadCloud, Trash2, Loader2, Database, Palette, CheckCircle2, ChevronLeft, ChevronRight, Key, RefreshCw, Radio, CreditCard, Link } from 'lucide-react';
import { toast } from 'sonner';

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

interface SettingsViewProps {
  user: User;
  profile: UserProfile;
  transactions: Transaction[];
}

export const SettingsView = React.memo(function SettingsView({ user, profile, transactions }: SettingsViewProps) {
  const [activePanel, setActivePanel] = useState<'perfil' | 'notif' | 'ia' | 'aparencia' | 'pluggy'>('perfil');
  const [isMobileMenu, setIsMobileMenu] = useState(true);

  const [displayName, setDisplayName] = useState(user.displayName || '');
  const [photoURL, setPhotoURL] = useState(user.photoURL || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');

  // Estados de Integração Pluggy
  const [pluggyClientId, setPluggyClientId] = useState(profile.pluggyClientId || '');
  const [pluggyClientSecret, setPluggyClientSecret] = useState(profile.pluggyClientSecret || '');
  const [isSavingPluggy, setIsSavingPluggy] = useState(false);
  const [isTestingPluggy, setIsTestingPluggy] = useState(false);
  const [isSyncingPluggy, setIsSyncingPluggy] = useState(false);
  const [isCreatingSandbox, setIsCreatingSandbox] = useState(false);
  const [pluggySyncStep, setPluggySyncStep] = useState('');
  const [pluggyItems, setPluggyItems] = useState<any[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [diagnoseSteps, setDiagnoseSteps] = useState<any[] | null>(null);
  const [diagnoseLogs, setDiagnoseLogs] = useState<string[]>([]);

  // Estados dos Webhooks Pluggy
  const [pluggyWebhooks, setPluggyWebhooks] = useState<any[]>([]);
  const [isLoadingWebhooks, setIsLoadingWebhooks] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [isRegisteringWebhook, setIsRegisteringWebhook] = useState(false);
  const [capturedEvents, setCapturedEvents] = useState<any[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);

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

  const handleSavePluggyKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingPluggy(true);
    const cleanId = pluggyClientId.trim();
    const cleanSecret = pluggyClientSecret.trim();
    try {
      const ref = doc(db, 'users', user.uid);
      await updateDoc(ref, {
        pluggyClientId: cleanId,
        pluggyClientSecret: cleanSecret,
        updatedAt: serverTimestamp()
      });
      setPluggyClientId(cleanId);
      setPluggyClientSecret(cleanSecret);
      toast.success('Chaves do Pluggy integradas com sucesso!');
    } catch (err) {
      console.error(err);
      toast.error('Erro ao registrar suas credenciais.');
    } finally {
      setIsSavingPluggy(false);
    }
  };

  const handleTestPluggyKeys = async () => {
    if (!pluggyClientId || !pluggyClientSecret) {
      toast.error('Informe o Client ID e Client Secret antes de realizar o teste.');
      return;
    }
    setIsTestingPluggy(true);
    setDiagnoseSteps([
      { name: "Verificação de Parâmetros", status: "RUNNING", details: "Lendo campos..." },
      { name: "Handshake de Autenticação", status: "PENDING", details: "Aguardando..." },
      { name: "Mapeamento de Workspace", status: "PENDING", details: "Aguardando..." }
    ]);
    setDiagnoseLogs(["[Preflight] Iniciando checagem detalhada de rotas..."]);
    
    try {
      const res = await fetch('/api/pluggy/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: pluggyClientId, clientSecret: pluggyClientSecret })
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

  const handleCreateSandbox = async () => {
    if (!pluggyClientId || !pluggyClientSecret) {
      toast.error('Por favor, informe e salve as credenciais do Pluggy primeiro.');
      return;
    }
    setIsCreatingSandbox(true);
    try {
      const res = await fetch('/api/pluggy/create_sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: pluggyClientId, clientSecret: pluggyClientSecret, bankConnectorId: 2 })
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
        toast.success('Banco de testes (Itaú Sandbox) adicionado na sua conta Pluggy!');
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

  const handleSyncPluggyTransactions = async () => {
    if (!pluggyClientId || !pluggyClientSecret) {
      toast.error('Chaves do Pluggy não detectadas ou incompletas.');
      return;
    }
    setIsSyncingPluggy(true);
    setPluggySyncStep('Iniciando handshake seguro com a API do Pluggy...');
    try {
      const res = await fetch('/api/pluggy/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: pluggyClientId,
          clientSecret: pluggyClientSecret,
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
        toast.success('Balanço atualizado! Nenhuma nova movimentação encontrada.');
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
        setPluggySyncStep(`Concluído: ${skippedCount} entradas descartadas por duplicidade.`);
        toast.success(`Tudo atualizado! Todas as novas transações já estavam cadastradas.`);
        return;
      }

      setPluggySyncStep(`Análise com IA concluída. Gravando ${filterToInsert.length} novas transações no Firestore...`);

      const colRef = collection(db, 'transactions');
      const catsAdicionadas = new Set<string>();

      for (const itemToSave of filterToInsert) {
        if (itemToSave.cat) {
          catsAdicionadas.add(itemToSave.cat.trim());
        }
        const documentReference = doc(colRef);
        await setDoc(documentReference, {
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
        });
      }

      if (catsAdicionadas.size > 0 && profile.userId) {
        const activeCategories = profile.categories || [
          'Alimentação', 'Transporte', 'Lazer', 'Saúde', 
          'Educação', 'Moradia', 'Salário', 'Investimentos'
        ];
        let changed = false;
        const freshArray = [...activeCategories];
        catsAdicionadas.forEach(c => {
          if (c && !freshArray.includes(c)) {
            freshArray.push(c);
            changed = true;
          }
        });

        if (changed) {
          await updateDoc(doc(db, 'users', profile.userId), {
            categories: freshArray,
            updatedAt: serverTimestamp()
          });
        }
      }

      setPluggySyncStep(`Importação concluída. ${filterToInsert.length} transações adicionadas e categorizadas com IA.`);
      toast.success(`${filterToInsert.length} novas transações importadas e categorizadas com sucesso!`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Houve uma falha na sincronização.');
      setPluggySyncStep('Ocorreu um erro inesperado na sincronização.');
    } finally {
      setIsSyncingPluggy(false);
    }
  };

  const loadPluggyItems = async () => {
    if (!pluggyClientId || !pluggyClientSecret) return;
    setIsLoadingItems(true);
    try {
      const res = await fetch('/api/pluggy/list_items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: pluggyClientId, clientSecret: pluggyClientSecret })
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
    if (!window.confirm('Tem certeza que deseja remover esta conexão bancária da sua conta Pluggy? Esta ação removerá o consentimento.')) {
      return;
    }
    try {
      const res = await fetch('/api/pluggy/delete_item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: pluggyClientId,
          clientSecret: pluggyClientSecret,
          itemId
        })
      });
      const data = await safeJsonClient(res);
      if (res.ok && data.success) {
        toast.success(data.message || 'Conexão deletada com sucesso!');
        // Remover localmente também
        const updatedItemIds = (profile.pluggyItemIds || []).filter((id: string) => id !== itemId);
        await updateDoc(doc(db, 'users', user.uid), {
          pluggyItemIds: updatedItemIds,
          updatedAt: serverTimestamp()
        });
        // Recarregar
        await loadPluggyItems();
      } else {
        toast.error(data.error || 'Erro ao remover conexão.');
      }
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao acionar a exclusão.');
    }
  };

  const loadPluggyWebhooks = async () => {
    if (!pluggyClientId || !pluggyClientSecret) return;
    setIsLoadingWebhooks(true);
    try {
      const res = await fetch('/api/pluggy/list_webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: pluggyClientId, clientSecret: pluggyClientSecret })
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
    if (!pluggyClientId || !pluggyClientSecret) {
      toast.error('Grave as chaves Pluggy Client ID e Secret antes de criar webhooks.');
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: pluggyClientId,
          clientSecret: pluggyClientSecret,
          event: 'item/updated',
          url: webhookUrl.trim()
        })
      });
      const data = await safeJsonClient(res);
      if (res.ok && data.success) {
        toast.success('Webhook registrado com sucesso no Pluggy!');
        await loadPluggyWebhooks(); // Recarregar
      } else {
        toast.error(data.error || 'Falha ao registrar webhook.');
      }
    } catch (err: any) {
      console.error(err);
      toast.error('Erro de requisição ao tentar registrar webhook.');
    } finally {
      setIsRegisteringWebhook(false);
    }
  };

  const handleDeleteWebhook = async (webhookId: string) => {
    if (!window.confirm('Tem certeza que deseja apagar o registro desse webhook no Pluggy?')) {
      return;
    }
    try {
      const res = await fetch('/api/pluggy/delete_webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: pluggyClientId,
          clientSecret: pluggyClientSecret,
          webhookId
        })
      });
      const data = await safeJsonClient(res);
      if (res.ok && data.success) {
        toast.success('Webhook excluído do Pluggy!');
        await loadPluggyWebhooks(); // Recarregar
      } else {
        toast.error(data.error || 'Falha ao remover webhook.');
      }
    } catch (err: any) {
      console.error(err);
      toast.error('Erro de requisição ao tentar excluir webhook.');
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

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      setWebhookUrl(window.location.origin + '/api/pluggy/webhook_listener');
    }
  }, []);

  React.useEffect(() => {
    if (activePanel === 'pluggy' && pluggyClientId && pluggyClientSecret) {
      loadPluggyItems();
      loadPluggyWebhooks();
      loadCapturedEvents();
    }
  }, [activePanel, pluggyClientId, pluggyClientSecret]);

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
              <span className="font-bold text-slate-800 text-[16px]">
                {activePanel === 'perfil' && 'Perfil / Conta'}
                {activePanel === 'aparencia' && 'Aparência'}
                {activePanel === 'notif' && 'Notificações'}
                {activePanel === 'ia' && 'Dados e Nuvem'}
                {activePanel === 'pluggy' && 'API Privada Pluggy'}
              </span>
            </>
          )}
        </div>
        <h1 className="hidden md:block text-lg font-bold text-slate-800 dark:text-slate-100">Preferências</h1>
      </header>
      
      <div className={`flex-1 p-4 md:p-8 w-full sm:pb-8 flex flex-col ${isMobileMenu ? 'overflow-hidden pb-20' : 'overflow-y-auto pb-24'}`}>
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-0 md:gap-8 flex-1 w-full relative">
          <aside className={`w-full md:w-64 flex-shrink-0 flex-col gap-2.5 md:gap-2 pb-2 md:pb-0 h-full ${isMobileMenu ? 'flex' : 'hidden md:flex'}`}>
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
              onClick={() => { setActivePanel('ia'); setIsMobileMenu(false); }}
              className={`w-full text-left px-4 py-3.5 md:px-4 md:py-2.5 text-sm md:font-bold rounded-2xl md:rounded-lg transition-all flex items-center shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] md:shadow-none border border-slate-100 md:border-transparent ${activePanel === 'ia' ? 'bg-emerald-50/50 md:bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border-emerald-100/50' : 'bg-white md:bg-transparent text-slate-700 md:text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'} active:scale-[0.98]`}>
              <div className="md:hidden p-2 rounded-xl bg-slate-50 text-slate-500 mr-3"><Database className="w-4 h-4" /></div>
              <Database className="hidden md:block w-4 h-4 mr-2 opacity-70" /> 
              <span className="font-bold text-[14px] md:text-sm">Dados e Nuvem</span>
              <ChevronRight className="md:hidden w-4 h-4 ml-auto text-slate-300" />
            </button>
            <button 
              onClick={() => { setActivePanel('pluggy'); setIsMobileMenu(false); }}
              className={`w-full text-left px-4 py-3.5 md:px-4 md:py-2.5 text-sm md:font-bold rounded-2xl md:rounded-lg transition-all flex items-center shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] md:shadow-none border border-slate-100 md:border-transparent ${activePanel === 'pluggy' ? 'bg-emerald-50/50 md:bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border-emerald-100/50' : 'bg-white md:bg-transparent text-slate-700 md:text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'} active:scale-[0.98]`}>
              <div className="md:hidden p-2 rounded-xl bg-slate-50 text-slate-500 mr-3"><CreditCard className="w-4 h-4" /></div>
              <CreditCard className="hidden md:block w-4 h-4 mr-2 opacity-70" /> 
              <span className="font-bold text-[14px] md:text-sm">API Privada Pluggy</span>
              <ChevronRight className="md:hidden w-4 h-4 ml-auto text-slate-300" />
            </button>
            <div className="hidden md:block border-t border-slate-200 dark:border-slate-700 my-4"></div>
            <button 
              onClick={handleLogout}
              className="mt-auto md:mt-0 w-full text-left px-4 py-3.5 md:px-4 md:py-2.5 text-sm md:font-bold rounded-2xl md:rounded-lg transition-all flex items-center shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] md:shadow-none border border-rose-100 md:border-transparent bg-rose-50 md:bg-transparent text-rose-600 dark:text-rose-400 hover:bg-rose-100 md:hover:bg-rose-50 dark:hover:bg-rose-900/30 active:scale-[0.98]">
              <div className="md:hidden p-2 rounded-xl bg-white text-rose-500 mr-3"><LogOut className="w-4 h-4" /></div>
              <LogOut className="hidden md:block w-4 h-4 mr-2 opacity-70" /> 
              <span className="font-bold text-[14px] md:text-sm">Sair da Conta</span>
              <ChevronRight className="md:hidden w-4 h-4 ml-auto text-rose-300" />
            </button>
          </aside>
          
          <main className={`flex-1 bg-white md:dark:bg-slate-800 rounded-none md:rounded-xl md:border border-slate-200 dark:border-slate-700 md:shadow-sm md:p-8 pb-32 sm:pb-8 ${!isMobileMenu ? 'flex flex-col relative' : 'hidden md:flex flex-col'}`}>
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
                    <p className="text-[13px] md:text-xs text-slate-500 dark:text-slate-400 mt-1.5 md:mt-1 leading-relaxed">Altera o tema visual da aplicação para modo noturno.</p>
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
            
            {activePanel === 'ia' && (
              <div className="space-y-6 pb-6">
                <h2 className="text-sm font-bold text-slate-800 uppercase tracking-widest border-b border-slate-100 pb-2 hidden md:block">Governança e Nuvem</h2>
                
                <div className="bg-emerald-50 border border-emerald-100 md:border-emerald-200 rounded-xl md:rounded-lg p-5 flex flex-col sm:flex-row sm:items-start gap-4 shadow-sm md:shadow-none">
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

            {activePanel === 'pluggy' && (
              <div className="space-y-6">
                <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 uppercase tracking-widest border-b border-slate-100 dark:border-slate-700 pb-2 hidden md:block">API Privada do Pluggy</h2>

                <div className="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 dark:from-emerald-950/20 dark:to-teal-950/20 p-5 rounded-2xl border border-emerald-500/20 shadow-sm">
                  <div className="flex gap-4">
                    <div className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 p-3 rounded-2xl h-fit">
                      <Radio className="w-6 h-6 animate-pulse" />
                    </div>
                    <div>
                      <h3 className="font-bold text-[16px] text-slate-900 dark:text-slate-100 mb-1">Automatização Bancária com IA</h3>
                      <p className="text-[13px] text-slate-600 dark:text-slate-400 leading-relaxed">
                        Integre suas contas bancárias reais através da <strong>Pluggy</strong>. Nossa Inteligência Artificial do Gemini lê suas transações automaticamente, higieniza as descrições em nomes curtos e amigáveis, e realiza a classificação precisa de categoria (Alimentação, Transporte, Salário, etc) e tipo (Entrada/Saída).
                      </p>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleSavePluggyKeys} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">Pluggy Client ID</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                          <Key className="h-4.5 w-4.5 text-slate-400" />
                        </div>
                        <input
                          type="text"
                          value={pluggyClientId}
                          onChange={(e) => setPluggyClientId(e.target.value)}
                          placeholder="Ex: 5e64ac32-f32a..."
                          className="w-full bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:outline-none transition-all font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">Pluggy Client Secret</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                          <Key className="h-4.5 w-4.5 text-slate-400" />
                        </div>
                        <input
                          type="password"
                          value={pluggyClientSecret}
                          onChange={(e) => setPluggyClientSecret(e.target.value)}
                          placeholder="••••••••••••••••••••"
                          className="w-full bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 focus:outline-none transition-all font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 pt-2">
                    <button
                      type="submit"
                      disabled={isSavingPluggy}
                      className="flex-1 py-3 bg-slate-800 hover:bg-slate-900 dark:bg-emerald-600 dark:hover:bg-emerald-700 text-white font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98]"
                    >
                      {isSavingPluggy ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Salvar Chaves'}
                    </button>
                    <button
                      type="button"
                      onClick={handleTestPluggyKeys}
                      disabled={isTestingPluggy}
                      className="px-5 py-3 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold hover:bg-slate-50 dark:hover:bg-slate-800 text-sm rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98]"
                    >
                      {isTestingPluggy ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        'Testar Conexão'
                      )}
                    </button>
                  </div>
                </form>

                {/* Visual live diagnostics checker output */}
                {diagnoseSteps && (
                  <div className="bg-slate-900 border border-slate-800 text-slate-100 p-5 rounded-2xl space-y-4 shadow-xl">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                        <h4 className="font-bold text-[10px] uppercase tracking-wider text-slate-400">Console de Diagnóstico de Integração</h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setDiagnoseSteps(null); setDiagnoseLogs([]); }}
                        className="text-[10px] text-slate-400 hover:text-white underline"
                      >
                        Limpar Diagnóstico
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {diagnoseSteps.map((step, idx) => {
                        const colors: Record<string, string> = {
                          PENDING: 'border-slate-805 bg-slate-950/20 text-slate-500',
                          RUNNING: 'border-blue-500/30 bg-blue-950/10 text-blue-400',
                          COMPLETED: 'border-emerald-500/30 bg-emerald-950/20 text-emerald-400',
                          FAILED: 'border-rose-500/30 bg-rose-950/25 text-rose-400'
                        };

                        return (
                          <div key={idx} className={`p-3 rounded-xl border ${colors[step.status] || colors.PENDING} space-y-1`}>
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold">{step.name}</span>
                              {step.status === 'RUNNING' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              {step.status === 'COMPLETED' && <span className="text-[9px] bg-emerald-500/20 px-1.5 py-0.5 rounded text-emerald-300 font-mono">OK</span>}
                              {step.status === 'FAILED' && <span className="text-[9px] bg-rose-500/20 px-1.5 py-0.5 rounded text-rose-300 font-mono">FALHOU</span>}
                              {step.status === 'PENDING' && <span className="text-[9px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400 font-mono">AGUARDA</span>}
                            </div>
                            <p className="text-[10px] leading-relaxed opacity-85">{step.details}</p>
                          </div>
                        );
                      })}
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-[10px] uppercase font-bold text-slate-500">Logs de comunicação:</div>
                      <div className="bg-black/95 border border-slate-800 p-3 rounded-xl max-h-40 overflow-y-auto font-mono text-[10px] text-slate-350 space-y-1 scrollbar-thin">
                        {diagnoseLogs.map((log, lIdx) => {
                          const isErr = log.includes('[ERRO]') || log.includes('error') || log.includes('FALHOU') || log.includes('Falha');
                          const isSuccess = log.includes('[Sucesso]') || log.includes('AUTENTICAÇÃO') || log.includes('completada') || log.includes('concluída');
                          const lineClass = isErr ? 'text-rose-400' : isSuccess ? 'text-emerald-400' : 'text-slate-300';
                          return <div key={lIdx} className={lineClass}>{log}</div>;
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Gerenciador de Conexões */}
                <div className="border border-slate-100 dark:border-slate-700/60 my-6"></div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-[15px] text-slate-800 dark:text-slate-200 flex items-center">
                      <Database className="w-5 h-5 mr-2 text-emerald-600 dark:text-emerald-400" />
                      Conexões de Contas Ativas ({pluggyItems.length})
                    </h3>
                    <button
                      type="button"
                      onClick={loadPluggyItems}
                      disabled={isLoadingItems || !pluggyClientId || !pluggyClientSecret}
                      className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 disabled:opacity-50"
                      title="Clique para recarregar as contas conectadas do Pluggy"
                    >
                      {isLoadingItems ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      Atualizar Lista
                    </button>
                  </div>

                  {!pluggyClientId || !pluggyClientSecret ? (
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-150 dark:border-slate-800 text-center text-xs text-slate-500">
                      Salve suas credenciais (Client ID e Secret) acima para visualizar suas conexões ativas.
                    </div>
                  ) : isLoadingItems ? (
                    <div className="flex items-center justify-center py-6 text-slate-400 text-xs">
                      <Loader2 className="w-5 h-5 animate-spin mr-2 text-emerald-500" />
                      Carregando conexões do Pluggy...
                    </div>
                  ) : pluggyItems.length === 0 ? (
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-150 dark:border-slate-800 text-center text-xs text-slate-500 space-y-2">
                      <p className="font-bold text-slate-600 dark:text-slate-400">Nenhuma conexão ativa encontrada.</p>
                      <p className="px-2 leading-relaxed text-[11px]">
                        Conecte suas contas reais sincronizando no seu painel de controle da <strong>Pluggy</strong> para que apareçam listadas aqui automaticamente!
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {pluggyItems.map((item) => {
                        const provider = item.connector || {};
                        const statusColors: any = {
                          UPDATED: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800/40',
                          UPDATING: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800/40',
                          OUTDATED: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800/40',
                          LOGIN_ERROR: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800/40',
                        };
                        const statusLabel: any = {
                          UPDATED: 'Sincronizado',
                          UPDATING: 'Atualizando...',
                          OUTDATED: 'Desatualizado',
                          LOGIN_ERROR: 'Erro de Login',
                        };
                        return (
                          <div key={item.id} className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between gap-4 shadow-sm">
                            <div className="flex items-center gap-3">
                              {provider.imageUrl ? (
                                <img src={provider.imageUrl} alt={provider.name} className="w-8 h-8 object-contain rounded-lg bg-slate-50 dark:bg-slate-800 p-1 border border-slate-100 dark:border-slate-800" referrerPolicy="no-referrer" />
                              ) : (
                                <div className="w-8 h-8 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center font-bold text-slate-500 text-xs text-[10px]">
                                  {provider.name?.[0] || 'B'}
                                </div>
                              )}
                              <div className="min-w-0">
                                <h4 className="font-bold text-xs text-slate-800 dark:text-slate-200 truncate">{provider.name}</h4>
                                <p className="text-[9px] text-slate-400 font-mono leading-none mt-0.5 truncate max-w-[150px] sm:max-w-[250px]">ID: {item.id}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold border ${statusColors[item.status] || 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'}`}>
                                {statusLabel[item.status] || item.status}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleDeletePluggyItem(item.id)}
                                className="p-1.5 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors"
                                title="Excluir Conexão"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="border border-slate-100 dark:border-slate-700/60 my-6"></div>

                <div className="space-y-4">
                  <h3 className="font-bold text-[15px] text-slate-800 dark:text-slate-200 flex items-center">
                    <RefreshCw className="w-5 h-5 mr-2 text-emerald-600 dark:text-emerald-400 animate-spin-slow" />
                    Sincronizar e Executar IA
                  </h3>

                  <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Sincronize as transações de todas as contas vinculadas do Pluggy nos últimos 30 dias. A IA fará a higienização de cada movimentação automaticamente.
                  </p>

                  {pluggySyncStep && (
                    <div className="bg-slate-50 dark:bg-slate-900/80 p-4 rounded-xl text-xs font-mono border border-slate-150 dark:border-slate-850 text-emerald-700 dark:text-emerald-400 flex items-center leading-relaxed">
                      {isSyncingPluggy && <Loader2 className="w-4 h-4 mr-2.5 animate-spin" />}
                      <span>{pluggySyncStep}</span>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      type="button"
                      onClick={handleSyncPluggyTransactions}
                      disabled={isSyncingPluggy || !pluggyClientId || !pluggyClientSecret}
                      className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-2xl shadow-md shadow-emerald-600/10 hover:shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
                    >
                      {isSyncingPluggy ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span>Sincronizando...</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-5 h-5" />
                          <span>Sincronizar Contas Bancárias agora</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* --- SEÇÃO GERENCIADORA DE WEBHOOKS COMPLETA --- */}
                <div className="border border-slate-100 dark:border-slate-700/60 my-6"></div>

                <div className="space-y-6">
                  <div className="bg-gradient-to-br from-indigo-500/10 to-blue-500/10 dark:from-indigo-950/20 dark:to-blue-950/20 p-5 rounded-2xl border border-indigo-500/20 shadow-sm space-y-3">
                    <div className="flex gap-4">
                      <div className="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 p-3 rounded-2xl h-fit">
                        <Radio className="w-6 h-6 animate-pulse" />
                      </div>
                      <div>
                        <h3 className="font-bold text-[16px] text-slate-900 dark:text-slate-100 mb-1">Tecnologia Pluggy Webhooks ao Vivo</h3>
                        <p className="text-[13px] text-slate-600 dark:text-slate-400 leading-relaxed">
                          Webhooks são <strong>notificações em tempo real</strong> disparadas pela Pluggy diretamente para o nosso servidor sempre que os status de uma conta ou transação bancária forem modificados (Ex: Conectando, Atualizando, Finalizado). Com os webhooks habilitados, sua base de dados é sincronizada automaticamente em background sem precisar que o usuário recarregue a página manualmente!
                        </p>
                      </div>
                    </div>
                  </div>

                  <form onSubmit={handleRegisterWebhook} className="space-y-4">
                    <h4 className="font-bold text-sm text-slate-800 dark:text-slate-200 flex items-center">
                      <Link className="w-4 h-4 mr-2 text-indigo-500" />
                      Cadastrar novo Webhook Automático
                    </h4>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="md:col-span-2">
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wider">URL do Listener de Eventos (HTTPS obrigatório)</label>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <span className="text-[11px] text-slate-400 font-bold uppercase">URL</span>
                          </div>
                          <input
                            type="url"
                            value={webhookUrl}
                            onChange={(e) => setWebhookUrl(e.target.value)}
                            placeholder="https://sua-url-do-servidor.app/api/pluggy/webhook_listener"
                            className="w-full bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-850 rounded-xl pl-12 pr-4 py-3 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-all font-mono"
                          />
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1 leading-normal">
                          Configurado automaticamente com o endereço HTTPS seguro do seu ambiente de visualização atual.
                        </p>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wider">Gatilho / Evento</label>
                        <select
                          disabled
                          className="w-full bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-850 rounded-xl px-3.5 py-3 text-xs focus:outline-none cursor-not-allowed font-medium font-mono"
                        >
                          <option value="item/updated">item/updated</option>
                        </select>
                        <p className="text-[10px] text-slate-400 mt-1 leading-normal">
                          Acionado quando mudanças cadastrais ocorrem.
                        </p>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={isRegisteringWebhook || !pluggyClientId || !pluggyClientSecret}
                      className="w-full sm:w-auto px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-45 disabled:cursor-not-allowed active:scale-[0.98]"
                    >
                      {isRegisteringWebhook ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Obtendo autorização e gravando...</span>
                        </>
                      ) : (
                        <>
                          <Link className="w-4 h-4" />
                          <span>Habilitar Webhook na Conta da Pluggy</span>
                        </>
                      )}
                    </button>
                  </form>

                  {/* Lista de Webhooks Ativos */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                      <h4 className="font-bold text-xs uppercase tracking-widest text-slate-500">Meus Canais de Webhook Habilitados</h4>
                      <button
                        type="button"
                        onClick={loadPluggyWebhooks}
                        disabled={isLoadingWebhooks || !pluggyClientId || !pluggyClientSecret}
                        className="text-[11px] font-bold text-indigo-600 hover:indigo-700 flex items-center gap-1 disabled:opacity-50"
                      >
                        {isLoadingWebhooks ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        Sincronizar Canais
                      </button>
                    </div>

                    {!pluggyClientId || !pluggyClientSecret ? (
                      <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 text-center text-[11px] text-slate-500">
                        Insira e salve as chaves API acima para obter a relação de canais ativos.
                      </div>
                    ) : isLoadingWebhooks ? (
                      <div className="text-center py-4 text-xs text-slate-400 flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-indigo-500" /> Carregando canais ativos do Pluggy...
                      </div>
                    ) : pluggyWebhooks.length === 0 ? (
                      <div className="p-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500">
                        Nenhum webhook registrado nesta conta da Pluggy para estes canais. Use o botão acima para criar o seu primeiro!
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {pluggyWebhooks.map((wh) => (
                          <div key={wh.id} className="p-3 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800/80 rounded-xl flex items-center justify-between gap-4 shadow-sm font-mono text-xs">
                            <div className="min-w-0 space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-400 text-[10px] px-1.5 py-0.5 rounded font-bold">{wh.event}</span>
                                <span className="text-[10px] text-slate-400 font-mono">ID: {wh.id}</span>
                              </div>
                              <p className="text-[11px] text-slate-650 dark:text-slate-350 truncate">{wh.url}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteWebhook(wh.id)}
                              className="p-1.5 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors flex-shrink-0"
                              title="Cancelar Webhook"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Logs de Eventos de Teste Recebidos */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        <h4 className="font-bold text-xs uppercase tracking-widest text-slate-500">Painel Auditor de Eventos Recebidos (Logs)</h4>
                      </div>
                      <button
                        type="button"
                        onClick={loadCapturedEvents}
                        disabled={isLoadingEvents}
                        className="text-[11px] font-bold text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 flex items-center gap-1 disabled:opacity-50"
                      >
                        {isLoadingEvents ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        Atualizar Logs
                      </button>
                    </div>

                    {capturedEvents.length === 0 ? (
                      <div className="p-5 rounded-xl border border-dashed border-slate-200 dark:border-slate-850 bg-slate-50/20 text-center text-xs text-slate-500 space-y-1">
                        <p className="font-bold text-slate-600 dark:text-slate-400">Nenhum evento capturado até o momento.</p>
                        <p className="text-[11px]">Quando Pluggy chamar o webhook, os payloads aparecerão listados aqui em tempo real!</p>
                      </div>
                    ) : (
                      <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                        {capturedEvents.map((evt) => {
                          const dateObj = new Date(evt.receivedAt);
                          const formattedDate = dateObj.toLocaleDateString('pt-BR') + ' às ' + dateObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                          return (
                            <div key={evt.id} className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2 shadow-sm">
                              <div className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                                  <span className="font-bold text-[11px] font-mono text-slate-800 dark:text-slate-200 uppercase">{evt.event}</span>
                                </div>
                                <span className="text-[10px] text-slate-400 font-mono">{formattedDate}</span>
                              </div>

                              <div className="grid grid-cols-2 gap-3 text-[10px] font-mono bg-slate-50 dark:bg-slate-950 p-2 rounded-lg border border-slate-100 dark:border-slate-900">
                                <div>
                                  <span className="text-neutral-400 block mb-0.5">Item ID afetado:</span>
                                  <span className="text-slate-700 dark:text-slate-300 font-bold truncate block">{evt.itemId}</span>
                                </div>
                                <div>
                                  <span className="text-neutral-400 block mb-0.5">Novo Status:</span>
                                  <span className="text-emerald-600 font-bold uppercase">{evt.status}</span>
                                </div>
                              </div>

                              <details className="text-[9px] font-mono">
                                <summary className="cursor-pointer text-slate-450 hover:text-slate-700 focus:outline-none py-1 select-none">Ver Payload JSON Bruto</summary>
                                <pre className="bg-black text-slate-300 p-2.5 rounded-lg max-h-40 overflow-auto scrollbar-thin mt-1.5 leading-normal text-left">
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
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
});
