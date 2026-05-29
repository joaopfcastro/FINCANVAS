import React, { useState, useMemo, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { Transaction, AccountBalance } from '../App';
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  Scale, 
  Wallet,
  Search, 
  FileDown, 
  Sparkles, 
  Loader2, 
  Bot, 
  List, 
  X,
  Plus,
  Tag,
  CreditCard,
  DollarSign,
  Calendar,
  Filter,
  Edit3,
  Trash2,
  Settings2,
  Check,
  ToggleLeft,
  ToggleRight
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { secureGenerateContent, fetchAISettings } from '../lib/gemini';
import { format } from 'date-fns';
import { collection, addDoc, serverTimestamp, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { toast } from 'sonner';
import { AIConfirmationModal } from './AIConfirmationModal';
import { usePluggySync } from '../hooks/usePluggySync';

import { FilterConfig } from '../App';
import { PeriodFilterToolbar } from './PeriodFilterToolbar';
import { EmptyState } from './EmptyState';

import { PullToRefresh } from './PullToRefresh';

interface DashboardViewProps {
  transactions: Transaction[];
  loadingTransactions?: boolean;
  filterConfig: FilterConfig;
  setFilterConfig: (config: FilterConfig) => void;
  onNavigateImport: () => void;
  onOpenManualEntry: () => void;
  onEditTransaction: (transaction: Transaction) => void;
  accountBalances: AccountBalance[];
  user: any;
  profile: any;
  learnedRules?: any[];
}




export const DashboardView = React.memo(function DashboardView({ 
  transactions, 
  loadingTransactions, 
  filterConfig, 
  setFilterConfig, 
  onNavigateImport, 
  onOpenManualEntry, 
  onEditTransaction,
  accountBalances,
  user,
  profile,
  learnedRules = []
}: DashboardViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 10;
  
  const { syncPluggyNow, isSyncingPluggy, pluggySyncStep } = usePluggySync(
    user,
    profile,
    transactions,
    learnedRules
  );
  
  const [filterDate, setFilterDate] = useState('');
  const [filterDesc, setFilterDesc] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterAmountType, setFilterAmountType] = useState<'' | 'greater' | 'less' | 'equal'>('');
  const [filterAmount, setFilterAmount] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  
  const [aiLoading, setAiLoading] = useState(false);
  const [aiInsights, setAiInsights] = useState('');
  const [aiLoadingMessage, setAiLoadingMessage] = useState('Analisando seus dados com inteligência artificial...');
  const [modalAiLoadingMessage, setModalAiLoadingMessage] = useState('Gerando dica inteligente...');

  const [modalType, setModalType] = useState<string | null>(null);
  const [modalAiInsight, setModalAiInsight] = useState('');
  const [modalAiLoading, setModalAiLoading] = useState(false);

  const [aiSettings, setAiSettings] = useState<{ aiEnabled: boolean; aiUseForInsights: boolean } | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingAIAction, setPendingAIAction] = useState<'insights' | 'maiorDespesa' | null>(null);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await fetchAISettings();
        if (settings) {
          setAiSettings({
            aiEnabled: settings.aiEnabled,
            aiUseForInsights: settings.aiUseForInsights
          });
        }
      } catch (e) {
        console.error("Failed to load AI settings in DashboardView:", e);
      }
    };
    loadSettings();
  }, [transactions]); // Reload settings when transactions or views change to keep it extremely state-fresh

  const handleConfirmAI = async (dontAskAgain: boolean) => {
    setShowConfirmModal(false);
    if (dontAskAgain) {
      sessionStorage.setItem('ai_bypass_confirm_insight', 'true');
    }
    if (pendingAIAction === 'insights') {
      setPendingAIAction(null);
      await runGetInsights();
    } else if (pendingAIAction === 'maiorDespesa') {
      setPendingAIAction(null);
      await runMaiorDespesaInsight();
    }
  };

  const [modalSearchTerm, setModalSearchTerm] = useState('');
  const [modalFilterDate, setModalFilterDate] = useState('');
  const [modalFilterCat, setModalFilterCat] = useState('');
  const [modalFilterAmountType, setModalFilterAmountType] = useState<'' | 'greater' | 'less' | 'equal'>('');
  const [modalFilterAmount, setModalFilterAmount] = useState('');
  
  const [showModalFiltersMobile, setShowModalFiltersMobile] = useState(false);
  const [showAddManualForm, setShowAddManualForm] = useState(false);
  const [manualAccountForm, setManualAccountForm] = useState({
    bankName: '',
    accountLabel: '',
    accountType: 'BANK',
    balance: '',
    number: '',
  });
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [dragY, setDragY] = useState(0);
  const startYRef = useRef(0);

  const { viewportHeight, offsetTop, isKeyboardOpen } = useVisualViewport();

  const handleTouchStart = (e: React.TouchEvent) => {
    startYRef.current = e.touches[0].clientY;
  };
  
  const handleTouchMove = (e: React.TouchEvent) => {
    const currentY = e.touches[0].clientY;
    const diff = currentY - startYRef.current;
    if (diff > 0) {
      setDragY(diff);
    }
  };
  
  const handleTouchEnd = () => {
    if (dragY > 120) {
      handleCloseModal();
    } else {
      setDragY(0);
    }
  };

  const handleCloseModal = () => {
    if (modalType) setModalType(null);
    setModalSearchTerm('');
    setModalFilterDate('');
    setModalFilterCat('');
    setModalFilterAmountType('');
    setModalFilterAmount('');
    setShowModalFiltersMobile(false);
    setShowAddManualForm(false);
    setEditingAccountId(null);
    setManualAccountForm({
      bankName: '',
      accountLabel: '',
      accountType: 'BANK',
      balance: '',
      number: '',
    });
    setTimeout(() => setDragY(0), 300);
  };

  const handleSaveManualAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualAccountForm.bankName || !manualAccountForm.accountLabel || manualAccountForm.balance === '') {
      toast.error('Por favor, preencha todos os campos obrigatórios (Instituição, Descrição e Saldo).');
      return;
    }

    const valueBalance = parseFloat(manualAccountForm.balance);
    if (isNaN(valueBalance)) {
      toast.error('O saldo deve ser um valor numérico válido.');
      return;
    }

    try {
      if (editingAccountId) {
        // Edit manual account
        const docRef = doc(db, 'accountBalances', editingAccountId);
        await updateDoc(docRef, {
          bankName: manualAccountForm.bankName.trim(),
          accountLabel: manualAccountForm.accountLabel.trim(),
          accountName: manualAccountForm.accountLabel.trim(),
          accountType: manualAccountForm.accountType,
          number: manualAccountForm.number.trim() || '',
          balance: valueBalance,
          updatedAt: serverTimestamp()
        });
        toast.success('Conta manual atualizada com sucesso!');
      } else {
        // Create new manual account
        const manualId = 'manual_' + Math.random().toString(36).substring(2, 15);
        const colRef = collection(db, 'accountBalances');
        await addDoc(colRef, {
          userId: auth.currentUser?.uid || '',
          provider: 'manual',
          accountId: manualId,
          bankName: manualAccountForm.bankName.trim(),
          accountName: manualAccountForm.accountLabel.trim(),
          accountLabel: manualAccountForm.accountLabel.trim(),
          accountType: manualAccountForm.accountType,
          number: manualAccountForm.number.trim() || '',
          balance: valueBalance,
          includeInSaldoTotal: true,
          includeReason: 'Conta manual',
          status: 'ACTIVE',
          lastSyncedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        toast.success('Conta manual adicionada com sucesso!');
      }

      // Reset form
      setManualAccountForm({
        bankName: '',
        accountLabel: '',
        accountType: 'BANK',
        balance: '',
        number: '',
      });
      setShowAddManualForm(false);
      setEditingAccountId(null);
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao salvar conta manual: ' + err.message);
    }
  };

  const handleDeleteManualAccount = async (accId: string) => {
    try {
      const docRef = doc(db, 'accountBalances', accId);
      await deleteDoc(docRef);
      toast.success('Conta manual excluída com sucesso!');
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao excluir conta manual: ' + err.message);
    }
  };

  const handleStartEditManual = (acc: AccountBalance) => {
    setEditingAccountId(acc.id || null);
    setManualAccountForm({
      bankName: acc.bankName,
      accountLabel: acc.accountLabel,
      accountType: acc.accountType,
      balance: acc.balance.toString(),
      number: acc.number || '',
    });
    setShowAddManualForm(true);
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDeleteConfirmMobile, setShowDeleteConfirmMobile] = useState<string | null>(null);
  const [deleteDragY, setDeleteDragY] = useState(0);
  const deleteStartYRef = useRef(0);

  const handleRefresh = async () => {
    await syncPluggyNow();
  };

  const handleDeleteTouchStart = (e: React.TouchEvent) => {
    deleteStartYRef.current = e.touches[0].clientY;
  };
  
  const handleDeleteTouchMove = (e: React.TouchEvent) => {
    const currentY = e.touches[0].clientY;
    const diff = currentY - deleteStartYRef.current;
    if (diff > 0) {
      setDeleteDragY(diff);
    }
  };
  
  const handleDeleteTouchEnd = () => {
    if (deleteDragY > 100) {
      setShowDeleteConfirmMobile(null);
      setDeletingId(null);
      setTimeout(() => setDeleteDragY(0), 300);
    } else {
      setDeleteDragY(0);
    }
  };

  const handleDelete = async (id: string | undefined) => {
    if (!id) {
      console.error('Tentativa de excluir transação sem ID');
      return;
    }
    
    try {
      await deleteDoc(doc(db, 'transactions', id));
      toast.success('Transação excluída com sucesso!');
      handleCloseModal();
    } catch (e: any) {
      console.error('Erro ao excluir:', e);
      toast.error('Erro ao excluir transação.');
    }
    setDeletingId(null);
  };

  const currentMonthTransactions = useMemo(() => {
    return transactions.filter(t => {
      try {
        const parts = t.date.split('/');
        if (parts.length < 3) return false;
        const d = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const y = parseInt(parts[2], 10);

        if (filterConfig.type === 'all') return true;

        if (filterConfig.type === 'year') {
          return y === filterConfig.year;
        }

        if (filterConfig.type === 'custom') {
          const tDate = new Date(y, m - 1, d);
          if (filterConfig.startDate) {
            const startStr = filterConfig.startDate.split('-');
            const sDate = new Date(parseInt(startStr[0]), parseInt(startStr[1], 10) - 1, parseInt(startStr[2]));
            if (tDate < sDate) return false;
          }
          if (filterConfig.endDate) {
            const endStr = filterConfig.endDate.split('-');
            const eDate = new Date(parseInt(endStr[0]), parseInt(endStr[1], 10) - 1, parseInt(endStr[2], 10), 23, 59, 59);
            if (tDate > eDate) return false;
          }
          return true;
        }

        return m === filterConfig.month && y === filterConfig.year;
      } catch (e) {
        return false;
      }
    });
  }, [transactions, filterConfig]);

  const handleDateMask = (value: string) => {
    let val = value.replace(/\D/g, '');
    if (val.length > 8) val = val.substring(0, 8);
    if (val.length >= 5) return val.substring(0, 2) + '/' + val.substring(2, 4) + '/' + val.substring(4);
    if (val.length >= 3) return val.substring(0, 2) + '/' + val.substring(2);
    return val;
  };

  const handleCurrencyMask = (value: string) => {
    return value.replace(/[^\d.,]/g, '');
  };

  const inputRefs = {
    date: useRef<HTMLInputElement>(null),
    desc: useRef<HTMLInputElement>(null),
    cat: useRef<HTMLInputElement>(null),
    source: useRef<HTMLInputElement>(null)
  };

  const clearFilter = (setter: (v: string) => void, ref: React.RefObject<HTMLInputElement>) => {
    setter('');
    setCurrentPage(1);
    setTimeout(() => ref.current?.focus(), 0);
  };

  // Compute metrics
  const { totalReceitas, totalDespesas, maiorDespesa, saldoTotal, balancesBySource } = useMemo(() => {
    let tr = 0, td = 0;
    let md: Transaction | null = null;
    currentMonthTransactions.forEach(t => {
      if (t.type === 'Receita') tr += t.amount;
      else {
        td += Math.abs(t.amount);
        if (!md || Math.abs(t.amount) > Math.abs(md.amount)) {
          md = t;
        }
      }
    });
    let overallBalance = 0;
    const sourceMap: Record<string, number> = {};
    
    if (accountBalances && accountBalances.length > 0) {
      accountBalances.forEach(acc => {
        const src = acc.bankName || acc.accountLabel || 'Outros';
        sourceMap[src] = (sourceMap[src] || 0) + acc.balance;
        if (acc.includeInSaldoTotal) {
          overallBalance += acc.balance;
        }
      });
    }

    return { totalReceitas: tr, totalDespesas: td, maiorDespesa: md, saldoTotal: overallBalance, balancesBySource: sourceMap };
  }, [currentMonthTransactions, transactions, accountBalances]);

  const saldo = totalReceitas - totalDespesas;
  
  const formatMoeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  const filteredData = useMemo(() => {
    return currentMonthTransactions.filter(t => {
      const matchSearch = searchTerm === '' || 
                          t.desc.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          t.cat.toLowerCase().includes(searchTerm.toLowerCase());
      const matchType = typeFilter === 'all' || t.type === typeFilter;
      
      const matchDate = filterDate === '' || t.date.includes(filterDate);
      const matchDesc = filterDesc === '' || t.desc.toLowerCase().includes(filterDesc.toLowerCase());
      const matchCat = filterCat === '' || t.cat.toLowerCase().includes(filterCat.toLowerCase());
      const matchSource = filterSource === '' || t.source.toLowerCase().includes(filterSource.toLowerCase());

      let matchAmount = true;
      if (filterAmountType !== '' && filterAmount !== '') {
        const amountToCompare = Math.abs(t.amount);
        const val = parseFloat(filterAmount);
        if (!isNaN(val)) {
          if (filterAmountType === 'greater') matchAmount = amountToCompare > val;
          if (filterAmountType === 'less') matchAmount = amountToCompare < val;
          if (filterAmountType === 'equal') matchAmount = amountToCompare === val;
        }
      }

      return matchSearch && matchType && matchDate && matchDesc && matchCat && matchSource && matchAmount;
    }).sort((a, b) => b.createdAt - a.createdAt); // Descending by creation
  }, [currentMonthTransactions, searchTerm, typeFilter, filterDate, filterDesc, filterCat, filterSource, filterAmountType, filterAmount]);

  const totalPages = Math.ceil(filteredData.length / rowsPerPage);
  const currentData = filteredData.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(15, 23, 42); doc.text("FinCanvas - Relatório", 14, 25);
    doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor(100, 116, 139); doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}`, 14, 32);
    
    doc.setDrawColor(226, 232, 240); doc.setFillColor(248, 250, 252); doc.roundedRect(14, 40, 182, 60, 3, 3, 'FD');
    doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.setTextColor(22, 163, 74); doc.text("Total de Receitas:", 20, 55); doc.text(`+ ${formatMoeda(totalReceitas)}`, 140, 55);
    doc.setTextColor(220, 38, 38); doc.text("Total de Despesas:", 20, 65); doc.text(`- ${formatMoeda(totalDespesas)}`, 140, 65);
    doc.setTextColor(15, 23, 42); doc.text("Saldo do Período:", 20, 75); doc.setFontSize(14); doc.setTextColor(saldo >= 0 ? 22 : 220, saldo >= 0 ? 163 : 38, saldo >= 0 ? 74 : 38); doc.text(`${formatMoeda(saldo)}`, 140, 75);
    if (maiorDespesa) { doc.setFontSize(11); doc.setTextColor(234, 88, 12); doc.text(`Maior Despesa: ${maiorDespesa.desc} (${formatMoeda(Math.abs(maiorDespesa.amount))})`, 20, 90); }
    
    doc.addPage(); doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(22, 163, 74); doc.text("Detalhamento de Entradas", 14, 22);
    autoTable(doc, { startY: 30, head: [['Data', 'Descrição', 'Categoria', 'Valor (R$)', 'Origem']], body: currentMonthTransactions.filter(d => d.type === 'Receita').map(d => [d.date, d.desc, d.cat, formatMoeda(d.amount), d.source]), theme: 'grid', headStyles: { fillColor: [34, 197, 94], textColor: [255,255,255], fontStyle: 'bold' }});
    doc.addPage(); doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(220, 38, 38); doc.text("Detalhamento de Saídas", 14, 22);
    autoTable(doc, { startY: 30, head: [['Data', 'Descrição', 'Categoria', 'Valor (R$)', 'Origem']], body: currentMonthTransactions.filter(d => d.type === 'Despesa').map(d => [d.date, d.desc, d.cat, formatMoeda(Math.abs(d.amount)), d.source]), theme: 'grid', headStyles: { fillColor: [239, 68, 68], textColor: [255,255,255], fontStyle: 'bold' }});
    
    doc.save('FinCanvas_Relatorio.pdf');
  };

  const getTransactionsFingerprint = (txs: Transaction[]) => {
    return txs
      .map(t => `${t.id || ''}:${t.amount}:${t.desc}:${t.date}:${t.cat}:${t.source || ''}`)
      .join('|');
  };

  const getInsightsCacheKey = () => {
    const periodStr = `${filterConfig.type}_${filterConfig.month}_${filterConfig.year}_${filterConfig.startDate || ''}_${filterConfig.endDate || ''}`;
    return `fincanvas_ai_insights_${periodStr}`;
  };

  // Auto-sync cached insights when transactions or period changes
  useEffect(() => {
    const currentFingerprint = getTransactionsFingerprint(currentMonthTransactions);
    const cacheKey = getInsightsCacheKey();
    const cachedDataStr = localStorage.getItem(cacheKey);
    if (cachedDataStr) {
      try {
        const cached = JSON.parse(cachedDataStr);
        if (cached.fingerprint === currentFingerprint) {
          setAiInsights(cached.insights);
          return;
        }
      } catch (e) {
        console.error('Error pre-loading insights:', e);
      }
    }
    setAiInsights(''); // Reset to allow fresh generation
  }, [currentMonthTransactions, filterConfig]);

  const runGetInsights = async () => {
    if (currentMonthTransactions.length === 0) return;
    setAiLoading(true);
    setAiInsights('');
    
    const messages = [
      'Sincronizando seus dados financeiros...',
      'Analisando categorias e fluxo de caixa...',
      'Gerando recomendações financeiras...'
    ];
    
    let msgIndex = 0;
    setAiLoadingMessage(messages[0]);
    const messageInterval = setInterval(() => {
      msgIndex++;
      if (msgIndex < messages.length) {
        setAiLoadingMessage(messages[msgIndex]);
      }
    }, 450);

    const finishInsights = (content: string) => {
      clearInterval(messageInterval);
      setAiInsights(content);
      setModalType('insight');
      setAiLoading(false);
    };

    try {
      const currentFingerprint = getTransactionsFingerprint(currentMonthTransactions);
      const cacheKey = getInsightsCacheKey();
      const cachedDataStr = localStorage.getItem(cacheKey);

      if (cachedDataStr) {
        try {
          const cached = JSON.parse(cachedDataStr);
          if (cached.fingerprint === currentFingerprint) {
            // Simulated delay for cache to look live
            setTimeout(() => {
              finishInsights(cached.insights);
            }, 1800);
            return;
          }
        } catch (e) {
          console.error('Error reading cached insights:', e);
        }
      }

      const promptText = `Analise financeiramente (3 parágrafos curtos: o que está bom, alerta, dica) das transações deste período:\n${currentMonthTransactions.slice(0, 50).map(d => `${d.desc} | Cat: ${d.cat} | R$ ${d.amount}`).join('\n')}`;
      const response = await secureGenerateContent({
        task: 'insight',
        model: 'gemini-3.5-flash',
        contents: promptText,
        timeoutMs: 45000
      });
      
      const content = response.text || 'Nenhum insight retornado.';
      
      // Save to cache
      localStorage.setItem(cacheKey, JSON.stringify({
        fingerprint: currentFingerprint,
        insights: content
      }));

      setTimeout(() => {
        finishInsights(content);
      }, 500);

    } catch (e: any) {
      clearInterval(messageInterval);
      const isTimeout = e.message?.toLowerCase().includes('timeout') ||
                        e.message?.toLowerCase().includes('demorou') ||
                        e.message === 'AI_PROVIDER_TIMEOUT';
      const userFriendlyError = isTimeout
        ? 'A IA demorou mais que o esperado para responder. Tente novamente em alguns segundos ou reduza o período analisado.'
        : e.message;
      setAiInsights('Erro ao analisar os dados com IA: ' + userFriendlyError);
      setModalType('insight');
      setAiLoading(false);
    }
  };

  const getInsights = async () => {
    const settings = await fetchAISettings();
    if (!settings || !settings.aiEnabled || !settings.aiUseForInsights) {
      toast.error("Insights por IA desativados. Ative em Preferências > Inteligência Artificial.");
      return;
    }

    const bypass = sessionStorage.getItem('ai_bypass_confirm_insight') === 'true';
    const needsConfirm = (settings.aiAlwaysAskBeforeSending ?? true) && !bypass;

    if (needsConfirm) {
      setPendingAIAction('insights');
      setShowConfirmModal(true);
      return;
    }

    await runGetInsights();
  };

  const runMaiorDespesaInsight = async () => {
    if (!maiorDespesa) return;
    setModalAiLoading(true);
    setModalAiInsight('');

    const messages = [
      'Analisando despesa crítica...',
      'Processando categoria de gasto...',
      'Elaborando dica sobre economia...'
    ];

    let msgIndex = 0;
    setModalAiLoadingMessage(messages[0]);
    const messageInterval = setInterval(() => {
      msgIndex++;
      if (msgIndex < messages.length) {
        setModalAiLoadingMessage(messages[msgIndex]);
      }
    }, 300);

    const finishMaiorDespesa = (content: string) => {
      clearInterval(messageInterval);
      setModalAiInsight(content);
      setModalAiLoading(false);
    };

    try {
      const maiorDespesaFingerprint = `${maiorDespesa.id || ''}:${maiorDespesa.desc}:${maiorDespesa.amount}:${maiorDespesa.cat}`;
      const cacheKey = `fincanvas_maior_despesa_insight`;
      const cachedDataStr = localStorage.getItem(cacheKey);

      if (cachedDataStr) {
        try {
          const cached = JSON.parse(cachedDataStr);
          if (cached.fingerprint === maiorDespesaFingerprint) {
            // Simulated delay for cache to look live
            setTimeout(() => {
              finishMaiorDespesa(cached.insight);
            }, 1200);
            return;
          }
        } catch (e) {
          console.error('Error reading cached maior despesa insight:', e);
        }
      }

      const promptText = `Despesa Maior: ${maiorDespesa.desc} (${maiorDespesa.cat}) no valor de R$ ${Math.abs(maiorDespesa.amount).toFixed(2)}. Dê 1 dica curta e amigável sobre como repensar ou otimizar essa categoria de gasto em Português.`;
      const response = await secureGenerateContent({
        task: 'insight',
        model: 'gemini-3.5-flash',
        contents: promptText,
        timeoutMs: 45000
      });
      
      const content = response.text || 'Dica não disponível.';

      // Save to cache
      localStorage.setItem(cacheKey, JSON.stringify({
        fingerprint: maiorDespesaFingerprint,
        insight: content
      }));

      setTimeout(() => {
        finishMaiorDespesa(content);
      }, 400);

    } catch (e: any) {
      clearInterval(messageInterval);
      const isTimeout = e.message?.toLowerCase().includes('timeout') ||
                        e.message?.toLowerCase().includes('demorou') ||
                        e.message === 'AI_PROVIDER_TIMEOUT';
      const userFriendlyError = isTimeout
        ? 'A IA demorou mais que o esperado para responder. Tente novamente em alguns segundos ou reduza o período analisado.'
        : 'Falha ao gerar o insight.';
      setModalAiInsight(userFriendlyError);
      setModalAiLoading(false);
    }
  };

  const getMaiorDespesaInsight = async () => {
    const settings = await fetchAISettings();
    if (!settings || !settings.aiEnabled || !settings.aiUseForInsights) {
      toast.error("Insights por IA desativados. Ative em Preferências > Inteligência Artificial.");
      return;
    }

    const bypass = sessionStorage.getItem('ai_bypass_confirm_insight') === 'true';
    const needsConfirm = (settings.aiAlwaysAskBeforeSending ?? true) && !bypass;

    if (needsConfirm) {
      setPendingAIAction('maiorDespesa');
      setShowConfirmModal(true);
      return;
    }

    await runMaiorDespesaInsight();
  };

  const modalData = modalType === 'receitas' ? currentMonthTransactions.filter(t => t.type === 'Receita') :
                    modalType === 'despesas' ? currentMonthTransactions.filter(t => t.type === 'Despesa') :
                    modalType === 'saldo' ? currentMonthTransactions :
                    modalType === 'saldo-total' ? transactions : [];

  const filteredModalData = useMemo(() => {
    return modalData.filter(t => {
      const matchSearch = modalSearchTerm === '' || 
                          t.desc.toLowerCase().includes(modalSearchTerm.toLowerCase()) || 
                          t.cat.toLowerCase().includes(modalSearchTerm.toLowerCase());
      const matchDate = modalFilterDate === '' || t.date.includes(modalFilterDate);
      const matchCat = modalFilterCat === '' || t.cat.toLowerCase().includes(modalFilterCat.toLowerCase());
      
      let matchAmount = true;
      if (modalFilterAmountType !== '' && modalFilterAmount !== '') {
        const amountToCompare = Math.abs(t.amount);
        const val = parseFloat(modalFilterAmount);
        if (!isNaN(val)) {
          if (modalFilterAmountType === 'greater') matchAmount = amountToCompare > val;
          if (modalFilterAmountType === 'less') matchAmount = amountToCompare < val;
          if (modalFilterAmountType === 'equal') matchAmount = amountToCompare === val;
        }
      }

      return matchSearch && matchDate && matchCat && matchAmount;
    });
  }, [modalData, modalSearchTerm, modalFilterDate, modalFilterCat, modalFilterAmountType, modalFilterAmount]);

  const filteredBalancesBySource = useMemo(() => {
    if (!modalSearchTerm) return balancesBySource;
    const term = modalSearchTerm.toLowerCase();
    const filtered: Record<string, number> = {};
    (Object.entries(balancesBySource) as [string, number][]).forEach(([k, v]) => {
      if (k.toLowerCase().includes(term)) {
        filtered[k] = v;
      }
    });
    return filtered;
  }, [balancesBySource, modalSearchTerm]);

  const filteredAccountBalances = useMemo(() => {
    if (!accountBalances) return [];
    return accountBalances.filter(acc => {
      if (!modalSearchTerm) return true;
      const term = modalSearchTerm.toLowerCase();
      return (
        acc.bankName.toLowerCase().includes(term) ||
        acc.accountLabel.toLowerCase().includes(term) ||
        acc.accountName.toLowerCase().includes(term) ||
        (acc.number || '').includes(term)
      );
    });
  }, [accountBalances, modalSearchTerm]);

  const modalStats = useMemo(() => {
    if (modalType !== 'saldo-total') return { counts: 0, total: 0, average: 0, pluggyCount: 0, manualCount: 0 };
    
    const counts = filteredAccountBalances.length;
    const total = filteredAccountBalances.filter(acc => acc.includeInSaldoTotal).reduce((sum, b) => sum + b.balance, 0);
    const average = counts > 0 ? total / counts : 0;
    
    const pluggyCount = filteredAccountBalances.filter(acc => acc.provider === 'pluggy').length;
    const manualCount = filteredAccountBalances.filter(acc => acc.provider === 'manual').length;
    
    return { counts, total, average, pluggyCount, manualCount };
  }, [modalType, filteredAccountBalances]);

  const handleToggleIncludeInTotal = async (accId: string, currentValue: boolean) => {
    try {
      const docRef = doc(db, 'accountBalances', accId);
      await updateDoc(docRef, {
        includeInSaldoTotal: !currentValue,
        updatedAt: serverTimestamp()
      });
      toast.success('Configuração de saldo atualizada com sucesso!');
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao atualizar a configuração da conta: ' + err.message);
    }
  };

  if (loadingTransactions) {
    return (
      <div className="flex bg-slate-50 flex-col items-center justify-center flex-1 h-full w-full">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mb-4" />
        <p className="text-slate-500 font-medium text-sm">Carregando seus dados...</p>
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="flex-1 flex flex-col min-w-0 relative h-full">
        {isSyncingPluggy && (
          <div className="absolute top-4 left-4 right-4 z-50 flex items-center justify-center">
            <div className="flex items-center gap-1.5 px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-full animate-pulse text-emerald-800 text-xs font-semibold shadow-md">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              <span>{pluggySyncStep || 'Sincronizando...'}</span>
            </div>
          </div>
        )}
        <EmptyState
          onNavigateImport={onNavigateImport}
          pluggyItemIdsCount={profile?.pluggyItemIds?.length || 0}
          onSyncPluggy={syncPluggyNow}
          isSyncingPluggy={isSyncingPluggy}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <header className="min-h-0 md:min-h-[4rem] py-2 md:py-3 flex-shrink-0 bg-white border-b border-slate-200 flex flex-row items-center justify-between px-3 md:px-8 z-10 gap-2 md:gap-4 shadow-sm w-full">
        <div className="flex flex-row items-center gap-2 sm:gap-4 flex-1 min-w-0 pr-2">
          <h1 className="text-lg font-extrabold text-slate-800 tracking-tight hidden lg:block whitespace-nowrap flex-shrink-0">Dashboard</h1>
          {isSyncingPluggy && (
            <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 border border-emerald-100 rounded-full animate-pulse text-emerald-800 text-xs font-semibold shrink-0">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
              <span className="hidden md:inline">{pluggySyncStep || 'Sincronizando...'}</span>
              <span className="md:hidden">Sincronizando...</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <PeriodFilterToolbar filterConfig={filterConfig} setFilterConfig={setFilterConfig} />
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 md:gap-3 flex-shrink-0">
          <div className="relative hidden md:block w-24 lg:w-32 xl:w-64 max-w-full transition-all">
            <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-slate-400">
              <Search className="w-4 h-4" />
            </span>
            <input type="text" maxLength={50} placeholder="Buscar" value={searchTerm} onChange={e => {setSearchTerm(e.target.value); setCurrentPage(1);}} className="bg-slate-50 border border-slate-200 text-sm rounded-lg pl-9 pr-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
          </div>
          <button onClick={onNavigateImport} className={`bg-emerald-600 text-white px-3 md:px-4 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-emerald-700 hidden sm:flex text-center justify-center items-center gap-1.5 flex-shrink-0 whitespace-nowrap transition-all ${filterConfig.type === 'custom' ? '!p-2' : ''}`}>
            <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className={filterConfig.type === 'custom' ? 'hidden xl:inline' : 'hidden lg:inline'}>Nova Importação</span>
          </button>
        </div>
      </header>

      <PullToRefresh 
        onRefresh={handleRefresh} 
        className="flex-1 flex flex-col min-h-0 w-full"
        innerClassName="flex-1 flex flex-col px-3 py-1.5 md:p-8 space-y-3 md:space-y-6 w-full pb-[100px] md:pb-8 overflow-y-auto"
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 flex-none min-h-0">
          <div onClick={() => setModalType('receitas')} className="bg-white p-3.5 sm:p-5 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm group hover:border-emerald-200 transition-colors flex flex-col justify-between active:scale-[0.98] text-left cursor-pointer h-full gap-3 sm:gap-4 relative overflow-hidden min-h-[96px] sm:min-h-0">
            <div className="flex items-center justify-between w-full relative z-10">
              <h4 className="text-[11px] min-[380px]:text-xs sm:text-xs font-bold text-slate-400 uppercase tracking-widest">Receita</h4>
              <div className="p-1.5 sm:p-2 bg-emerald-50 text-emerald-600 rounded-xl group-hover:scale-110 transition-transform shrink-0">
                <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
            </div>
            <p className="text-[13px] min-[360px]:text-[15px] min-[400px]:text-lg sm:text-xl lg:text-2xl font-black text-slate-800 text-left tracking-tighter whitespace-nowrap w-full leading-none relative z-10" title={`R$ ${totalReceitas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}>
              R$ {totalReceitas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          </div>

          <div onClick={() => setModalType('despesas')} className="bg-white p-3.5 sm:p-5 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm group hover:border-rose-200 transition-colors flex flex-col justify-between active:scale-[0.98] text-left cursor-pointer h-full gap-3 sm:gap-4 relative overflow-hidden min-h-[96px] sm:min-h-0">
            <div className="flex items-center justify-between w-full relative z-10">
              <h4 className="text-[11px] min-[380px]:text-xs sm:text-xs font-bold text-slate-400 uppercase tracking-widest">Despesa</h4>
              <div className="p-1.5 sm:p-2 bg-rose-50 text-rose-600 rounded-xl group-hover:scale-110 transition-transform shrink-0">
                <TrendingDown className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
            </div>
            <p className="text-[13px] min-[360px]:text-[15px] min-[400px]:text-lg sm:text-xl lg:text-2xl font-black text-slate-800 text-left tracking-tighter whitespace-nowrap w-full leading-none relative z-10" title={`R$ ${totalDespesas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}>
              R$ {totalDespesas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          </div>

          <div onClick={() => setModalType('saldo')} className="bg-white p-3.5 sm:p-5 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm group hover:border-blue-200 transition-colors flex flex-col justify-between active:scale-[0.98] text-left cursor-pointer h-full gap-3 sm:gap-4 relative overflow-hidden min-h-[96px] sm:min-h-0">
            <div className="flex items-center justify-between w-full relative z-10">
              <h4 className="text-[11px] min-[380px]:text-xs sm:text-xs font-bold text-slate-400 uppercase tracking-widest">Balanço</h4>
              <div className="p-1.5 sm:p-2 bg-blue-50 text-blue-600 rounded-xl group-hover:scale-110 transition-transform shrink-0">
                <Scale className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
            </div>
            <p className={`text-[13px] min-[360px]:text-[15px] min-[400px]:text-lg sm:text-xl lg:text-2xl font-black text-left tracking-tighter whitespace-nowrap w-full leading-none relative z-10 ${saldo >= 0 ? "text-emerald-600" : "text-rose-600"}`} title={`R$ ${saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}>
              R$ {saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          </div>

          <div onClick={() => setModalType('saldo-total')} className="bg-white p-3.5 sm:p-5 rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm group hover:border-violet-200 transition-colors flex flex-col justify-between active:scale-[0.98] text-left cursor-pointer h-full gap-3 sm:gap-4 relative overflow-hidden min-h-[96px] sm:min-h-0">
            <div className="flex items-center justify-between w-full relative z-10">
              <h4 className="text-[11px] min-[380px]:text-xs sm:text-xs font-bold text-slate-400 uppercase tracking-widest">Saldo Total</h4>
              <div className="p-1.5 sm:p-2 bg-violet-50 text-violet-600 rounded-xl group-hover:scale-110 transition-transform shrink-0">
                <Wallet className="w-4 h-4 sm:w-5 sm:h-5 animate-none" />
              </div>
            </div>
            <p className={`text-[13px] min-[360px]:text-[15px] min-[400px]:text-lg sm:text-xl lg:text-2xl font-black text-left tracking-tighter whitespace-nowrap w-full leading-none relative z-10 ${saldoTotal >= 0 ? "text-emerald-600" : "text-rose-600"}`} title={`R$ ${saldoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}>
              R$ {saldoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        {!aiSettings || !aiSettings.aiEnabled || !aiSettings.aiUseForInsights ? (
          <div className="bg-slate-50 border border-slate-200 rounded-xl sm:rounded-2xl p-3 sm:p-5 text-slate-500 shadow-sm flex items-center justify-between gap-3 sm:gap-4 flex-shrink-0">
            <div className="flex items-center gap-3 sm:gap-4 w-full">
              <div className="bg-slate-100 p-2 sm:p-3 rounded-lg sm:rounded-xl border border-slate-200 text-slate-400">
                <Sparkles className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <div className="text-[11px] sm:text-sm md:text-base font-bold text-slate-700 flex items-center gap-2">
                  {!aiSettings ? 'Configurando IA...' : 'Insights por IA Desativados'}
                </div>
                <p className="text-[9px] sm:text-xs md:text-sm text-slate-400 leading-tight line-clamp-1 truncate mt-0.5">
                  Configurações de IA não carregadas ou IA desativada.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-gradient-to-r from-indigo-600 to-purple-700 rounded-xl sm:rounded-2xl p-3 sm:p-5 text-white shadow-md sm:shadow-lg flex items-center justify-between gap-3 sm:gap-4 flex-shrink-0">
            <div className="flex items-center gap-3 sm:gap-4 w-full">
              <div className="bg-white/20 p-2 sm:p-3 rounded-lg sm:rounded-xl backdrop-blur-sm">
                <Sparkles className="w-4 h-4 sm:w-6 sm:h-6 text-indigo-100" />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <div className="text-[11px] sm:text-sm md:text-base font-bold flex items-center gap-2">
                  Insight da IA {aiLoading && <span className="bg-white/10 px-1.5 py-0.5 inline-block rounded text-[9px] sm:text-[10px] uppercase tracking-tighter text-indigo-50">Analisando...</span>}
                </div>
                <p className="text-[9px] sm:text-xs md:text-sm text-indigo-100 leading-tight line-clamp-1 truncate mt-0.5">
                  {aiLoading ? (
                    <span className="flex items-center"><Loader2 className="w-3 h-3 sm:w-4 sm:h-4 mr-1 animate-spin" /> {aiLoadingMessage}</span>
                  ) : aiInsights ? (
                    'Insight gerado. Clique para ver.'
                  ) : (
                    'Explore tendências do período.'
                  )}
                </p>
              </div>
            </div>
            <button 
              onClick={aiInsights && !aiLoading ? () => setModalType('insight') : getInsights} 
              disabled={aiLoading} 
              className="bg-white/10 hover:bg-white/20 transition-colors border border-white/20 px-3 sm:px-5 py-1.5 sm:py-2.5 rounded-lg sm:rounded-xl text-[10px] sm:text-xs font-bold whitespace-nowrap uppercase tracking-wide shrink-0"
            >
              {aiInsights && !aiLoading ? 'Ver Insight' : 'Gerar'}
            </button>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden hidden md:flex flex-col">
          <div className="px-4 sm:px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-bold text-slate-800">Últimas Movimentações</h3>
              <button 
                onClick={() => setShowFilters(!showFilters)} 
                className={`text-[10px] items-center flex gap-1.5 font-bold px-2 py-1 rounded-md transition-colors ${showFilters || (filterDate || filterDesc || filterCat || filterSource || filterAmountType || typeFilter !== 'all') ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'}`}
              >
                <Filter className="w-3 h-3" /> Filtros {([filterDate, filterDesc, filterCat, filterSource, filterAmountType, typeFilter !== 'all' ? '1' : ''].filter(Boolean).length) > 0 && <span className="bg-emerald-500 text-white w-4 h-4 rounded-full flex items-center justify-center leading-none">{([filterDate, filterDesc, filterCat, filterSource, filterAmountType, typeFilter !== 'all' ? '1' : ''].filter(Boolean).length)}</span>}
              </button>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button 
                onClick={onOpenManualEntry}
                className="flex-1 sm:flex-none text-[10px] font-bold text-white px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 flex items-center justify-center shadow-md transition-all active:scale-95 group"
              >
                <Plus className="w-4 h-4 mr-1.5 group-hover:rotate-90 transition-transform" /> 
                <span>Lançamento</span>
              </button>
              <button onClick={handleExportPDF} className="text-[10px] font-bold text-slate-500 px-3 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center transition-colors">
                <FileDown className="w-3 h-3" />
              </button>
            </div>
          </div>
          {showFilters && (
            <div className="px-4 sm:px-6 py-4 bg-slate-50 border-b border-slate-100 flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:gap-4 sm:items-end animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex-none sm:flex-1 min-w-0 sm:min-w-[130px] relative">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 flex items-center"><Calendar className="w-3 h-3 mr-1 opacity-60" /> Data</label>
                <div className="relative">
                  <input ref={inputRefs.date} type="text" maxLength={10} value={filterDate} onChange={e => {setFilterDate(handleDateMask(e.target.value)); setCurrentPage(1);}} className="font-normal text-xs pl-3 pr-8 py-2 rounded-lg border border-slate-200 bg-white w-full focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 placeholder:text-slate-300 transition-all shadow-sm" placeholder="Ex: 14/05/2026" />
                  {filterDate && <button onClick={() => clearFilter(setFilterDate, inputRefs.date)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>}
                </div>
              </div>
              <div className="flex-none sm:flex-1 min-w-0 sm:min-w-[150px] relative">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 flex items-center"><FileDown className="w-3 h-3 mr-1 opacity-60" /> Descrição</label>
                <div className="relative">
                  <input ref={inputRefs.desc} type="text" maxLength={50} value={filterDesc} onChange={e => {setFilterDesc(e.target.value); setCurrentPage(1);}} className="font-normal text-xs pl-3 pr-8 py-2 rounded-lg border border-slate-200 bg-white w-full focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 placeholder:text-slate-300 transition-all shadow-sm" placeholder="Ex: Mercado..." />
                  {filterDesc && <button onClick={() => clearFilter(setFilterDesc, inputRefs.desc)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>}
                </div>
              </div>
              <div className="flex-none sm:flex-1 min-w-0 sm:min-w-[130px] relative">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 flex items-center"><Tag className="w-3 h-3 mr-1 opacity-60" /> Categoria</label>
                <div className="relative">
                  <input ref={inputRefs.cat} type="text" maxLength={30} value={filterCat} onChange={e => {setFilterCat(e.target.value); setCurrentPage(1);}} className="font-normal text-xs pl-3 pr-8 py-2 rounded-lg border border-slate-200 bg-white w-full focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 placeholder:text-slate-300 transition-all shadow-sm" placeholder="Ex: Lazer" />
                  {filterCat && <button onClick={() => clearFilter(setFilterCat, inputRefs.cat)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>}
                </div>
              </div>
              <div className="hidden lg:block lg:flex-1 min-w-0 lg:min-w-[130px] relative">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 flex items-center"><CreditCard className="w-3 h-3 mr-1 opacity-60" /> Origem</label>
                <div className="relative">
                  <input ref={inputRefs.source} type="text" maxLength={30} value={filterSource} onChange={e => {setFilterSource(e.target.value); setCurrentPage(1);}} className="font-normal text-xs pl-3 pr-8 py-2 rounded-lg border border-slate-200 bg-white w-full focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 placeholder:text-slate-300 transition-all shadow-sm" placeholder="Ex: Conta BB" />
                  {filterSource && <button onClick={() => clearFilter(setFilterSource, inputRefs.source)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>}
                </div>
              </div>
              <div className="flex-none sm:flex-[0.8] min-w-0 sm:min-w-[110px] relative">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5 flex items-center"><Filter className="w-3 h-3 mr-1 opacity-60" /> Tipo</label>
                <select value={typeFilter} onChange={e => {setTypeFilter(e.target.value); setCurrentPage(1);}} className="font-bold text-[10px] px-3 py-2 rounded-lg border border-slate-200 bg-white w-full focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 cursor-pointer uppercase text-slate-700 h-[34px] shadow-sm">
                  <option value="all">TODOS</option>
                  <option value="Receita">RECEITAS</option>
                  <option value="Despesa">DESPESAS</option>
                </select>
              </div>
              {([filterDate, filterDesc, filterCat, filterSource, filterAmountType, typeFilter !== 'all' ? '1' : ''].filter(Boolean).length) > 0 && (
                <div className="flex-none mt-2 sm:mt-0">
                  <button onClick={() => {setFilterDate(''); setFilterDesc(''); setFilterCat(''); setFilterSource(''); setTypeFilter('all'); setFilterAmount(''); setFilterAmountType(''); setCurrentPage(1);}} className="text-[10px] font-bold text-slate-500 hover:text-rose-600 hover:bg-rose-50 px-3 py-2 rounded-lg border border-transparent transition-colors h-[34px] w-full sm:w-auto flex items-center justify-center gap-1.5 uppercase bg-white sm:bg-transparent shadow-sm sm:shadow-none">
                    <X className="w-3 h-3" /> Limpar
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="flex-1 overflow-x-auto min-h-[300px]">
            <table className="w-full text-left border-collapse min-w-[800px] hidden md:table">
              <thead className="sticky top-0 bg-slate-50 z-10">
                <tr className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="px-6 py-4 border-b border-slate-100 whitespace-nowrap min-w-[100px]">
                    <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 opacity-60" /> Data</span>
                  </th>
                  <th className="px-6 py-4 border-b border-slate-100 w-full max-w-[200px]">
                    <span className="flex items-center gap-1.5"><FileDown className="w-3.5 h-3.5 opacity-60" /> Descrição</span>
                  </th>
                  <th className="px-6 py-4 border-b border-slate-100 whitespace-nowrap">
                    <span className="flex items-center gap-1.5"><Tag className="w-3.5 h-3.5 opacity-60" /> Categorias</span>
                  </th>
                  <th className="px-6 py-4 border-b border-slate-100 whitespace-nowrap">
                    <span className="flex items-center gap-1.5"><CreditCard className="w-3.5 h-3.5 opacity-60" /> Origem</span>
                  </th>
                  <th className="px-6 py-4 border-b border-slate-100 text-right whitespace-nowrap">
                    <span className="flex items-center justify-end gap-1.5"><DollarSign className="w-3.5 h-3.5 opacity-60" /> Valor</span>
                  </th>
                  <th className="px-6 py-4 border-b border-slate-100 whitespace-nowrap min-w-[100px]">
                    <span className="flex items-center gap-1.5"><Filter className="w-3.5 h-3.5 opacity-60" /> Tipo</span>
                  </th>
                  <th className="px-6 py-4 border-b border-slate-100 text-center whitespace-nowrap">
                    <span className="flex items-center justify-center gap-1.5 h-[18px]"><Settings2 className="w-3.5 h-3.5 opacity-60" /> AÇÕES</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50/50">
                {currentData.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-slate-400 text-sm font-medium">Nenhuma movimentação encontrada.</td></tr>
                ) : currentData.map((item, i) => {
                  const isDespesa = item.type === 'Despesa';
                  return (
                    <tr 
                      key={item.id || i} 
                      onClick={() => onEditTransaction(item)}
                      className="text-xs hover:bg-emerald-50/20 transition-colors cursor-pointer group/row"
                    >
                      <td className="px-6 py-4 text-slate-500 font-medium">{item.date}</td>
                      <td className="px-6 py-4 font-bold text-slate-700 max-w-[240px] truncate" title={item.desc}>
                        <div className="flex items-center gap-2">
                          <span className="truncate">{item.desc}</span>
                          {item.needsReview && (
                            <span className="shrink-0 bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider animate-pulse flex items-center gap-0.5" title="Classificação de baixa confiança. Clique para revisar ou editar.">
                              <Sparkles className="w-2 h-2" /> Revisar
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-block max-w-[130px] truncate align-middle text-center bg-slate-50 border border-slate-100 text-slate-600 px-2 py-0.5 rounded-full text-[10px] font-bold" title={item.cat}>{item.cat}</span>
                      </td>
                      <td className="px-6 py-4 text-slate-500 max-w-[120px] truncate" title={item.source}>{item.source}</td>
                      <td className={`px-6 py-4 text-right font-black ${isDespesa ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {isDespesa ? '-' : '+'} {formatMoeda(Math.abs(item.amount))}
                      </td>
                      <td className="px-6 py-4 font-bold uppercase tracking-tighter">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[9px] ${isDespesa ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                           {item.type}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-center gap-2">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditTransaction(item);
                            }}
                            className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg opacity-100 transition-all hover:scale-110 active:scale-95"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          {deletingId === item.id ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                              className="px-2 py-1 text-white bg-rose-600 hover:bg-rose-700 rounded text-[9px] font-bold opacity-100 transition-all active:scale-95"
                            >
                              Confirmar
                            </button>
                          ) : (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeletingId(item.id || null);
                              }}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg opacity-100 transition-all hover:scale-110 active:scale-95"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Mobile Cards View removed - moved to Analysis tab */}
          </div>
          <div className="px-4 sm:px-6 py-3 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
            <span className="hidden sm:inline">Exibindo {Math.min(filteredData.length, rowsPerPage)} de {filteredData.length}</span>
            <span className="sm:hidden">{Math.min(filteredData.length, rowsPerPage)} / {filteredData.length}</span>
            <div className="flex gap-4">
              <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="hover:text-emerald-600 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed flex items-center gap-1">Voltar</button>
              <button disabled={currentPage >= totalPages || totalPages === 0} onClick={() => setCurrentPage(p => p + 1)} className="hover:text-emerald-600 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed flex items-center gap-1">Próximo</button>
            </div>
          </div>
        </div>
      </PullToRefresh>

      {modalType && (
      <div className="fixed inset-0 bg-slate-900/40 sm:bg-slate-900/60 z-[60] flex flex-col justify-end sm:items-center sm:justify-center backdrop-blur-sm sm:backdrop-blur-md pt-10 sm:pt-4 sm:p-4 transition-all" onClick={handleCloseModal} 
           style={{ 
             opacity: dragY > 0 ? 1 - (dragY / 500) : 1,
             height: viewportHeight > 0 && typeof window !== 'undefined' && window.innerWidth < 640 ? `${viewportHeight}px` : undefined,
             top: offsetTop > 0 && typeof window !== 'undefined' && window.innerWidth < 640 ? `${offsetTop}px` : undefined,
           }}>
        <div 
          className="bg-white rounded-t-[32px] sm:rounded-[32px] shadow-2xl w-full max-h-[90%] sm:h-auto sm:max-w-4xl overflow-hidden flex flex-col sm:max-h-[90vh] border-t sm:border border-slate-200 animate-in slide-in-from-bottom-10 sm:fade-in sm:zoom-in duration-300 relative"
          onClick={e => e.stopPropagation()}
          style={{ 
            transform: dragY > 0 ? `translateY(${dragY}px)` : 'translateY(0)',
            transition: dragY > 0 ? 'none' : 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)'
          }}
        >
          {/* Modal Header */}
          <div 
            className={`relative p-5 sm:p-8 pt-6 sm:pt-8 border-b flex-shrink-0 touch-none sm:touch-auto transition-colors duration-300 ${
              modalType === 'receitas' ? 'bg-gradient-to-b from-emerald-100/90 via-emerald-50/50 to-white border-emerald-100/50' : 
              modalType === 'despesas' ? 'bg-gradient-to-b from-rose-100/90 via-rose-50/50 to-white border-rose-100/50' : 
              modalType === 'saldo' ? 'bg-gradient-to-b from-blue-100/90 via-blue-50/50 to-white border-blue-100/50' : 
              modalType === 'insight' ? 'bg-gradient-to-b from-purple-100 via-purple-50/50 to-white border-purple-200/60' : 
              'bg-gradient-to-b from-violet-100/90 via-violet-50/50 to-white border-violet-100/50'
            }`}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* Mobile indicator for sheet look */}
            <div className="absolute top-0 left-0 w-full flex justify-center pt-3 sm:hidden">
              <div className="w-12 h-1.5 bg-slate-300/60 rounded-full flex-shrink-0" />
            </div>

            <div className="flex justify-between items-start mb-6">
              <div className="pr-8">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className={`p-2 rounded-xl shadow-sm ${
                    modalType === 'receitas' ? 'bg-emerald-50 text-emerald-600' :
                    modalType === 'despesas' ? 'bg-rose-50 text-rose-600' :
                    modalType === 'saldo' ? 'bg-blue-50 text-blue-600' :
                    modalType === 'insight' ? 'bg-purple-50 text-purple-600' :
                    'bg-violet-50 text-violet-600'
                  }`}>
                    {modalType === 'receitas' && <TrendingUp className="w-5 h-5" />}
                    {modalType === 'despesas' && <TrendingDown className="w-5 h-5" />}
                    {modalType === 'saldo' && <Scale className="w-5 h-5" />}
                    {modalType === 'saldo-total' && <Wallet className="w-5 h-5" />}
                    {modalType === 'insight' && <Bot className="w-5 h-5" />}
                  </div>
                  <h2 className="text-lg sm:text-xl font-black text-slate-800 tracking-tight leading-tight uppercase">
                    {modalType === 'receitas' && 'Receitas Detalhadas'}
                    {modalType === 'despesas' && 'Despesas Detalhadas'}
                    {modalType === 'saldo' && 'Fluxo de Caixa'}
                    {modalType === 'saldo-total' && 'Saldo Acumulado'}
                    {modalType === 'insight' && 'Análise da IA'}
                  </h2>
                </div>
                <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest leading-none">
                  {modalType === 'saldo-total' ? 'Todos os Registros' : new Date(filterConfig.year, filterConfig.month - 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                </p>
              </div>
              <button 
                onClick={handleCloseModal} 
                className="absolute right-4 top-4 sm:relative sm:right-auto sm:top-auto text-slate-400 hover:text-slate-700 bg-slate-50 p-2.5 rounded-full transition-all shadow-sm hover:scale-110 active:scale-90"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Stats Grid */}
            {modalType !== 'insight' && (
              modalType === 'saldo-total' ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                  <div className="bg-slate-50/50 rounded-2xl p-3 sm:p-4 border border-slate-100 flex flex-col justify-center">
                    <span className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Ativas</span>
                    <span className="text-base sm:text-lg font-black text-slate-800 leading-none">
                      {filteredAccountBalances.filter(a => a.includeInSaldoTotal).length}
                    </span>
                    <span className="text-[9px] text-slate-300 block mt-1 font-bold">Incluídas</span>
                  </div>
                  <div className="bg-slate-50/50 rounded-2xl p-3 sm:p-4 border border-slate-100 col-span-1 md:col-span-2 flex flex-col justify-center">
                    <span className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Saldo Disponível</span>
                    <span className={`text-base sm:text-lg font-black leading-none ${modalStats.total >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {formatMoeda(modalStats.total)}
                    </span>
                    <span className="text-[9px] text-slate-400 block mt-1 font-bold">Patrimônio Líquido</span>
                  </div>
                  <div className="hidden md:flex bg-slate-50/50 rounded-2xl p-3 sm:p-4 border border-slate-100 flex flex-col justify-center">
                    <span className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Origens</span>
                    <span className="text-base sm:text-lg font-black text-slate-800 leading-none">
                      {modalStats.pluggyCount + modalStats.manualCount}
                    </span>
                    <span className="text-[9px] text-slate-400 block mt-1 font-bold">
                      {modalStats.pluggyCount} Sinc / {modalStats.manualCount} Man
                    </span>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                  <div className="bg-slate-50/50 rounded-2xl p-3 sm:p-4 border border-slate-100 flex flex-col justify-center">
                    <span className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">
                      <span className="sm:hidden">Movimentações</span>
                      <span className="hidden sm:inline">Volume</span>
                    </span>
                    <span className="text-base sm:text-lg font-black text-slate-800 leading-none">
                      {filteredModalData.length}
                    </span>
                    <span className="text-[9px] text-slate-400 block mt-1 font-bold">Itens</span>
                  </div>
                  <div className="bg-slate-50/50 rounded-2xl p-3 sm:p-4 border border-slate-100 col-span-1 md:col-span-2 flex flex-col justify-center">
                    <span className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Total</span>
                    <span className={`text-base sm:text-lg font-black leading-none ${
                      modalType === 'receitas' ? 'text-emerald-600' :
                      modalType === 'despesas' ? 'text-rose-600' :
                      'text-slate-800'
                    }`}>
                      {formatMoeda(
                        filteredModalData.reduce((acc, t) => acc + (modalType === 'saldo' ? (t.type === 'Receita' ? t.amount : -Math.abs(t.amount)) : Math.abs(t.amount)), 0)
                      )}
                    </span>
                    <span className="text-[9px] text-slate-400 block mt-1 font-bold">Consolidado</span>
                  </div>
                  <div className="hidden md:flex bg-slate-50/50 rounded-2xl p-3 sm:p-4 border border-slate-100 flex-col justify-center">
                    <span className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Média</span>
                    <span className="text-base sm:text-lg font-black text-slate-800 leading-none">
                      {formatMoeda(
                        filteredModalData.length > 0 ? filteredModalData.reduce((acc, t) => acc + Math.abs(t.amount), 0) / filteredModalData.length : 0
                      )}
                    </span>
                    <span className="text-[9px] text-slate-400 block mt-1 font-bold">Por transação</span>
                  </div>
                </div>
              )
            )}
          </div>

          {/* Modal Search Container */}
          {modalType !== 'insight' && (
          <div className="px-5 sm:px-8 py-4 sm:py-5 bg-slate-50/80 border-b border-slate-100 flex flex-col gap-3 flex-shrink-0 touch-none sm:touch-auto" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
            <div className="flex gap-2 w-full">
              <div className="relative flex-1">
                <Search className="w-[18px] h-[18px] absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text" 
                  placeholder={modalType === 'saldo-total' ? "Pesquisar por conta..." : "Pesquisar transação..."} 
                  value={modalSearchTerm}
                  onChange={e => setModalSearchTerm(e.target.value)}
                  className="w-full pl-11 pr-4 min-h-[44px] py-3 bg-white border border-slate-200/80 rounded-2xl text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-400 transition-all placeholder:text-slate-400 shadow-sm"
                />
              </div>
              {modalType === 'saldo-total' && (
                <button 
                  onClick={() => setShowAddManualForm(!showAddManualForm)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-2xl text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-1.5 shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Conta Manual</span>
                </button>
              )}
              {modalType !== 'saldo-total' && (
                <button 
                  onClick={() => setShowModalFiltersMobile(!showModalFiltersMobile)}
                  className={`relative sm:hidden w-12 flex-shrink-0 rounded-2xl border transition-all flex items-center justify-center shadow-sm ${showModalFiltersMobile || [modalFilterDate, modalFilterCat, modalFilterAmountType, modalFilterAmount].filter(Boolean).length > 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-white border-slate-200/80 text-slate-400 focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-400'}`}
                >
                  <Filter className="w-5 h-5" />
                  {([modalFilterDate, modalFilterCat, modalFilterAmountType, modalFilterAmount].filter(Boolean).length) > 0 && !showModalFiltersMobile && (
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-emerald-500 rounded-full border-2 border-white"></span>
                  )}
                </button>
              )}
            </div>
            
            {modalType !== 'saldo-total' && (
              <div className={`${showModalFiltersMobile ? 'flex flex-col sm:flex-row' : 'hidden'} sm:flex grid-cols-2 sm:grid-cols-none sm:flex-wrap gap-2 animate-in slide-in-from-top-2 duration-300 fade-in`}>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-1">
                  <div className="relative col-span-1 sm:flex-1">
                    <Calendar className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Data" 
                      value={modalFilterDate}
                      onChange={e => setModalFilterDate(handleDateMask(e.target.value))}
                      className="w-full pl-9 pr-3 min-h-[44px] py-3 bg-white border border-slate-200/80 rounded-xl text-sm font-semibold focus:outline-none focus:border-emerald-400 shadow-sm transition-all"
                    />
                    {modalFilterDate && <button onClick={() => setModalFilterDate('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 min-h-[44px] min-w-[44px] flex items-center justify-center"><X className="w-4 h-4"/></button>}
                  </div>
                  <div className="relative col-span-1 sm:flex-1">
                    <Tag className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Categoria" 
                      value={modalFilterCat}
                      onChange={e => setModalFilterCat(e.target.value)}
                      className="w-full pl-9 pr-3 min-h-[44px] py-3 bg-white border border-slate-200/80 rounded-xl text-sm font-semibold focus:outline-none focus:border-emerald-400 shadow-sm transition-all"
                    />
                    {modalFilterCat && <button onClick={() => setModalFilterCat('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 min-h-[44px] min-w-[44px] flex items-center justify-center"><X className="w-4 h-4"/></button>}
                  </div>
                </div>
                <div className="flex gap-2 sm:flex-none">
                  <select
                    value={modalFilterAmountType}
                    onChange={e => setModalFilterAmountType(e.target.value as any)}
                    className="bg-white border border-slate-200/80 rounded-xl text-sm font-semibold px-3 py-3 min-h-[44px] focus:outline-none focus:border-emerald-400 text-slate-600 flex-[0.6] sm:w-[140px] sm:flex-none shadow-sm appearance-none"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}
                  >
                    <option value="">Valores</option>
                    <option value="greater">Maior que &nbsp;&gt;</option>
                    <option value="less">Menor que &nbsp;&lt;</option>
                    <option value="equal">Igual a &nbsp;&nbsp;&nbsp;&nbsp;=</option>
                  </select>
                  <input
                    type="number"
                    placeholder="R$ 0,00"
                    value={modalFilterAmount}
                    onChange={e => setModalFilterAmount(e.target.value)}
                    disabled={modalFilterAmountType === ''}
                    className="flex-1 sm:w-32 px-3 py-3 min-h-[44px] bg-white border border-slate-200/80 rounded-xl text-sm font-semibold focus:outline-none focus:border-emerald-400 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-100 shadow-sm transition-all"
                  />
                </div>
              </div>
            )}
            {([modalFilterDate, modalFilterCat, modalFilterAmountType, modalFilterAmount].filter(Boolean).length) > 0 && (
                <div className={`${showModalFiltersMobile ? 'flex' : 'hidden'} sm:flex justify-end mt-1 animate-in fade-in`}>
                  <button onClick={() => {setModalFilterDate(''); setModalFilterCat(''); setModalFilterAmountType(''); setModalFilterAmount('');}} className="text-[10px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest flex items-center gap-1">
                    <X className="w-3 h-3" /> Limpar Filtros
                  </button>
                </div>
            )}
          </div>
          )}

          {/* Modal Content - Scrollable Area */}
          <div className="flex-1 overflow-y-auto px-5 sm:px-8 py-5 bg-white">
            {modalType === 'insight' ? (
              <div className="prose prose-sm prose-slate max-w-none text-slate-700 font-medium whitespace-pre-wrap">
                {aiInsights ? (
                  <ReactMarkdown>{aiInsights}</ReactMarkdown>
                ) : (
                  <p className="text-center text-slate-400 italic">Nenhum insight gerado. Feche e clique em Gerar.</p>
                )}
              </div>
            ) : modalType === 'saldo-total' ? (
              <div className="space-y-4 pb-20 sm:pb-0">
                {/* Form to add/edit manual accounts */}
                {showAddManualForm && (
                  <form onSubmit={handleSaveManualAccount} className="bg-slate-50 p-5 rounded-2xl border border-slate-200/60 mb-6 flex flex-col gap-4 animate-in slide-in-from-top-3 duration-300">
                    <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
                      <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                        <Plus className="w-4 h-4 text-emerald-600" />
                        {editingAccountId ? 'Editar Conta Manual' : 'Adicionar Conta Manual'}
                      </h3>
                      <button 
                        type="button" 
                        onClick={() => { setShowAddManualForm(false); setEditingAccountId(null); }}
                        className="text-slate-400 hover:text-slate-600 text-[10px] font-bold"
                      >
                        Cancelar
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Instituição / Banco</label>
                        <input 
                          type="text" 
                          maxLength={50}
                          placeholder="Ex: Caixa, Nubank, Itaú..." 
                          value={manualAccountForm.bankName}
                          onChange={e => setManualAccountForm({ ...manualAccountForm, bankName: e.target.value })}
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-semibold focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Descrição / Titularidade</label>
                        <input 
                          type="text" 
                          maxLength={50}
                          placeholder="Ex: Conta corrente, Poupança..." 
                          value={manualAccountForm.accountLabel}
                          onChange={e => setManualAccountForm({ ...manualAccountForm, accountLabel: e.target.value })}
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-semibold focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Tipo de Conta</label>
                        <select 
                          value={manualAccountForm.accountType}
                          onChange={e => setManualAccountForm({ ...manualAccountForm, accountType: e.target.value })}
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-600 focus:outline-none focus:border-emerald-500"
                        >
                          <option value="BANK">Conta Corrente</option>
                          <option value="PAYMENT_ACCOUNT">Conta de Pagamento</option>
                          <option value="SAVINGS">Poupança</option>
                          <option value="INVESTMENT">Investimento</option>
                          <option value="CREDIT">Cartão de Crédito</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Nº Conta (opcional)</label>
                        <input 
                          type="text" 
                          maxLength={30}
                          placeholder="Ex: final 1234" 
                          value={manualAccountForm.number}
                          onChange={e => setManualAccountForm({ ...manualAccountForm, number: e.target.value })}
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-semibold focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">Saldo Atual (R$)</label>
                        <input 
                          type="number" 
                          step="any"
                          placeholder="e.g. 5000.00" 
                          value={manualAccountForm.balance}
                          onChange={e => setManualAccountForm({ ...manualAccountForm, balance: e.target.value })}
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-semibold focus:outline-none focus:border-emerald-500 text-slate-850"
                        />
                      </div>
                    </div>
                    
                    <button 
                      type="submit"
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-md transition-all uppercase tracking-wider"
                    >
                      {editingAccountId ? 'Salvar Alterações' : 'Salvar Nova Conta'}
                    </button>
                  </form>
                )}

                {filteredAccountBalances.length === 0 ? (
                  <div className="px-6 py-12 text-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/30">
                    <Wallet className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <h4 className="font-bold text-slate-700 text-sm mb-1">Nenhuma conta cadastrada ou localizada</h4>
                    <p className="text-xs text-slate-400 mb-4">Adicione uma conta manual ou conecte ao Open Finance nas Configurações.</p>
                    <button 
                      type="button" 
                      onClick={() => setShowAddManualForm(true)}
                      className="bg-emerald-50 hover:bg-emerald-100 text-emerald-600 px-4 py-2 rounded-xl text-xs font-bold transition-all"
                    >
                      Cadastrar Conta Manual
                    </button>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    {/* Desktop View */}
                    <table className="w-full text-left border-collapse hidden sm:table">
                      <thead className="bg-slate-50/50">
                        <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                          <th className="px-6 py-4">Instituição / Conta</th>
                          <th className="px-6 py-4">Tipo</th>
                          <th className="px-6 py-4 text-center">Incluir no Saldo?</th>
                          <th className="px-6 py-4 text-right">Saldo Atual</th>
                        </tr>
                      </thead>
                      <tbody className="text-sm text-slate-700 divide-y divide-slate-50">
                        {filteredAccountBalances.map((acc) => (
                          <tr key={acc.id} className={`hover:bg-slate-50/50 transition-colors group ${!acc.includeInSaldoTotal ? 'opacity-65' : ''}`}>
                            <td className="px-6 py-4">
                              <span className="flex items-center gap-3">
                                <div className="w-8 h-8 shrink-0 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center font-bold text-xs shadow-sm shadow-violet-100/50">
                                  {acc.bankName ? acc.bankName.charAt(0).toUpperCase() : 'B'}
                                </div>
                                <div>
                                  <span className="font-bold text-slate-800 max-w-[200px] truncate block" title={acc.bankName}>{acc.bankName}</span>
                                  <span className="text-[10px] text-slate-400 block font-medium">{acc.accountLabel || acc.accountName} {acc.number ? `• Ag/Cc: ${acc.number}` : ''}</span>
                                </div>
                              </span>
                            </td>
                            <td className="px-6 py-4 text-xs font-semibold text-slate-500 capitalize">
                              <div className="flex flex-col">
                                <span>
                                  {acc.accountType === 'BANK' ? 'Conta Corrente' : 
                                   acc.accountType === 'CREDIT' ? 'Cartão de Crédito' : 
                                   acc.accountType === 'SAVINGS' ? 'Poupança' : 
                                   acc.accountType === 'INVESTMENT' ? 'Investimento' :
                                   acc.accountType || 'Banco'}
                                </span>
                                <span className={`text-[9.5px] font-bold ${acc.provider === 'manual' ? 'text-amber-600' : 'text-indigo-600'}`}>
                                  {acc.provider === 'manual' ? 'Manual' : 'Sincronizado'}
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <button 
                                onClick={() => handleToggleIncludeInTotal(acc.id!, acc.includeInSaldoTotal)}
                                className="mx-auto flex items-center justify-center p-1 rounded-lg hover:bg-slate-100 transition-all focus:outline-none"
                                title={acc.includeInSaldoTotal ? "Incluído na soma de Saldo Total" : "Ignorado na soma de Saldo Total"}
                              >
                                {acc.includeInSaldoTotal ? (
                                  <ToggleRight className="w-8 h-8 text-emerald-600" />
                                ) : (
                                  <ToggleLeft className="w-8 h-8 text-slate-300" />
                                )}
                              </button>
                            </td>
                            <td className={`px-6 py-4 text-right ${acc.balance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                              <div className="flex flex-col items-end">
                                <span className="font-black text-sm">{formatMoeda(acc.balance)}</span>
                                {acc.provider === 'manual' ? (
                                  <div className="flex gap-2.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); handleStartEditManual(acc); }}
                                      className="text-[9px] font-bold text-emerald-600 hover:underline uppercase"
                                    >
                                      Editar
                                    </button>
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); if (confirm('Excluir esta conta manual?')) handleDeleteManualAccount(acc.id!); }}
                                      className="text-[9px] font-bold text-rose-600 hover:underline uppercase"
                                    >
                                      Excluir
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-[9px] text-slate-400 font-bold uppercase mt-1">Sincronizado</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Mobile View */}
                    <div className="sm:hidden divide-y divide-slate-50">
                      {filteredAccountBalances.map((acc) => (
                        <div key={acc.id} className={`p-4 flex flex-col gap-3 ${!acc.includeInSaldoTotal ? 'opacity-65' : ''}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 shrink-0 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center font-black text-sm shadow-sm">
                                {acc.bankName ? acc.bankName.charAt(0).toUpperCase() : 'B'}
                              </div>
                              <div>
                                <div className="font-bold text-slate-800 text-sm truncate max-w-[150px]">{acc.bankName}</div>
                                <div className="text-[10px] text-slate-400 font-medium">{acc.accountLabel || acc.accountName} {acc.number ? `• cc: ${acc.number}` : ''}</div>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className={`text-[8px] font-black uppercase tracking-wider px-1 rounded ${acc.provider === 'manual' ? 'bg-amber-50 text-amber-600 border border-amber-100' : 'bg-indigo-50 text-indigo-600 border border-indigo-100'}`}>
                                    {acc.provider === 'manual' ? 'Manual' : 'Sinc'}
                                  </span>
                                  <span className="text-[8px] font-bold text-slate-450 uppercase">
                                    {acc.accountType === 'BANK' ? 'C. Corrente' : 
                                     acc.accountType === 'CREDIT' ? 'Cartão' : 
                                     acc.accountType === 'SAVINGS' ? 'Poupança' : 
                                     acc.accountType === 'INVESTMENT' ? 'Investimento' : 'Banco'}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="text-right flex flex-col items-end">
                              <div className={`text-sm font-black ${acc.balance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {formatMoeda(acc.balance)}
                              </div>
                              {acc.provider === 'manual' && (
                                <div className="flex gap-2.5 mt-1">
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); handleStartEditManual(acc); }}
                                    className="text-[9px] font-bold text-emerald-600 hover:underline uppercase"
                                  >
                                    Editar
                                  </button>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); if (confirm('Excluir esta conta manual?')) handleDeleteManualAccount(acc.id!); }}
                                    className="text-[9px] font-bold text-rose-600 hover:underline uppercase"
                                  >
                                    Excluir
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between bg-slate-50 p-2 rounded-xl text-xs">
                            <span className="font-medium text-slate-500">Incluir no Saldo Total:</span>
                            <button 
                              onClick={() => handleToggleIncludeInTotal(acc.id!, acc.includeInSaldoTotal)}
                              className="flex items-center focus:outline-none animate-none"
                            >
                              {acc.includeInSaldoTotal ? (
                                <span className="text-emerald-600 font-bold flex items-center gap-1">Sim <ToggleRight className="w-6 h-6 animate-none" /></span>
                              ) : (
                                <span className="text-slate-400 font-medium flex items-center gap-1">Não <ToggleLeft className="w-6 h-6 animate-none" /></span>
                              )}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4 pb-20 sm:pb-0">
                {/* Desktop Table */}
                <div className="hidden sm:block bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50/50">
                      <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                        <th className="px-6 py-4">Data</th>
                        <th className="px-6 py-4">Categoria</th>
                        <th className="px-6 py-4">Descrição</th>
                        <th className="px-6 py-4 text-right pr-6 font-black uppercase tracking-widest text-[10px] text-slate-400">Ações / Valor</th>
                      </tr>
                    </thead>
                    <tbody className="text-xs text-slate-700 divide-y divide-slate-50">
                      {filteredModalData.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-6 py-12 text-center text-slate-400 font-bold italic">Nenhum registro encontrado.</td>
                        </tr>
                      ) : (
                        filteredModalData.map((item, i) => (
                          <tr key={i} className="hover:bg-slate-50/50 transition-colors group">
                            <td className="px-6 py-4 text-slate-400 font-bold whitespace-nowrap">{item.date}</td>
                            <td className="px-6 py-4">
                              <span className="inline-block align-middle text-center max-w-[130px] truncate px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-tighter bg-slate-50 text-slate-500 border border-slate-100" title={item.cat}>
                                {item.cat}
                              </span>
                            </td>
                            <td className="px-6 py-4 font-bold text-slate-700 max-w-[240px] truncate" title={item.desc}>
                              <div className="flex items-center gap-2">
                                <span className="truncate">{item.desc}</span>
                                {item.needsReview && (
                                  <span className="shrink-0 bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider animate-pulse flex items-center gap-0.5" title="Classificação de baixa confiança. Clique para revisar ou editar.">
                                    <Sparkles className="w-2 h-2" /> Revisar
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className={`px-6 py-4 text-right pr-6 ${item.type === 'Despesa' ? 'text-rose-600' : 'text-emerald-600'}`}>
                              <div className="flex flex-col items-end">
                                <span className="font-black text-sm tracking-tight" >
                                  {item.type === 'Despesa' ? '-' : '+'} {formatMoeda(Math.abs(item.amount))}
                                </span>
                                <div className="flex gap-3 mt-1.5 opacity-0 group-hover:opacity-100 transition-all transform translate-y-1 group-hover:translate-y-0">
                                  <button onClick={(e) => { e.stopPropagation(); onEditTransaction(item); handleCloseModal(); }} className="text-[9px] font-black text-emerald-600 uppercase tracking-widest hover:underline">Editar</button>
                                  <button onClick={(e) => { e.stopPropagation(); setDeletingId(item.id || null); if(deletingId === item.id) handleDelete(item.id); }} className="text-[9px] font-black text-rose-600 uppercase tracking-widest hover:underline">{deletingId === item.id ? 'Confirmar?' : 'Excluir'}</button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card List moved from Dashboard */}
                <div className="sm:hidden flex flex-col gap-3">
                  {filteredModalData.length === 0 ? (
                    <div className="px-6 py-12 text-center text-slate-400 font-bold italic">Nenhum registro encontrado.</div>
                  ) : filteredModalData.map((item, i) => {
                    const isDespesa = item.type === 'Despesa';
                    return (
                      <div 
                        key={item.id || i} 
                        onClick={() => { onEditTransaction(item); handleCloseModal(); }}
                        className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm active:bg-slate-50 transition-colors"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1 min-w-0 pr-4">
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{item.date}</div>
                            <div className="flex items-center gap-1.5">
                              <h4 className="font-bold text-slate-800 text-sm truncate uppercase tracking-tight flex-1">{item.desc}</h4>
                              {item.needsReview && (
                                <span className="shrink-0 bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider animate-pulse">
                                  Revisar
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right flex flex-col items-end">
                            <span className={`text-[13px] font-black tracking-tight ${isDespesa ? 'text-rose-600' : 'text-emerald-600'}`}>
                              {isDespesa ? '-' : '+'} {formatMoeda(Math.abs(item.amount))}
                            </span>
                            <span className={`text-[9px] font-black uppercase tracking-tighter mt-1 px-1.5 py-0.5 rounded ${isDespesa ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                              {item.type}
                            </span>
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between mt-4">
                          <div className="flex items-center gap-1.5">
                            <div className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[9px] font-black uppercase tracking-tighter flex items-center gap-1">
                              <Tag className="w-2.5 h-2.5" />
                              <span className="max-w-[80px] truncate">{item.cat}</span>
                            </div>
                            <div className="px-2 py-0.5 bg-indigo-50 text-indigo-500 rounded text-[9px] font-black uppercase tracking-tighter flex items-center gap-1">
                              <CreditCard className="w-2.5 h-2.5" />
                              <span className="max-w-[80px] truncate">{item.source}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button onClick={(e) => { e.stopPropagation(); onEditTransaction(item); handleCloseModal(); }} className="p-1.5 text-slate-400 active:bg-emerald-50 active:text-emerald-600 rounded-lg">
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                setDeletingId(item.id || null);
                                setShowDeleteConfirmMobile(item.id || null);
                              }} 
                              className={`p-1.5 rounded-lg transition-all ${deletingId === item.id ? 'bg-rose-600 text-white animate-pulse' : 'text-slate-400 active:bg-rose-50'}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          
          {/* Footer */}
          <div className="px-5 sm:px-8 py-4 bg-slate-50 border-t border-slate-100 text-center flex-shrink-0">
            <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">
              FinCanvas • {modalType === 'saldo-total' ? 'Inteligência Consolidada' : 'Filtros Dinâmicos Ativos'}
            </p>
          </div>
        </div>
      </div>
    )}

      {/* Mobile Delete Confirmation Modal */}
      {showDeleteConfirmMobile && (
        <div className="fixed inset-0 bg-slate-900/40 z-[70] flex flex-col justify-end backdrop-blur-sm sm:hidden transition-all" onClick={() => { setShowDeleteConfirmMobile(null); setDeletingId(null); }} 
             style={{ 
               opacity: deleteDragY > 0 ? 1 - (deleteDragY / 500) : 1,
               height: viewportHeight > 0 && typeof window !== 'undefined' && window.innerWidth < 640 ? `${viewportHeight}px` : undefined,
               top: offsetTop > 0 && typeof window !== 'undefined' && window.innerWidth < 640 ? `${offsetTop}px` : undefined,
             }}>
          <div 
            className="bg-white rounded-t-[32px] shadow-2xl w-full p-6 animate-in slide-in-from-bottom-10 duration-300 relative pb-10 flex flex-col"
            onClick={e => e.stopPropagation()}
            style={{ 
                maxHeight: '90%',
                transform: deleteDragY > 0 ? `translateY(${deleteDragY}px)` : 'translateY(0)' 
            }}
          >
            <div className="flex-1 overflow-y-auto w-full">
            <div 
              className="w-full absolute top-0 left-0 h-10 flex items-center justify-center cursor-grab active:cursor-grabbing"
              onTouchStart={handleDeleteTouchStart} 
              onTouchMove={handleDeleteTouchMove} 
              onTouchEnd={handleDeleteTouchEnd}
            >
              <div className="w-12 h-1.5 bg-slate-200 rounded-full" />
            </div>
            
            <div className="flex flex-col items-center text-center mt-6">
              <div className="bg-rose-50 w-16 h-16 rounded-full flex items-center justify-center mb-4">
                <Trash2 className="w-8 h-8 text-rose-500" />
              </div>
              <h3 className="text-xl font-black text-slate-800 tracking-tight uppercase mb-2">Excluir Transação?</h3>
              <p className="text-sm text-slate-500 mb-8 max-w-xs mx-auto">
                Esta ação não pode ser desfeita. Deseja realmente remover este registro?
              </p>
              
              <div className="flex flex-col w-full gap-3">
                <button 
                  onClick={() => {
                     handleDelete(showDeleteConfirmMobile);
                     setShowDeleteConfirmMobile(null);
                     setDeletingId(null);
                  }}
                  className="w-full py-4 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-2xl shadow-sm text-sm active:scale-[0.98] transition-all"
                >
                  Sim, excluir agora
                </button>
                <button 
                  onClick={() => {
                    setShowDeleteConfirmMobile(null);
                    setDeletingId(null);
                  }}
                  className="w-full py-4 bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold rounded-2xl text-sm active:scale-[0.98] transition-all"
                >
                  Cancelar
                </button>
              </div>
            </div>
            </div>
          </div>
        </div>
      )}
      <AIConfirmationModal isOpen={showConfirmModal} onConfirm={handleConfirmAI} onCancel={() => { setShowConfirmModal(false); setPendingAIAction(null); }} />
    </div>
  );
});
