import React, { useState, useMemo, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { Transaction, AccountBalance } from '../App';
import { 
  PieChart as PieChartIcon, 
  Sparkles, 
  Loader2, 
  Printer, 
  CheckCircle2, 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  Wallet,
  Calendar,
  LayoutDashboard,
  BrainCircuit,
  AlertCircle,
  Tag,
  Search,
  X,
  Plus,
  Filter,
  CreditCard,
  FileDown,
  Edit3,
  Trash2,
  ToggleLeft,
  ToggleRight
} from 'lucide-react';
import { secureGenerateContent, fetchAISettings } from '../lib/gemini';
import html2pdf from 'html2pdf.js';
import { deleteDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { toast } from 'sonner';
import { AIConfirmationModal } from './AIConfirmationModal';

import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip, 
  Legend, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid
} from 'recharts';
import { format, parse } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { PeriodFilterToolbar } from './PeriodFilterToolbar';
import { FilterConfig } from '../App';
import { EmptyState } from './EmptyState';

import { PullToRefresh } from './PullToRefresh';

interface ReportsViewProps {
  transactions: Transaction[];
  loadingTransactions?: boolean;
  filterConfig: FilterConfig;
  setFilterConfig: (config: FilterConfig) => void;
  onEditTransaction?: (t: Transaction) => void;
  onOpenManualEntry?: () => void;
  onNavigateImport: () => void;
  accountBalances: AccountBalance[];
}




const COLORS = ['#10b981', '#f43f5e', '#3b82f6', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#71717a'];

export const ReportsView = React.memo(function ReportsView({ 
  transactions, 
  loadingTransactions,
  filterConfig, 
  setFilterConfig,
  onEditTransaction,
  onOpenManualEntry,
  onNavigateImport,
  accountBalances
}: ReportsViewProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'ai'>('overview');
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadingMessage, setLoadingMessage] = useState('Sincronizando modelos financeiros...');

  const [aiSettings, setAiSettings] = useState<{ aiEnabled: boolean; aiUseForReports: boolean } | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [hasPendingGenerate, setHasPendingGenerate] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await fetchAISettings();
        if (settings) {
          setAiSettings({
            aiEnabled: settings.aiEnabled,
            aiUseForReports: settings.aiUseForReports
          });
        }
      } catch (e) {
        console.error("Failed to load AI settings in ReportsView:", e);
      }
    };
    loadSettings();
  }, [transactions]);

  const handleConfirmAI = async (dontAskAgain: boolean) => {
    setShowConfirmModal(false);
    if (dontAskAgain) {
      sessionStorage.setItem('ai_bypass_confirm', 'true');
    }
    if (hasPendingGenerate) {
      setHasPendingGenerate(false);
      await runGenerate();
    }
  };
  
  // Modal for Details
  const [modalDetail, setModalDetail] = useState<{ type: 'category' | 'income' | 'expense' | 'balance' | 'savings', title: string, value?: string } | null>(null);
  const [modalSearchTerm, setModalSearchTerm] = useState('');
  const [modalFilterDate, setModalFilterDate] = useState('');
  const [modalFilterCat, setModalFilterCat] = useState('');
  const [showModalFiltersMobile, setShowModalFiltersMobile] = useState(false);
  const [modalFilterAmountType, setModalFilterAmountType] = useState<'' | 'greater' | 'less' | 'equal'>('');
  const [modalFilterAmount, setModalFilterAmount] = useState('');
  const [dragY, setDragY] = useState(0);
  const startYRef = useRef(0);

  const handleRefresh = async () => {
    // Simulate network delay for pull to refresh
    await new Promise(resolve => setTimeout(resolve, 800));
  };
  
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
    if (dragY > 100) {
      handleCloseModal();
      setTimeout(() => setDragY(0), 300);
    } else {
      setDragY(0);
    }
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDeleteConfirmMobile, setShowDeleteConfirmMobile] = useState<string | null>(null);
  const [deleteDragY, setDeleteDragY] = useState(0);
  const deleteStartYRef = useRef(0);

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

  const handleDelete = async (id?: string) => {
    if (!id) return;
    try {
      await deleteDoc(doc(db, 'transactions', id));
      toast.success('Movimentação excluída com sucesso!');
      setDeletingId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `transactions/${id}`);
      toast.error('Erro ao excluir movimentação.');
    }
  };

  const handleCloseModal = () => {
    setModalDetail(null);
    setModalSearchTerm('');
    setModalFilterDate('');
    setModalFilterCat('');
    setShowModalFiltersMobile(false);
    setModalFilterAmountType('');
    setModalFilterAmount('');
    setDragY(0);
  };

  const handleToggleIncludeInTotal = async (accId: string, currentValue: boolean) => {
    try {
      const docRef = doc(db, 'accountBalances', accId);
      await updateDoc(docRef, {
        includeInSaldoTotal: !currentValue,
        updatedAt: serverTimestamp()
      });
      toast.success(
        !currentValue 
          ? 'Conta incluída no cálculo do Saldo Total.' 
          : 'Conta desconsiderada do cálculo do Saldo Total.'
      );
    } catch (err: any) {
      console.error(err);
      toast.error('Erro ao atualizar status do cálculo: ' + err.message);
    }
  };

  const handleDateMask = (value: string) => {
    let val = value.replace(/\D/g, '');
    if (val.length > 8) val = val.substring(0, 8);
    if (val.length >= 5) return val.substring(0, 2) + '/' + val.substring(2, 4) + '/' + val.substring(4);
    if (val.length >= 3) return val.substring(0, 2) + '/' + val.substring(2);
    return val;
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

  // 1. Data Processing for Charts
  const stats = useMemo(() => {
    // Aggregates
    const totalIncome = currentMonthTransactions.filter(t => t.type === 'Receita').reduce((sum, t) => sum + t.amount, 0);
    const totalExpense = currentMonthTransactions.filter(t => t.type === 'Despesa').reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const balance = totalIncome - totalExpense;
    const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : 0;

    // Expenses by Category
    const categoryMap: Record<string, number> = {};
    currentMonthTransactions.filter(t => t.type === 'Despesa').forEach(t => {
      categoryMap[t.cat] = (categoryMap[t.cat] || 0) + Math.abs(t.amount);
    });

    const categoryData = Object.entries(categoryMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // Monthly Trends (Last 6 months) - This should show history regardless of current filter
    const monthlyMap: Record<string, { month: string, receita: number, despesa: number }> = {};
    
    let overallBalance = 0;
    if (accountBalances && accountBalances.length > 0) {
      accountBalances.forEach(acc => {
        if (acc.includeInSaldoTotal) {
          overallBalance += acc.balance;
        }
      });
    }

    transactions.forEach(t => {
      try {
        const date = parse(t.date, 'dd/MM/yyyy', new Date());
        const monthKey = format(date, 'MMM/yy', { locale: ptBR });
        
        if (!monthlyMap[monthKey]) {
          monthlyMap[monthKey] = { month: monthKey, receita: 0, despesa: 0 };
        }
        
        if (t.type === 'Receita') {
          monthlyMap[monthKey].receita += t.amount;
        } else {
          monthlyMap[monthKey].despesa += Math.abs(t.amount);
        }
      } catch (e) {
        // Skip invalid dates
      }
    });

    const monthlyData = Object.values(monthlyMap).reverse().slice(-6);

    return { totalIncome, totalExpense, balance, savingsRate, categoryData, monthlyData, overallBalance };
  }, [currentMonthTransactions, transactions, accountBalances]);

  const getTransactionsFingerprint = (txs: Transaction[]) => {
    return txs
      .map(t => `${t.id || ''}:${t.amount}:${t.desc}:${t.date}:${t.cat}:${t.source || ''}`)
      .join('|');
  };

  const getCacheKey = () => {
    const periodStr = `${filterConfig.type}_${filterConfig.month}_${filterConfig.year}_${filterConfig.startDate || ''}_${filterConfig.endDate || ''}`;
    return `fincanvas_ai_report_${periodStr}`;
  };

  // Auto-load cached report if it exists and matches current transactions fingerprint
  useEffect(() => {
    const currentFingerprint = getTransactionsFingerprint(currentMonthTransactions);
    const cacheKey = getCacheKey();
    const cachedDataStr = localStorage.getItem(cacheKey);
    if (cachedDataStr) {
      try {
        const cached = JSON.parse(cachedDataStr);
        if (cached.fingerprint === currentFingerprint) {
          setReportHtml(cached.reportHtml);
          return;
        }
      } catch (e) {
        console.error('Error reading cache:', e);
      }
    }
    setReportHtml(null); // Reset if fingerprint doesn't match or doesn't exist
  }, [currentMonthTransactions, filterConfig]);

  const runGenerate = async () => {
    setLoading(true);
    setError('');
    setActiveTab('ai'); // Ensure tab is active so we see loader
    
    const messages = [
      'Sincronizando dados de transações...',
      'Analisando categorias e cruzando padrões...',
      'Executando projeções de tendência futura...',
      'Computando recomendações personalizadas...'
    ];
    
    let msgIndex = 0;
    setLoadingMessage(messages[0]);
    const messageInterval = setInterval(() => {
      msgIndex++;
      if (msgIndex < messages.length) {
        setLoadingMessage(messages[msgIndex]);
      }
    }, 450);

    const finishLoading = (content: string) => {
      clearInterval(messageInterval);
      setReportHtml(content);
      setLoading(false);
    };

    try {
      const currentFingerprint = getTransactionsFingerprint(currentMonthTransactions);
      const cacheKey = getCacheKey();
      const cachedDataStr = localStorage.getItem(cacheKey);
      
      if (cachedDataStr) {
        try {
          const cached = JSON.parse(cachedDataStr);
          if (cached.fingerprint === currentFingerprint) {
            // Simulated delay for cached content to look genuine
            setTimeout(() => {
              finishLoading(cached.reportHtml);
            }, 1800);
            return;
          }
        } catch (e) {
          console.error('Error reading cached report:', e);
        }
      }

      // If no valid cache or dirty data, call the real API
      const summary = currentMonthTransactions.slice(0, 100).map(d => `- ${d.date}: ${d.desc} (${d.cat}) -> R$ ${d.amount}`).join('\n');
      const promptText = `Atue como um Consultor Financeiro de elite. Analise minuciosamente os seguintes dados de transações do período selecionado:
      ${summary}
      
      Total Receitas: R$ ${stats.totalIncome.toFixed(2)}
      Total Despesas: R$ ${stats.totalExpense.toFixed(2)}
      Saldo: R$ ${stats.balance.toFixed(2)}
      
      Crie um relatório estratégico formatado em Markdown transparente (use headers, listas e negritos), contendo:
      1. Análise Crítica do Comportamento (onde o usuário está falhando ou acertando)
      2. Alerta de Categorias (quais categorias estão acima do normal)
      3. Projeção de Futuro (se continuar assim, o que acontece em 6 meses)
      4. 5 Recomendações Práticas e Imediatas
      
      Use tabelas Markdown simples se necessário. Responda em Português.`;

      const response = await secureGenerateContent({
        task: 'report',
        model: 'gemini-3.5-flash',
        contents: promptText
      });
      
      let content = response.text || '';
      content = content.replace(/```markdown/gi, '').replace(/```/g, '').trim();
      
      // Save to cache
      localStorage.setItem(cacheKey, JSON.stringify({
        fingerprint: currentFingerprint,
        reportHtml: content
      }));

      // A small added delay so it doesn't instantly flip if the API responds too fast
      setTimeout(() => {
        finishLoading(content);
      }, 500);

    } catch (e: any) {
      clearInterval(messageInterval);
      setError(e.message || 'Erro na geração do relatório.');
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (currentMonthTransactions.length === 0) return;
    
    const settings = await fetchAISettings();
    if (!settings || !settings.aiEnabled || !settings.aiUseForReports) {
      const warningText = "Geração de relatórios por IA desativada. Ative em Preferências > Inteligência Artificial.";
      toast.error(warningText);
      setError(warningText);
      return;
    }

    const bypass = sessionStorage.getItem('ai_bypass_confirm') === 'true';
    const needsConfirm = (settings.aiAlwaysAskBeforeSending ?? true) && !bypass;

    if (needsConfirm) {
      setHasPendingGenerate(true);
      setShowConfirmModal(true);
      return;
    }

    await runGenerate();
  };

  const [isPrinting, setIsPrinting] = useState(false);

  const handlePrint = async () => {
    const reportElement = document.querySelector('.ai-report-content') as HTMLElement;
    if (!reportElement || isPrinting) return;

    setIsPrinting(true);

    // Create a hidden iframe
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.bottom = '0';
    iframe.style.right = '0';
    iframe.style.width = '800px';
    iframe.style.height = '600px';
    iframe.style.border = 'none';
    iframe.style.zIndex = '-9999';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      setIsPrinting(false);
      document.body.removeChild(iframe);
      return;
    }

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Relatório AI</title>
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; 
              color: #1e293b; 
              background: #ffffff; 
              margin: 0; 
              padding: 20px;
              line-height: 1.5;
            }
            .pdf-container {
              max-width: 720px;
              margin: 0 auto;
            }
            h1 { font-size: 20px; color: #047857; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-top: 0; margin-bottom: 16px; text-align: left; }
            h2 { font-size: 16px; color: #1e293b; border-bottom: 1px solid #f1f5f9; padding-bottom: 4px; margin-top: 24px; margin-bottom: 12px; text-align: left; }
            h3 { font-size: 13px; color: #334155; margin-top: 16px; margin-bottom: 8px; text-align: left; }
            p { font-size: 12px; color: #475569; margin-bottom: 12px; text-align: left; }
            ul { margin-bottom: 16px; padding-left: 20px; text-align: left; }
            li { font-size: 12px; color: #475569; margin-bottom: 6px; text-align: left; }
            table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 11px; text-align: left; }
            th { background-color: #f8fafc; color: #64748b; font-weight: 700; text-transform: uppercase; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: left; }
            td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; color: #475569; text-align: left; }
            strong, b { color: #0f172a; font-weight: 700; }
          </style>
        </head>
        <body>
          <div class="pdf-container">
            <div style="border-bottom: 3px solid #10b981; padding-bottom: 12px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between;">
              <div style="text-align: left;">
                <h4 style="font-size: 16px; font-weight: 900; color: #0f172a; margin: 0;">FinCanvas IA</h4>
                <span style="font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.1em;">Relatório Estratégico Consolidado</span>
              </div>
              <span style="font-size: 10px; color: #64748b;">Gerado em ${new Date().toLocaleDateString('pt-BR')}</span>
            </div>
            <div id="pdf-content">${reportElement.innerHTML}</div>
          </div>
        </body>
      </html>
    `);
    doc.close();

    // Small delay to ensure the browser has loaded the DOM inside the iframe
    await new Promise(resolve => setTimeout(resolve, 300));

    const printContent = doc.getElementById('pdf-content');

    try {
      const opt = {
        margin:       [15, 15, 15, 15] as [number, number, number, number],
        filename:     `FinCanvas_AI_Relatorio.pdf`,
        image:        { type: 'jpeg' as const, quality: 0.98 },
        html2canvas:  { 
          scale: 2, 
          useCORS: true, 
          logging: false,
          windowWidth: 800
        },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' } as any
      };
      
      await html2pdf().set(opt).from(printContent || doc.body).save();
    } catch (err) {
      console.error('PDF Generation Failed', err);
    } finally {
      document.body.removeChild(iframe);
      setIsPrinting(false);
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
    return <EmptyState onNavigateImport={onNavigateImport} />;
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-50/50">
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .ai-report-content, .ai-report-content * {
            visibility: visible;
          }
          .ai-report-content {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 20mm;
            background: white;
          }
          /* Hide scrollbars during print */
          ::-webkit-scrollbar {
            display: none;
          }
        }
      `}</style>
      <header className="min-h-0 md:min-h-[4rem] py-2 md:py-3 flex-shrink-0 bg-white border-b border-slate-200 flex flex-col xl:flex-row xl:items-center justify-between px-3 md:px-8 z-10 shadow-sm print:hidden gap-2 md:gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 w-full xl:w-auto">
          <h1 className="text-lg font-extrabold text-slate-800 tracking-tight hidden lg:block whitespace-nowrap flex-shrink-0">Análise & Relatórios</h1>
          <div className="w-full sm:w-auto">
            <PeriodFilterToolbar filterConfig={filterConfig} setFilterConfig={setFilterConfig} />
          </div>
        </div>
        <div className="flex items-center gap-4 w-full xl:w-auto justify-end mb-1 md:mb-0">
          <nav className="flex p-1 bg-slate-100/80 rounded-xl md:rounded-lg w-full sm:w-auto">
            <button 
              onClick={() => setActiveTab('overview')}
              className={`flex-1 sm:flex-none justify-center flex items-center gap-2 px-2 md:px-3 py-1.5 rounded-md text-[10px] md:text-xs font-bold transition-all ${activeTab === 'overview' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" /> <span className="inline">Dashboard</span>
            </button>
            <button 
              onClick={() => setActiveTab('ai')}
              className={`flex-1 sm:flex-none justify-center flex items-center gap-2 px-2 md:px-3 py-1.5 rounded-md text-[10px] md:text-xs font-bold transition-all ${activeTab === 'ai' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <BrainCircuit className="w-3.5 h-3.5" /> <span className="inline">Mentoria IA</span>
            </button>
          </nav>
        </div>
        
        {activeTab === 'ai' && reportHtml && !loading && (
          <button 
            onClick={handlePrint} 
            disabled={isPrinting}
            className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 font-bold uppercase tracking-wider transition-all flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPrinting ? (
              <><Loader2 className="w-3 h-3 mr-2 animate-spin text-slate-600" /> Gerando PDF...</>
            ) : (
              <><Printer className="w-3 h-3 mr-2" /> PDF / Impressão</>
            )}
          </button>
        )}
      </header>
      
      <PullToRefresh
        onRefresh={handleRefresh}
        className={`flex-1 flex flex-col min-h-0 w-full`}
        innerClassName={`flex-1 px-3 py-1.5 md:p-8 w-full md:pb-8 flex flex-col ${activeTab === 'overview' ? 'overflow-y-auto pb-32 sm:pb-24' : 'overflow-hidden pb-32 sm:pb-24 min-h-0'}`}
      >
        <div className={`max-w-6xl mx-auto w-full ${activeTab === 'overview' ? 'space-y-3 sm:space-y-6' : 'flex-1 flex flex-col'}`}>
          
          {activeTab === 'overview' ? (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <button 
                  onClick={() => setModalDetail({ type: 'income', title: 'Receitas' })}
                  className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm group hover:border-emerald-200 transition-colors flex flex-row sm:flex-col items-center sm:items-start justify-between active:scale-[0.98] text-left gap-2 sm:gap-0"
                >
                  <div className="order-2 sm:order-1 flex items-center justify-between sm:mb-3 shrink-0 sm:w-full">
                    <div className="p-1.5 sm:p-2 bg-emerald-50 text-emerald-600 rounded-lg sm:rounded-lg group-hover:scale-110 transition-transform">
                      <TrendingUp className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                    </div>
                  </div>
                  <div className="order-1 sm:order-2 w-full flex-1 min-w-0 pr-1 sm:pr-0">
                    <h4 className="text-[10px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest text-left mb-0.5">Receita</h4>
                    <p className="text-[13px] min-[360px]:text-[14px] min-[400px]:text-[15px] sm:text-xl font-black text-slate-800 text-left whitespace-nowrap tracking-tighter">R$ {stats.totalIncome.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  </div>
                </button>

                <button 
                  onClick={() => setModalDetail({ type: 'expense', title: 'Despesas' })}
                  className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm group hover:border-rose-200 transition-colors flex flex-row sm:flex-col items-center sm:items-start justify-between active:scale-[0.98] text-left gap-2 sm:gap-0"
                >
                  <div className="order-2 sm:order-1 flex items-center justify-between sm:mb-3 shrink-0 sm:w-full">
                    <div className="p-1.5 sm:p-2 bg-rose-50 text-rose-600 rounded-lg sm:rounded-lg group-hover:scale-110 transition-transform">
                      <TrendingDown className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                    </div>
                  </div>
                  <div className="order-1 sm:order-2 w-full flex-1 min-w-0 pr-1 sm:pr-0">
                    <h4 className="text-[10px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest text-left mb-0.5">Despesa</h4>
                    <p className="text-[13px] min-[360px]:text-[14px] min-[400px]:text-[15px] sm:text-xl font-black text-slate-800 text-left whitespace-nowrap tracking-tighter">R$ {stats.totalExpense.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  </div>
                </button>

                <button 
                  onClick={() => setModalDetail({ type: 'balance', title: 'Saldo Disponível' })}
                  className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm group hover:border-blue-200 transition-colors flex flex-row sm:flex-col items-center sm:items-start justify-between active:scale-[0.98] text-left gap-2 sm:gap-0"
                >
                  <div className="order-2 sm:order-1 flex items-center justify-between sm:mb-3 shrink-0 sm:w-full">
                    <div className="p-1.5 sm:p-2 bg-blue-50 text-blue-600 rounded-lg sm:rounded-lg group-hover:scale-110 transition-transform">
                      <Wallet className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                    </div>
                  </div>
                  <div className="order-1 sm:order-2 w-full flex-1 min-w-0 pr-1 sm:pr-0">
                    <h4 className="text-[10px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest text-left mb-0.5">Saldo</h4>
                    <p className={`text-[13px] min-[360px]:text-[14px] min-[400px]:text-[15px] sm:text-xl font-black text-left whitespace-nowrap tracking-tighter ${stats.balance >= 0 ? 'text-slate-800' : 'text-rose-600'}`}>
                      R$ {stats.balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </button>

                <button 
                  onClick={() => setModalDetail({ type: 'savings', title: 'Saldo Total' })}
                  className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm group hover:border-violet-200 transition-colors flex flex-row sm:flex-col items-center sm:items-start justify-between active:scale-[0.98] text-left gap-2 sm:gap-0"
                >
                  <div className="order-2 sm:order-1 flex items-center justify-between sm:mb-3 shrink-0 sm:w-full">
                    <div className="p-1.5 sm:p-2 bg-violet-50 text-violet-600 rounded-lg sm:rounded-lg group-hover:scale-110 transition-transform">
                      <Wallet className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                    </div>
                  </div>
                  <div className="order-1 sm:order-2 w-full flex-1 min-w-0 pr-1 sm:pr-0">
                    <h4 className="text-[10px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest text-left mb-0.5">Saldo Total</h4>
                    <p className={`text-[13px] min-[360px]:text-[14px] min-[400px]:text-[15px] sm:text-xl font-black text-left whitespace-nowrap tracking-tighter ${stats.overallBalance >= 0 ? 'text-slate-800' : 'text-rose-600'}`}>
                      R$ {stats.overallBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </button>
              </div>

              {/* Charts Section */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 1. Category Distribution */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-h-[420px] flex flex-col [&_.recharts-wrapper]:outline-none [&_svg]:outline-none [&_.recharts-surface]:outline-none">
                  <h3 className="text-sm font-bold text-slate-800 mb-6 flex items-center gap-2">
                    <PieChartIcon className="w-4 h-4 text-emerald-500" />
                    Distribuição por Categoria
                  </h3>
                  <div className="flex-1 flex flex-col justify-center items-center">
                    <div className="w-full h-[200px] sm:h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={stats.categoryData}
                            innerRadius="65%"
                            outerRadius="90%"
                            paddingAngle={2}
                            dataKey="value"
                            stroke="none"
                            onClick={(data) => setModalDetail({ type: 'category', title: `Categoria: ${data.name}`, value: data.name })}
                            style={{ outline: 'none', cursor: 'pointer' }}
                            activeShape={undefined}
                          >
                            {stats.categoryData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} style={{ outline: 'none' }} />
                            ))}
                          </Pie>
                          <Tooltip 
                            formatter={(value: number) => [`R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 'Gasto']}
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px', fontWeight: 'bold' }}
                            itemStyle={{ color: '#334155' }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2 sm:gap-2 mt-4 sm:mt-8 px-0 sm:px-4 w-full pb-2">
                       {stats.categoryData.map((entry, index) => (
                         <div key={`legend-${index}`} className="flex items-center text-[11px] sm:text-[11px] font-bold text-slate-600 bg-white sm:bg-slate-50 border border-slate-200 sm:border-slate-100 px-3 py-2 min-h-[44px] rounded-md sm:rounded-full shadow-[0_2px_8px_-4px_rgba(0,0,0,0.1)] sm:shadow-none hover:bg-slate-50 sm:hover:bg-slate-100 hover:scale-105 transition-all cursor-pointer" onClick={() => setModalDetail({ type: 'category', title: `Categoria: ${entry.name}`, value: entry.name })}>
                           <span className="w-2 h-2 sm:w-2 sm:h-2 rounded-full mr-1.5 sm:mr-2 shrink-0 shadow-sm" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                           <span className="truncate max-w-[100px] sm:max-w-[120px]" title={entry.name}>{entry.name}</span>
                         </div>
                       ))}
                    </div>
                  </div>
                </div>

                {/* 2. Monthly Trends */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm min-h-[420px] flex flex-col [&_.recharts-wrapper]:outline-none [&_svg]:outline-none [&_.recharts-surface]:outline-none [&_*]:outline-none" style={{ WebkitTapHighlightColor: 'transparent' }}>
                  <h3 className="text-sm font-bold text-slate-800 mb-6 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-blue-500" />
                    Evolução Mensal (Últimos 6 meses)
                  </h3>
                  <div className="flex-1">
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={stats.monthlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} style={{ outline: 'none' }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="month" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }} 
                          dy={10}
                        />
                        <YAxis 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }} 
                          tickFormatter={(value) => `R$ ${value >= 1000 ? (value / 1000).toFixed(0) + 'k' : value}`}
                          width={80}
                        />
                        <Tooltip 
                          cursor={{ fill: '#f8fafc', stroke: 'transparent', strokeWidth: 0 }}
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px', fontWeight: 'bold' }}
                          formatter={(value: number) => [`R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`]}
                          itemStyle={{ color: '#334155' }}
                        />
                        <Legend 
                          verticalAlign="bottom" 
                          wrapperStyle={{ paddingTop: '20px' }}
                          iconType="circle"
                          iconSize={8}
                          formatter={(value) => <span className="text-[11px] font-bold text-slate-600 ml-1">{value}</span>}
                        />
                        <Bar name="Receitas" dataKey="receita" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={32} activeBar={false} style={{ outline: 'none' }} />
                        <Bar name="Despesas" dataKey="despesa" fill="#f43f5e" radius={[6, 6, 0, 0]} maxBarSize={32} activeBar={false} style={{ outline: 'none' }} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Detailed Category Table */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-all hover:shadow-md">
                <div className="px-4 sm:px-6 py-5 border-b border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white">
                  <div>
                    <h3 className="text-sm font-black text-slate-800 uppercase tracking-tighter flex items-center gap-2">
                       <Tag className="w-4 h-4 text-emerald-500" />
                       Análise de Gastos por Categoria
                    </h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Onde seu dinheiro está indo neste período</p>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-100">{stats.categoryData.length} Categorias</span>
                </div>
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50/50">
                      <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        <th className="px-6 py-4">Categoria</th>
                        <th className="px-6 py-4">Valor Acumulado</th>
                        <th className="px-6 py-4">Participação</th>
                        <th className="px-6 py-4 text-right">Análise Visual</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {stats.categoryData.length === 0 ? (
                        <tr><td colSpan={4} className="px-6 py-12 text-center text-slate-400 text-xs font-bold">Nenhum gasto registrado neste período.</td></tr>
                      ) : stats.categoryData.map((cat, idx) => {
                        const percentage = stats.totalExpense > 0 ? (cat.value / stats.totalExpense) * 100 : 0;
                        return (
                          <tr 
                            key={cat.name} 
                            onClick={() => setModalDetail({ type: 'category', title: `Categoria: ${cat.name}`, value: cat.name })}
                            className="hover:bg-slate-50/80 transition-all cursor-pointer group active:scale-[0.99]"
                          >
                            <td className="px-6 py-4">
                              <span className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center text-white font-bold text-xs shadow-sm" style={{ backgroundColor: COLORS[idx % COLORS.length] }}>
                                  {cat.name[0].toUpperCase()}
                                </div>
                                <span className="text-xs font-bold text-slate-700 max-w-[120px] sm:max-w-[200px] truncate" title={cat.name}>{cat.name}</span>
                              </span>
                            </td>
                            <td className="px-6 py-4 text-xs font-bold text-slate-800">
                              R$ {cat.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-black text-slate-500 w-10">{percentage.toFixed(1)}%</span>
                                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden min-w-[60px]">
                                  <div 
                                    className="h-full rounded-full transition-all duration-1000 ease-out" 
                                    style={{ 
                                      width: `${percentage}%`, 
                                      backgroundColor: COLORS[idx % COLORS.length] 
                                    }}
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-right">
                               <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${percentage > 30 ? 'bg-rose-50 text-rose-600 border border-rose-100' : percentage > 15 ? 'bg-orange-50 text-orange-600 border border-orange-100' : 'bg-slate-50 text-slate-400 border border-slate-100'}`}>
                                  {percentage > 30 ? 'CRÍTICO' : percentage > 15 ? 'ALTO' : 'NORMAL'}
                               </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="sm:hidden flex flex-col p-4 gap-3 bg-slate-50/50">
                  {stats.categoryData.length === 0 ? (
                    <div className="py-8 text-center text-slate-400 text-xs font-bold">Nenhum gasto registrado neste período.</div>
                  ) : stats.categoryData.map((cat, idx) => {
                    const percentage = stats.totalExpense > 0 ? (cat.value / stats.totalExpense) * 100 : 0;
                    return (
                      <div 
                        key={cat.name} 
                        onClick={() => setModalDetail({ type: 'category', title: `Categoria: ${cat.name}`, value: cat.name })}
                        className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-3 cursor-pointer active:scale-98 transition-all hover:border-slate-300"
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center text-white font-bold text-sm shadow-sm" style={{ backgroundColor: COLORS[idx % COLORS.length] }}>
                              {cat.name[0].toUpperCase()}
                            </div>
                            <div>
                              <div className="text-sm font-bold text-slate-800">{cat.name}</div>
                              <div className="text-xs font-black text-slate-500 mt-0.5">R$ {cat.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                            </div>
                          </div>
                          <span className={`text-[10px] font-black px-2 py-1 rounded-lg ${percentage > 30 ? 'bg-rose-50 text-rose-600 border border-rose-100' : percentage > 15 ? 'bg-orange-50 text-orange-600 border border-orange-100' : 'bg-slate-50 text-slate-500 border border-slate-200'}`}>
                            {percentage > 30 ? 'CRÍTICO' : percentage > 15 ? 'ALTO' : 'NORMAL'}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 w-full bg-slate-50 py-2 px-3 rounded-lg border border-slate-100">
                          <span className="text-xs font-black text-slate-500 shrink-0 w-12">{percentage.toFixed(1)}%</span>
                          <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                            <div 
                              className="h-full rounded-full transition-all duration-1000 ease-out" 
                              style={{ 
                                width: `${percentage}%`, 
                                backgroundColor: COLORS[idx % COLORS.length] 
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Mobile Transaction List moved from Dashboard */}
              <div className="md:hidden bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mt-6">
                <div className="px-4 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-tight">Últimas Movimentações</h3>
                  <button 
                    onClick={onOpenManualEntry}
                    className="p-1.5 bg-emerald-600 text-white rounded-lg shadow-sm active:scale-95 transition-transform"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <div className="divide-y divide-slate-100 min-h-[200px]">
                  {currentMonthTransactions.length === 0 ? (
                    <div className="px-6 py-12 text-center text-slate-400 font-medium text-sm italic">Nenhuma movimentação para exibir.</div>
                  ) : currentMonthTransactions.map((item, i) => {
                    const isDespesa = item.type === 'Despesa';
                    const formatMoeda = (val: number) => val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                    
                    return (
                      <div 
                        key={item.id || i} 
                        onClick={() => onEditTransaction?.(item)}
                        className="p-4 bg-white hover:bg-emerald-50/10 transition-colors cursor-pointer active:bg-slate-50"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1 min-w-0 pr-4">
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">{item.date}</div>
                            <h4 className="font-bold text-slate-800 text-sm truncate leading-snug">{item.desc}</h4>
                          </div>
                          <div className="text-right flex flex-col items-end">
                            <span className={`text-[13px] font-black tracking-tight ${isDespesa ? 'text-rose-600' : 'text-emerald-600'}`}>
                              {isDespesa ? '-' : '+'} {formatMoeda(Math.abs(item.amount))}
                            </span>
                            <span className={`text-[9px] font-black uppercase tracking-tighter mt-0.5 px-1.5 py-0.5 rounded ${isDespesa ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                              {item.type}
                            </span>
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between mt-3">
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
                          <div className="flex items-center gap-1 shadow-sm rounded-lg border border-slate-100 p-0.5">
                            <button 
                              onClick={(e) => { e.stopPropagation(); onEditTransaction?.(item); }}
                              className="p-1.5 text-slate-400 hover:text-emerald-600 active:bg-emerald-50 rounded-md transition-all"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                setDeletingId(item.id || null);
                                setShowDeleteConfirmMobile(item.id || null);
                              }}
                              className={`p-1.5 ${deletingId === item.id ? 'text-rose-600 bg-rose-50' : 'text-slate-400 hover:text-rose-600'} active:scale-90 rounded-md transition-all`}
                            >
                              {deletingId === item.id ? <Trash2 className="w-4 h-4 animate-pulse" /> : <Trash2 className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Botão de Call to Action para Mentoria IA */}
              <div className="bg-gradient-to-r from-emerald-600 to-indigo-600 rounded-2xl p-8 text-white flex flex-col md:flex-row items-center justify-between gap-6 overflow-hidden relative shadow-lg">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <BrainCircuit className="w-48 h-48 rotate-12" />
                </div>
                <div className="relative z-10">
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <Sparkles className="w-6 h-6 text-yellow-300" />
                    Falta algo na sua análise?
                  </h3>
                  <p className="text-emerald-50 text-sm mt-3 max-w-lg text-left">
                    Nossa Inteligência Artificial pode cruzar todos esses dados para te dar insights comportamentais que números sozinhos não revelam. Quer saber como economizar 15% a mais mês que vem?
                  </p>
                </div>
                <button 
                  onClick={handleGenerate}
                  disabled={loading}
                  className="relative z-10 px-6 py-3 bg-white text-slate-800 font-bold rounded-xl shadow-lg hover:shadow-xl transition-all active:scale-95 text-xs uppercase tracking-widest flex items-center gap-2 disabled:opacity-80 disabled:cursor-wait"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-600" /> Consultando IA...
                    </>
                  ) : (
                    <>
                      <BrainCircuit className="w-4 h-4" /> Gere Mentoria Estratégica
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Mentoria AI Tab Content */}
              {aiSettings && (!aiSettings.aiEnabled || !aiSettings.aiUseForReports) ? (
                <div className="flex-1 flex flex-col justify-center items-center py-12 sm:py-24 text-center">
                  <div className="w-16 h-16 bg-slate-100 border border-slate-200 text-slate-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <BrainCircuit className="w-8 h-8" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-700">Relatórios por IA Desativados</h3>
                  <p className="text-sm text-slate-400 mt-2 max-w-sm mx-auto">
                    Geração de relatórios por IA desativada. Ative em Preferências &gt; Inteligência Artificial.
                  </p>
                </div>
              ) : (
                <>
                  {!reportHtml && !loading && (
                    <div className="flex-1 flex flex-col justify-center items-center py-2 sm:py-16 text-center">
                      <div className="w-16 h-16 sm:w-24 sm:h-24 bg-indigo-50/50 text-indigo-600 rounded-3xl flex items-center justify-center mx-auto mb-3 sm:mb-6 shadow-sm shrink-0 sm:mt-0">
                        <BrainCircuit className="w-10 h-10 sm:w-14 sm:h-14" />
                      </div>
                      <h3 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight shrink-0 px-2">O Olhar Clínico da Inteligência Artificial</h3>
                      <p className="text-[13px] sm:text-base text-slate-500 mt-2 sm:mt-4 max-w-sm mx-auto leading-relaxed px-4 shrink-0">
                        Nossa IA analisará cada transação, cruzar categorias e identificar padrões que você talvez não esteja percebendo. É como ter um assessor financeiro focado em você.
                      </p>
                      <div className="mt-8 sm:mt-8 w-full px-2 sm:px-0 shrink-0 mb-4 sm:mb-0">
                        <button onClick={handleGenerate} disabled={transactions.length === 0} className="px-6 py-4 w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/20 transition-all flex items-center justify-center mx-auto disabled:opacity-50 text-sm active:scale-95 group">
                          <Sparkles className="w-4 h-4 mr-2 group-hover:rotate-12 transition-transform" /> Começar Análise Profunda
                        </button>
                      </div>
                    </div>
                  )}

                  {loading && (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-24 flex flex-col items-center justify-center text-indigo-600 overflow-hidden relative">
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-50/30 via-transparent to-transparent opacity-50 scale-150 animate-pulse" />
                      <Loader2 className="w-12 h-12 animate-spin mb-6 relative z-10" />
                      <p className="font-bold text-sm tracking-widest text-slate-500 uppercase relative z-10">{loadingMessage}</p>
                      <div className="mt-4 flex gap-1 relative z-10">
                        <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-bounce" />
                      </div>
                    </div>
                  )}

                  {error && (
                    <div className="p-6 bg-rose-50 text-rose-600 rounded-2xl text-sm font-bold border border-rose-200 flex flex-col items-center text-center">
                      <AlertCircle className="w-8 h-8 mb-3" />
                      <p>{error}</p>
                      <button onClick={handleGenerate} className="mt-4 px-6 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-sm text-xs font-bold uppercase tracking-wider transition-all">Tentar Novamente</button>
                    </div>
                  )}

                  {reportHtml && !loading && (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <div className="p-6 border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-emerald-50 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-white rounded-lg shadow-sm text-indigo-600">
                            <CheckCircle2 className="w-6 h-6" />
                          </div>
                          <div>
                            <h2 className="text-sm font-bold text-slate-800 tracking-tight">Mentoria Gerada com IA</h2>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest text-left">Baseado em fatos, não suposições</p>
                          </div>
                        </div>
                      </div>
                      <div className="p-10 prose sm:prose-sm md:prose-base max-w-none ai-report-content text-left
                        [&>h1]:text-2xl [&>h1]:font-black [&>h1]:text-slate-800 [&>h1]:mb-6
                        [&>h2]:text-xl [&>h2]:font-bold [&>h2]:text-slate-800 [&>h2]:mt-8 [&>h2]:mb-4 [&>h2]:pb-3 [&>h2]:border-b [&>h2]:border-slate-100
                        [&>h3]:text-lg [&>h3]:font-bold [&>h3]:text-slate-800 [&>h3]:mt-6 [&>h3]:mb-3
                        [&>p]:text-sm [&>p]:text-slate-600 [&>p]:leading-relaxed [&>p]:mb-5
                        [&>ul]:list-none [&>ul]:space-y-3 [&>ul]:mb-6
                        [&>ul>li]:text-sm [&>ul>li]:text-slate-600 [&>ul>li]:flex [&>ul>li]:items-start [&>ul>li]:gap-2
                        [&>ul>li]:before:content-['→'] [&>ul>li]:before:text-indigo-500 [&>ul>li]:before:font-bold
                        [&>table]:w-full [&>table]:text-left [&>table]:border-collapse [&>table]:rounded-xl [&>table]:overflow-hidden [&>table]:my-6
                        [&>table_th]:bg-slate-50 [&>table_th]:px-4 [&>table_th]:py-3 [&>table_th]:text-[10px] [&>table_th]:font-bold [&>table_th]:text-slate-400 [&>table_th]:uppercase
                        [&>table_td]:px-4 [&>table_td]:py-3 [&>table_td]:text-xs [&>table_td]:text-slate-600 [&>table_td]:border-b [&>table_td]:border-slate-50">
                        <ReactMarkdown>{reportHtml}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

        </div>
      </PullToRefresh>

      {modalDetail && (() => {
        const categoryIndex = modalDetail.type === 'category' 
          ? stats.categoryData.findIndex(cat => cat.name === modalDetail.value) 
          : -1;
        const categoryColor = categoryIndex !== -1 
          ? COLORS[categoryIndex % COLORS.length] 
          : '#10b981';

        // Calculate filtered data once for use in both stats AND listings
        const formatMoeda = (val: number) => val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

        const filteredAccountBalances = (accountBalances || []).filter(acc => {
          if (!modalSearchTerm) return true;
          const term = modalSearchTerm.toLowerCase();
          return (
            acc.bankName.toLowerCase().includes(term) ||
            acc.accountLabel.toLowerCase().includes(term) ||
            acc.accountName.toLowerCase().includes(term) ||
            (acc.number || '').includes(term)
          );
        });

        const activeAccountsCount = filteredAccountBalances.filter(a => a.includeInSaldoTotal).length;
        const totalAccountsBalance = filteredAccountBalances.filter(a => a.includeInSaldoTotal).reduce((sum, b) => sum + b.balance, 0);
        const pluggyCount = filteredAccountBalances.filter(acc => acc.provider === 'pluggy').length;
        const manualCount = filteredAccountBalances.filter(acc => acc.provider === 'manual').length;

        const filteredModalData = currentMonthTransactions.filter(t => {
          let typeMatch = false;
          if (modalDetail.type === 'category') {
            typeMatch = t.cat === modalDetail.value && t.type === 'Despesa';
          } else if (modalDetail.type === 'income') {
            typeMatch = t.type === 'Receita';
          } else if (modalDetail.type === 'expense') {
            typeMatch = t.type === 'Despesa';
          } else {
            typeMatch = true; // For balance and savings, show all
          }

          if (!typeMatch) return false;

          const matchSearch = modalSearchTerm === '' || 
                              t.desc.toLowerCase().includes(modalSearchTerm.toLowerCase()) ||
                              t.cat.toLowerCase().includes(modalSearchTerm.toLowerCase());
          const matchDate = modalFilterDate === '' || t.date.includes(modalFilterDate);
          const matchCat = modalFilterCat === '' || t.cat.toLowerCase().includes(modalFilterCat.toLowerCase());

          let matchAmount = true;
          if (modalFilterAmountType !== '' && modalFilterAmount !== '') {
            const amountToCompare = Math.abs(t.amount);
            const filterVal = parseFloat(modalFilterAmount);
            if (!isNaN(filterVal)) {
              if (modalFilterAmountType === 'greater') matchAmount = amountToCompare > filterVal;
              if (modalFilterAmountType === 'less') matchAmount = amountToCompare < filterVal;
              if (modalFilterAmountType === 'equal') matchAmount = amountToCompare === filterVal;
            }
          }

          return matchSearch && matchDate && matchAmount && matchCat;
        });

        // Sum for totals
        const totalAmount = filteredModalData.reduce((acc, t) => acc + (modalDetail.type === 'balance' || modalDetail.type === 'savings' ? (t.type === 'Receita' ? t.amount : -Math.abs(t.amount)) : Math.abs(t.amount)), 0);
        const averageAmount = filteredModalData.length > 0 ? totalAmount / filteredModalData.length : 0;

        return (
          <div className="fixed inset-0 bg-slate-900/40 sm:bg-slate-900/60 z-[100] flex flex-col justify-end sm:items-center sm:justify-center backdrop-blur-sm sm:backdrop-blur-md pt-10 sm:pt-4 sm:p-4 transition-all" onClick={handleCloseModal} 
               style={{ 
                 opacity: dragY > 0 ? 1 - (dragY / 500) : 1,
                 height: viewportHeight > 0 && typeof window !== 'undefined' && window.innerWidth < 640 ? `${viewportHeight}px` : undefined,
                 top: offsetTop > 0 && typeof window !== 'undefined' && window.innerWidth < 640 ? `${offsetTop}px` : undefined,
               }}>
            <div 
              className="bg-white rounded-t-[32px] sm:rounded-[32px] shadow-2xl w-full max-h-[90%] sm:h-auto sm:max-h-[90vh] sm:max-w-4xl overflow-hidden flex flex-col transform transition-all animate-in slide-in-from-bottom-10 sm:fade-in sm:zoom-in duration-300 relative border-t sm:border border-slate-200"
              onClick={e => e.stopPropagation()}
              style={{ 
                  transform: dragY > 0 ? `translateY(${dragY}px)` : 'translateY(0)',
                  transition: dragY > 0 ? 'none' : 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)'
              }}
            >
               <div 
                 className={`relative px-4 sm:px-8 pb-5 pt-8 sm:pt-6 border-b flex flex-col gap-5 flex-shrink-0 touch-none sm:touch-auto transition-colors duration-300 ${
                   modalDetail.type === 'category' ? '' : 
                   modalDetail.type === 'income' ? 'bg-gradient-to-b from-emerald-100/90 via-emerald-50/50 to-white border-emerald-100/50' : 
                   modalDetail.type === 'expense' ? 'bg-gradient-to-b from-rose-100/90 via-rose-50/50 to-white border-rose-100/50' : 
                   modalDetail.type === 'balance' ? 'bg-gradient-to-b from-blue-100/90 via-blue-50/50 to-white border-blue-100/50' : 
                   'bg-gradient-to-b from-violet-100/90 via-violet-50/50 to-white border-violet-100/50'
                 }`}
                 style={
                   modalDetail.type === 'category'
                     ? {
                         background: `linear-gradient(to bottom, ${categoryColor}26 0%, ${categoryColor}0D 50%, #ffffff 100%)`,
                         borderColor: `${categoryColor}33`
                       }
                     : undefined
                 }
                 onTouchStart={handleTouchStart} 
                 onTouchMove={handleTouchMove} 
                 onTouchEnd={handleTouchEnd}
               >
                  {/* Handle Mobile */}
                  <div className="w-12 h-1.5 bg-slate-200 rounded-full absolute top-2.5 left-1/2 -translate-x-1/2 sm:hidden cursor-grab active:cursor-grabbing hover:bg-slate-300 transition-colors" />
                  
                  <div className="flex justify-between items-center w-full">
                    <h2 className="text-[17px] sm:text-l font-black text-slate-800 tracking-tighter uppercase flex items-center gap-2">
                       <div className={`p-2 rounded-xl shadow-sm ${
                          modalDetail.type === 'category' ? '' :
                          modalDetail.type === 'income' ? 'bg-emerald-50 text-emerald-600' :
                          modalDetail.type === 'expense' ? 'bg-rose-50 text-rose-600' :
                          modalDetail.type === 'balance' ? 'bg-blue-50 text-blue-600' :
                          'bg-violet-50 text-violet-600'
                       }`}
                       style={
                         modalDetail.type === 'category'
                           ? {
                               backgroundColor: `${categoryColor}1A`,
                               color: categoryColor
                             }
                           : undefined
                       }
                       >
                          {modalDetail.type === 'category' ? <Tag className="w-5 h-5" /> : 
                           modalDetail.type === 'income' ? <TrendingUp className="w-5 h-5" /> : 
                           modalDetail.type === 'expense' ? <TrendingDown className="w-5 h-5" /> : 
                           modalDetail.type === 'balance' ? <Wallet className="w-5 h-5" /> : 
                           <Wallet className="w-5 h-5" />}
                       </div>
                       {modalDetail.title}
                    </h2>
                    <button onClick={handleCloseModal} className="text-slate-400 hover:text-slate-700 bg-slate-50 border border-slate-100 rounded-full w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center transition-all shadow-sm hover:scale-110 active:scale-95 shrink-0">
                      <X className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                  </div>

                  {/* Quick Stats Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 w-full">
                    {modalDetail.type === 'savings' ? (
                      <>
                        <div className="bg-slate-50/50 rounded-2xl p-3 sm:p-4 border border-slate-100 flex flex-col justify-center">
                          <span className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Ativas</span>
                          <span className="text-base sm:text-lg font-black text-slate-800 leading-none">
                            {activeAccountsCount}
                          </span>
                          <span className="text-[9px] text-slate-400 block mt-1 font-bold">Incluídas</span>
                        </div>
                        <div className="bg-slate-50/50 rounded-2xl p-3 sm:p-4 border border-slate-100 col-span-1 md:col-span-2 flex flex-col justify-center">
                          <span className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Saldo Disponível</span>
                          <span className={`text-base sm:text-lg font-black leading-none ${totalAccountsBalance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {formatMoeda(totalAccountsBalance)}
                          </span>
                          <span className="text-[9px] text-slate-400 block mt-1 font-bold">Patrimônio Líquido</span>
                        </div>
                        <div className="hidden md:flex bg-slate-50/50 rounded-2xl p-3 sm:p-4 border border-slate-100 flex flex-col justify-center">
                          <span className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Origens</span>
                          <span className="text-base sm:text-lg font-black text-slate-800 leading-none">
                            {pluggyCount + manualCount}
                          </span>
                          <span className="text-[9px] text-slate-400 block mt-1 font-bold">
                            {pluggyCount} Sinc / {manualCount} Man
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
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
                            modalDetail.type === 'income' ? 'text-emerald-600' :
                            modalDetail.type === 'expense' || modalDetail.type === 'category' ? 'text-rose-600' :
                            modalDetail.type === 'balance' ? (totalAmount >= 0 ? 'text-emerald-600' : 'text-rose-600') :
                            'text-slate-800'
                          }`}>
                            {modalDetail.type === 'income' ? '+' : modalDetail.type === 'expense' || modalDetail.type === 'category' ? '-' : ''} {formatMoeda(Math.abs(totalAmount))}
                          </span>
                          <span className="text-[9px] text-slate-400 block mt-1 font-bold">Consolidado</span>
                        </div>

                        <div className="hidden md:flex bg-slate-50/50 rounded-2xl p-3 sm:p-4 border border-slate-100 flex flex-col justify-center">
                          <span className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-0.5">Média</span>
                          <span className="text-base sm:text-lg font-black text-slate-800 leading-none">
                            {formatMoeda(Math.abs(averageAmount))}
                          </span>
                          <span className="text-[9px] text-slate-400 block mt-1 font-bold">Por transação</span>
                        </div>
                      </>
                    )}
                  </div>
               </div>

              {/* Modal Filters */}
              <div className="px-5 sm:px-8 py-4 bg-slate-50/80 border-b border-slate-100 flex flex-col gap-3 flex-shrink-0 touch-none sm:touch-auto" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
                {modalDetail.type === 'savings' ? (
                  <div className="relative w-full">
                    <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Pesquisar conta..." 
                      value={modalSearchTerm}
                      onChange={e => setModalSearchTerm(e.target.value)}
                      className="w-full pl-11 pr-4 min-h-[44px] py-3 bg-white border border-slate-200/80 rounded-2xl text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-400 transition-all placeholder:text-slate-400 shadow-sm"
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2 w-full">
                      <div className="relative flex-1">
                        <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input 
                          type="text" 
                          placeholder="Pesquisar transação..." 
                          value={modalSearchTerm}
                          onChange={e => setModalSearchTerm(e.target.value)}
                          className="w-full pl-11 pr-4 min-h-[44px] py-3 bg-white border border-slate-200/80 rounded-2xl text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-400 transition-all placeholder:text-slate-400 shadow-sm"
                        />
                      </div>
                      <button 
                        onClick={() => setShowModalFiltersMobile(!showModalFiltersMobile)}
                        className={`relative sm:hidden w-12 flex-shrink-0 rounded-2xl border transition-all flex items-center justify-center shadow-sm ${showModalFiltersMobile || [modalFilterDate, modalFilterCat, modalFilterAmountType, modalFilterAmount].filter(Boolean).length > 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-white border-slate-200/80 text-slate-400'}`}
                      >
                        <Filter className="w-5 h-5" />
                        {([modalFilterDate, modalFilterCat, modalFilterAmountType, modalFilterAmount].filter(Boolean).length) > 0 && !showModalFiltersMobile && (
                          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-emerald-500 rounded-full border-2 border-white"></span>
                        )}
                      </button>
                    </div>
                    
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
                        {modalDetail.type !== 'category' && (
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
                        )}
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
                    {([modalFilterDate, modalFilterCat, modalFilterAmountType, modalFilterAmount].filter(Boolean).length) > 0 && (
                        <div className={`${showModalFiltersMobile ? 'flex' : 'hidden'} sm:flex justify-end mt-1 animate-in fade-in`}>
                          <button onClick={() => {setModalFilterDate(''); setModalFilterCat(''); setModalFilterAmountType(''); setModalFilterAmount('');}} className="text-[10px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest flex items-center gap-1">
                            <X className="w-3 h-3" /> Limpar Filtros
                          </button>
                        </div>
                    )}
                  </>
                )}
              </div>

              <div className="flex-1 overflow-y-auto px-5 sm:px-8 py-5 bg-white">
                {modalDetail.type === 'savings' ? (
                  <div className="space-y-4 pb-20 sm:pb-0">
                    {/* Desktop Table */}
                    <div className="hidden sm:block bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden animate-none">
                      <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50/50">
                          <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 animate-none">
                            <th className="px-6 py-4">Banco / Corretora</th>
                            <th className="px-6 py-4">Identificação</th>
                            <th className="px-6 py-4">Origem</th>
                            <th className="px-6 py-4 text-right">Saldo</th>
                            <th className="px-6 py-4 text-center">Somar no Total?</th>
                          </tr>
                        </thead>
                        <tbody className="text-xs text-slate-700 divide-y divide-slate-50 font-medium">
                          {filteredAccountBalances.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">Nenhuma conta cadastrada ou encontrada.</td>
                            </tr>
                          ) : (
                            filteredAccountBalances.map((acc, i) => (
                              <tr key={acc.id || i} className="hover:bg-slate-50/50 transition-colors animate-none">
                                <td className="px-6 py-4 font-bold text-slate-800 flex items-center gap-2">
                                  {acc.bankName}
                                </td>
                                <td className="px-6 py-4">
                                  <div className="font-semibold text-slate-600 truncate max-w-[150px]">{acc.accountLabel || acc.accountName}</div>
                                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">{acc.number ? `Nº ${acc.number}` : 'N/D'}</div>
                                </td>
                                <td className="px-6 py-4">
                                  {acc.provider === 'pluggy' ? (
                                    <span className="px-2 py-0.5 bg-violet-100 text-violet-700 font-bold rounded text-[9px] uppercase tracking-wider">Conectado</span>
                                  ) : (
                                    <span className="px-2 py-0.5 bg-amber-100 text-amber-700 font-bold rounded text-[9px] uppercase tracking-wider">Manual</span>
                                  )}
                                </td>
                                <td className="px-6 py-4 text-right font-black text-slate-800 text-sm">
                                  {formatMoeda(acc.balance)}
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <button 
                                    onClick={() => handleToggleIncludeInTotal(acc.id!, acc.includeInSaldoTotal)}
                                    className="inline-flex items-center focus:outline-none animate-none"
                                  >
                                    {acc.includeInSaldoTotal ? (
                                      <ToggleRight className="w-6 h-6 text-emerald-600 animate-none" />
                                    ) : (
                                      <ToggleLeft className="w-6 h-6 text-slate-300 animate-none" />
                                    )}
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Cards */}
                    <div className="sm:hidden flex flex-col gap-3">
                      {filteredAccountBalances.length === 0 ? (
                        <div className="text-center py-10 text-slate-400 italic font-medium">Nenhuma conta encontrada.</div>
                      ) : (
                        filteredAccountBalances.map((acc, i) => (
                          <div key={acc.id || i} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <h4 className="font-extrabold text-slate-800 text-sm uppercase tracking-tight">{acc.bankName}</h4>
                                <span className="text-[10px] text-slate-400 font-mono">{acc.accountLabel || acc.accountName}</span>
                              </div>
                              <span className="font-black text-sm text-slate-800">{formatMoeda(acc.balance)}</span>
                            </div>
                            <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
                              <span className="text-slate-400 font-bold">Origem:</span>
                              {acc.provider === 'pluggy' ? (
                                <span className="px-2 py-0.5 bg-violet-100 text-violet-700 font-bold rounded text-[9px] uppercase tracking-wider">Conectado</span>
                              ) : (
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 font-bold rounded text-[9px] uppercase tracking-wider">Manual</span>
                              )}
                            </div>
                            <div className="flex items-center justify-between bg-slate-50 p-2 rounded-xl text-xs">
                              <span className="font-semibold text-slate-500">Incluir no Saldo Total:</span>
                              <button 
                                onClick={() => handleToggleIncludeInTotal(acc.id!, acc.includeInSaldoTotal)}
                                className="flex items-center focus:outline-none animate-none"
                              >
                                {acc.includeInSaldoTotal ? (
                                  <span className="text-emerald-600 font-bold flex items-center gap-1 font-bold">Sim <ToggleRight className="w-6 h-6 animate-none" /></span>
                                ) : (
                                  <span className="text-slate-400 font-medium flex items-center gap-1">Não <ToggleLeft className="w-6 h-6 animate-none" /></span>
                                )}
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : filteredModalData.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 text-center text-slate-400 font-bold italic">
                    Nenhum dado encontrado para os filtros atuais.
                  </div>
                ) : (
                  <div className="space-y-4 pb-20 sm:pb-0">
                    {/* Desktop Table */}
                    <div className="hidden sm:block bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden animate-none">
                      <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50/50">
                          <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 animate-none">
                            <th className="px-6 py-4">Data</th>
                            <th className="px-6 py-4">Categoria</th>
                            <th className="px-6 py-4">Descrição</th>
                            <th className="px-6 py-4 text-right pr-6 font-black uppercase tracking-widest text-[10px] text-slate-400">Ações / Valor</th>
                          </tr>
                        </thead>
                        <tbody className="text-xs text-slate-700 divide-y divide-slate-50">
                          {filteredModalData.map((item, i) => (
                            <tr key={i} className="hover:bg-slate-50/50 transition-colors group">
                              <td className="px-6 py-4 text-slate-400 font-bold whitespace-nowrap">{item.date}</td>
                              <td className="px-6 py-4">
                                <span className="inline-block align-middle text-center max-w-[130px] truncate px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-tighter bg-slate-50 text-slate-500 border border-slate-100" title={item.cat}>
                                  {item.cat}
                                </span>
                              </td>
                              <td className="px-6 py-4 font-bold text-slate-700 max-w-[200px] sm:max-w-[300px] truncate" title={item.desc}>{item.desc}</td>
                              <td className={`px-6 py-4 text-right pr-6 ${item.type === 'Despesa' ? 'text-rose-600' : 'text-emerald-600'}`}>
                                <div className="flex flex-col items-end">
                                  <span className="font-black text-sm tracking-tight" >
                                    {item.type === 'Despesa' ? '-' : '+'} {formatMoeda(Math.abs(item.amount))}
                                  </span>
                                  <div className="flex gap-3 mt-1.5 opacity-0 group-hover:opacity-100 transition-all transform translate-y-1 group-hover:translate-y-0">
                                    <button onClick={(e) => { e.stopPropagation(); onEditTransaction?.(item); handleCloseModal(); }} className="text-[9px] font-black text-emerald-600 uppercase tracking-widest hover:underline">Editar</button>
                                    <button onClick={(e) => { e.stopPropagation(); setDeletingId(item.id || null); if(deletingId === item.id) handleDelete(item.id); }} className="text-[9px] font-black text-rose-600 uppercase tracking-widest hover:underline">{deletingId === item.id ? 'Confirmar?' : 'Excluir'}</button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Cards */}
                    <div className="sm:hidden flex flex-col gap-3">
                      {filteredModalData.map((item, i) => {
                        const isDespesa = item.type === 'Despesa';
                        return (
                          <div 
                            key={item.id || i} 
                            onClick={() => { onEditTransaction?.(item); handleCloseModal(); }}
                            className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm active:bg-slate-50 transition-colors"
                          >
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex-1 min-w-0 pr-4">
                                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{item.date}</div>
                                <h4 className="font-bold text-slate-800 text-sm truncate uppercase tracking-tight">{item.desc}</h4>
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
                                <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[9px] font-black uppercase tracking-tighter flex items-center gap-1">
                                  <Tag className="w-2.5 h-2.5" />
                                  <span className="max-w-[80px] truncate">{item.cat}</span>
                                </span>
                                <span className="px-2 py-0.5 bg-indigo-50 text-indigo-500 rounded text-[9px] font-black uppercase tracking-tighter flex items-center gap-1">
                                  <CreditCard className="w-2.5 h-2.5" />
                                  <span className="max-w-[80px] truncate">{item.source}</span>
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <button onClick={(e) => { e.stopPropagation(); onEditTransaction?.(item); handleCloseModal(); }} className="p-1.5 text-slate-400 active:bg-emerald-50 active:text-emerald-600 rounded-lg font-bold">
                                  <Edit3 className="w-4 h-4" />
                                </button>
                                <button 
                                  onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setDeletingId(item.id || null);
                                    setShowDeleteConfirmMobile(item.id || null);
                                  }} 
                                  className={`p-1.5 rounded-lg transition-all ${deletingId === item.id ? 'bg-rose-600 text-white animate-pulse font-bold' : 'text-slate-400 active:bg-rose-50'}`}
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
            </div>
          </div>
        );
      })()}

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
      <AIConfirmationModal isOpen={showConfirmModal} onConfirm={handleConfirmAI} onCancel={() => { setShowConfirmModal(false); setHasPendingGenerate(false); }} />
    </div>
  );
});
