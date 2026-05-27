import React, { useState, useEffect, useRef } from 'react';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { 
  X, 
  Plus, 
  PlusCircle, 
  Tag, 
  CreditCard, 
  DollarSign, 
  Calendar, 
  Zap,
  Sparkles,
  Wand2,
  Trash2,
  Camera,
  UploadCloud
} from 'lucide-react';
import { collection, addDoc, updateDoc, doc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Transaction, UserProfile } from '../App';
import { secureGenerateContent, Type } from '../lib/gemini';
import { toast } from 'sonner';
import { localRecognize } from '../lib/transactionRecognizer';

interface ManualEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  profile?: UserProfile | null;
  transaction?: Transaction | null;
  onNavigateImport?: () => void;
}




export const ManualEntryModal = React.memo(function ManualEntryModal({ isOpen, onClose, userId, transaction, profile, onNavigateImport }: ManualEntryModalProps) {
  const [manualType, setManualType] = useState<'Receita' | 'Despesa'>('Despesa');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  
  const { viewportHeight, offsetTop, isKeyboardOpen } = useVisualViewport();
  const [dragY, setDragY] = useState(0);
  const startYRef = useRef(0);

  const dateRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLInputElement>(null);
  const catRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<HTMLInputElement>(null);

  const handleNextInput = (e: React.KeyboardEvent<HTMLInputElement>, nextRef: React.RefObject<HTMLInputElement | null>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      nextRef.current?.focus();
    }
  };

  const handleCameraAutofill = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    
    try {
      setIsScanning(true);
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      });

      const userCategories = profile?.categories || [
        'Alimentação', 'Transporte', 'Lazer', 'Saúde', 
        'Educação', 'Moradia', 'Salário', 'Investimentos', 
        'Compras Online', 'Assinaturas', 'Outros'
      ];

      const response = await secureGenerateContent({
        model: 'gemini-3.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Extraia detalhadamente os dados desta nota fiscal, recibo ou imagem de transação.
                
Regras de classificação:
1. Identifique a Categoria: Escolha preferencialmente uma desta lista de categorias cadastradas do usuário: ${JSON.stringify(userCategories)}. Se nenhuma se encaixar minimamente, sugira uma categoria nova iniciando com letra maiúscula (ex: "Pets", "Impostos").
2. Identifique a Origem/Banco do pagamento se estiver legível (ex: "Nubank", "Itaú", "Inter", "Bradesco", "Santander", "Dinheiro", "Pix").
3. Limpe e humanize a descrição para que fique clara (ex: "MCDONALDS DT" -> "McDonald's", "SUPERM. CARREFOUR" -> "Carrefour").`
              },
              { inlineData: { data: base64, mimeType: file.type } },
            ],
          },
        ],
        config: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              desc: { type: Type.STRING, description: "Nome limpo do estabelecimento ou transação" },
              amount: { type: Type.STRING, description: "Valor total formatado como '123,45' apenas números e vírgula" },
              date: { type: Type.STRING, description: "Data no formato DD/MM/YYYY" },
              type: { type: Type.STRING, description: "'Despesa' ou 'Receita'" },
              cat: { type: Type.STRING, description: "Categoria inteligente classificada" },
              source: { type: Type.STRING, description: "Origem/Banco da transação, se identificado" }
            },
            required: ["desc", "amount", "type", "cat"]
          }
        }
      });

      if (response.text) {
        let txt = response.text;
        txt = txt.replace(/```json/g, '').replace(/```/g, '').trim();
        const data = JSON.parse(txt);
        
        if (data.type) setManualType(data.type === 'Receita' ? 'Receita' : 'Despesa');
        setManualForm(prev => ({
          ...prev,
          desc: data.desc || prev.desc,
          amount: data.amount || prev.amount,
          date: data.date && data.date.includes('/') ? data.date : prev.date,
          cat: data.cat || prev.cat,
          source: data.source || prev.source
        }));
        toast.success("Dados e categorias extraídos por IA!");
      }
    } catch (err) {
      console.error(err);
      toast.error('Erro ao processar imagem.');
    } finally {
      setIsScanning(false);
      e.target.value = '';
    }
  };

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
      handleClose();
    } else {
      setDragY(0);
    }
  };

  const handleClose = () => {
    onClose();
    setTimeout(() => setDragY(0), 300);
  };

  const [manualForm, setManualForm] = useState({
    date: new Date().toLocaleDateString('pt-BR'),
    desc: '',
    cat: '',
    amount: '',
    source: ''
  });

  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const suggestCategory = async () => {
    if (!manualForm.desc) return;
    setIsSuggesting(true);
    try {
      const userCategories = profile?.categories || [
        'Alimentação', 'Transporte', 'Lazer', 'Saúde', 
        'Educação', 'Moradia', 'Salário', 'Investimentos', 
        'Compras Online', 'Assinaturas', 'Outros'
      ];

      // 1. Run local recognition first
      const parsedAmount = parseFloat(manualForm.amount.replace(',', '.')) || -0.01;
      const localResult = localRecognize({
        description: manualForm.desc,
        amount: parsedAmount,
        detectedDirection: manualType,
      }, [], userCategories);

      if (localResult && localResult.confidence >= 0.75) {
        setManualForm(prev => ({
          ...prev,
          cat: localResult.category,
          desc: localResult.cleanDescription || prev.desc
        }));
        toast.success('Categoria e descrição sugeridas localmente!');
        setIsSuggesting(false);
        return;
      }

      // 2. Fallback to Gemini if low confidence
      const prompt = `Analise a descrição desta transação financeira e classifique-a de forma inteligente.
Descrição: "${manualForm.desc}" (${manualType === 'Receita' ? 'Receita/Entrada' : 'Despesa/Saída'})

Siga estas instruções críticas:
1. Escolha a categoria mais apropriada preferencialmente dentre as cadastradas do usuário: ${JSON.stringify(userCategories)}. Se nenhuma se alinhar de forma correta, proponha uma nova categoria lógica e intuitiva (ex: "Pets", "Beleza").
2. Se a descrição contiver nomes poluídos ou abreviações (ex: "POSTO IPIRANGA JACAREI", "IFD*RESTAURANTE", "UBER *TRIP HELP_CENTER"), sugira um nome limpo e amigável (ex: "Posto Ipiranga", "iFood", "Uber").
3. Se for detectada a origem/banco implícita (ex: "Nubank", "Itaú", "Inter", "Bradesco", "Santander", "Dinheiro", "Pix"), retorne-a no campo correspondente.`;

      const response = await secureGenerateContent({
        model: 'gemini-3.5-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING, description: "A categoria correspondente" },
              cleanDescription: { type: Type.STRING, description: "Nome limpo e amigável do estabelecimento" },
              source: { type: Type.STRING, description: "Banco ou origem de pagamento, se identificado" }
            },
            required: ["category", "cleanDescription"]
          }
        }
      });

      if (response.text) {
        let txt = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
        const data = JSON.parse(txt);
        if (data.category) {
          setManualForm(prev => ({
            ...prev,
            cat: data.category,
            desc: data.cleanDescription || prev.desc,
            source: data.source || prev.source
          }));
          toast.success('Categoria e descrição refinadas com Inteligência Artificial!');
        }
      }
    } catch (e) {
      console.error(e);
      toast.error('Erro ao sugerir categoria.');
    } finally {
      setIsSuggesting(false);
    }
  };

  useEffect(() => {
    setIsConfirmingDelete(false);
    if (transaction) {
      setManualType(transaction.type);
      setManualForm({
        date: transaction.date,
        desc: transaction.desc,
        cat: transaction.cat,
        amount: Math.abs(transaction.amount).toString().replace('.', ','),
        source: transaction.source
      });
    } else {
      setManualForm({
        date: new Date().toLocaleDateString('pt-BR'),
        desc: '',
        cat: '',
        amount: '',
        source: ''
      });
      setManualType('Despesa');
    }
  }, [transaction, isOpen]);

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

  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    // Timeout gives iOS keyboard time to animate up before scrolling
    setTimeout(() => {
      e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.desc || !manualForm.amount) return;

    setIsSubmitting(true);
    try {
      const amountValue = parseFloat(manualForm.amount.replace(',', '.'));
      const finalAmount = manualType === 'Despesa' ? -Math.abs(amountValue) : Math.abs(amountValue);
      const currentUserId = userId || (auth.currentUser?.uid) || 'anonymous';
      
      const payload: any = {
        ...manualForm,
        amount: finalAmount,
        type: manualType,
        userId: currentUserId,
        updatedAt: serverTimestamp()
      };

      if (transaction && transaction.id) {
        await updateDoc(doc(db, 'transactions', transaction.id), payload);
        toast.success('Transação atualizada com sucesso!');
      } else {
        await addDoc(collection(db, 'transactions'), {
          ...payload,
          createdAt: serverTimestamp()
        });
        toast.success('Transação adicionada com sucesso!');
      }
      
      if (profile && profile.userId && manualForm.cat) {
        const currentCategories = profile.categories || [
          'Alimentação', 'Transporte', 'Lazer', 'Saúde', 
          'Educação', 'Moradia', 'Salário', 'Investimentos'
        ];
        const trimmedCat = manualForm.cat.trim();
        if (trimmedCat && !currentCategories.includes(trimmedCat)) {
          try {
            await updateDoc(doc(db, 'users', profile.userId), {
              categories: [...currentCategories, trimmedCat],
              updatedAt: serverTimestamp()
            });
          } catch(e) {
            console.error("Failed to add category", e);
          }
        }
      }
      
      setManualForm({
        date: new Date().toLocaleDateString('pt-BR'),
        desc: '',
        cat: '',
        amount: '',
        source: ''
      });
      handleClose();
    } catch (error) {
      console.error("Error adding document: ", error);
      toast.error('Erro ao salvar transação.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!transaction || !transaction.id) {
      console.warn("Sem transação ou ID para excluir", transaction);
      return;
    }
    
    if (!isConfirmingDelete) {
      setIsConfirmingDelete(true);
      return;
    }
    
    setIsSubmitting(true);
    try {
      await deleteDoc(doc(db, 'transactions', transaction.id));
      toast.success('Transação excluída com sucesso!');
      handleClose();
    } catch (error: any) {
      console.error("Erro ao excluir transação no modal: ", error);
      toast.error('Erro ao excluir transação.');
    } finally {
      setIsSubmitting(false);
      setIsConfirmingDelete(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 sm:bg-slate-900/60 z-[100] flex flex-col justify-end sm:items-center sm:justify-center backdrop-blur-sm sm:backdrop-blur-md pt-10 sm:pt-4 sm:p-4 transition-all" onClick={handleClose} 
         style={{ 
           opacity: dragY > 0 ? 1 - (dragY / 500) : 1,
           height: viewportHeight > 0 && typeof window !== 'undefined' && window.innerWidth < 640 ? `${viewportHeight}px` : undefined,
           top: offsetTop > 0 && typeof window !== 'undefined' && window.innerWidth < 640 ? `${offsetTop}px` : undefined,
         }}>
      <div 
        className="bg-white rounded-t-[32px] sm:rounded-[32px] shadow-2xl w-full max-h-[90%] sm:h-auto sm:max-h-[90vh] sm:max-w-md overflow-hidden flex flex-col transform transition-all border-t sm:border border-slate-200 animate-in slide-in-from-bottom-10 duration-300 relative"
        onClick={e => e.stopPropagation()}
        style={{ 
            transform: dragY > 0 ? `translateY(${dragY}px)` : 'translateY(0)',
            transition: dragY > 0 ? 'none' : 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)'
        }}
      >
        <div 
          className="flex-shrink-0 relative px-6 py-5 sm:py-6 pt-7 sm:pt-6 border-b touch-none sm:touch-auto transition-colors duration-300 bg-white border-slate-100"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Mobile indicator for sheet look */}
          <div className="absolute top-0 left-0 w-full flex justify-center pt-3 sm:hidden">
            <div className="w-12 h-1.5 bg-slate-300/60 rounded-full flex-shrink-0" />
          </div>

          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-800 flex items-center gap-2.5 text-lg">
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${transaction ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'}`}>
                {transaction ? (
                  <Sparkles className="w-5 h-5" />
                ) : (
                  <PlusCircle className="w-5 h-5" />
                )}
              </div>
              {transaction ? 'Editar Transação' : 'Adicionar Transação'}
            </h3>
            <button 
              onClick={handleClose}
              className="p-2.5 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600 active:scale-90"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        <form onSubmit={handleManualSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-5 pb-24 sm:pb-6">
            {/* Mobil Action Buttons: Scan Receipt or Navigate Import (without breaking layout) */}
            {!transaction && (
              <div className="flex sm:hidden w-full gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <input type="file" id="camera-autofill" className="hidden" accept="image/*" capture="environment" onChange={handleCameraAutofill} disabled={isScanning} />
                  <label htmlFor="camera-autofill" tabIndex={-1} className={`w-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 flex items-center justify-center gap-1.5 py-3 rounded-xl border border-dashed border-emerald-200 cursor-pointer font-bold transition-all text-xs min-h-[44px] active:scale-[0.98] ${isScanning ? 'opacity-50 pointer-events-none' : ''}`}>
                    {isScanning ? <Zap className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />} 
                    <span className="truncate">{isScanning ? 'Scaneando...' : 'Escanear c/ IA'}</span>
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onNavigateImport?.();
                    handleClose();
                  }}
                  className="flex-1 min-w-0 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 flex items-center justify-center gap-1.5 py-3 rounded-xl border border-dashed border-indigo-200 cursor-pointer font-bold transition-all text-xs min-h-[44px] active:scale-[0.98]"
                >
                  <UploadCloud className="w-4 h-4" />
                  <span className="truncate">Importar Dados</span>
                </button>
              </div>
            )}

            {transaction && (
              <div className="flex sm:hidden w-full mb-2">
                <input type="file" id="camera-autofill" className="hidden" accept="image/*" capture="environment" onChange={handleCameraAutofill} disabled={isScanning} />
                <label htmlFor="camera-autofill" tabIndex={-1} className={`w-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-emerald-200 cursor-pointer font-bold transition-all text-sm active:scale-[0.98] ${isScanning ? 'opacity-50 pointer-events-none' : ''}`}>
                  {isScanning ? <Zap className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />} 
                  {isScanning ? 'Analisando Recibo...' : 'Escanear Recibo com IA'}
                </label>
              </div>
            )}

            <div className="flex bg-slate-100/80 p-1.5 rounded-2xl mb-4">
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setManualType('Despesa')}
                className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${manualType === 'Despesa' ? 'bg-white text-rose-600 shadow-sm ring-1 ring-black/5' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Saída / Despesa
              </button>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setManualType('Receita')}
                className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${manualType === 'Receita' ? 'bg-white text-emerald-600 shadow-sm ring-1 ring-black/5' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Entrada / Receita
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5 ml-1">
                  <Calendar className="w-3.5 h-3.5" /> Data
                </label>
                <input
                  ref={dateRef}
                  type="text"
                  required
                  inputMode="numeric"
                  enterKeyHint="next"
                  tabIndex={1}
                  maxLength={10}
                  placeholder="DD/MM/YYYY"
                  value={manualForm.date}
                  onChange={e => setManualForm({...manualForm, date: handleDateMask(e.target.value)})}
                  onFocus={handleInputFocus}
                  onKeyDown={e => handleNextInput(e, amountRef)}
                  className="w-full px-4 py-3 min-h-[48px] bg-slate-50/80 border border-slate-200/80 rounded-xl text-base font-semibold focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-400 transition-all placeholder:text-slate-400"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5 ml-1">
                  <DollarSign className="w-3.5 h-3.5" /> Valor
                </label>
                <input
                  ref={amountRef}
                  type="text"
                  required
                  inputMode="decimal"
                  enterKeyHint="next"
                  tabIndex={2}
                  maxLength={15}
                  placeholder="0,00"
                  value={manualForm.amount}
                  onChange={e => setManualForm({...manualForm, amount: handleCurrencyMask(e.target.value)})}
                  onFocus={handleInputFocus}
                  onKeyDown={e => handleNextInput(e, descRef)}
                  className="w-full px-4 py-3 min-h-[48px] bg-slate-50/80 border border-slate-200/80 rounded-xl text-base font-bold focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-400 transition-all placeholder:text-slate-400"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between ml-1">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5" /> Descrição
                </label>
                <button 
                  type="button"
                  tabIndex={-1}
                  onClick={suggestCategory}
                  disabled={isSuggesting || !manualForm.desc}
                  className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 disabled:opacity-30 transition-all uppercase tracking-widest bg-emerald-50 px-2 min-h-[32px] py-1 rounded-md"
                >
                  {isSuggesting ? <Zap className="w-2.5 h-2.5 animate-spin" /> : <Wand2 className="w-2.5 h-2.5" />}
                  Sugerir Categoria
                </button>
              </div>
              <input
                ref={descRef}
                type="text"
                required
                enterKeyHint="next"
                tabIndex={3}
                maxLength={100}
                placeholder="Ex: Aluguel, Supermercado..."
                value={manualForm.desc}
                onFocus={handleInputFocus}
                onChange={e => setManualForm({...manualForm, desc: e.target.value})}
                onKeyDown={e => handleNextInput(e, catRef)}
                className="w-full px-4 py-3 min-h-[48px] bg-slate-50/80 border border-slate-200/80 rounded-xl text-base font-semibold focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-400 transition-all placeholder:text-slate-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5 ml-1">
                  <Sparkles className="w-3.5 h-3.5" /> Categoria
                </label>
                <input
                  ref={catRef}
                  type="text"
                  list="categories-list-global"
                  enterKeyHint="next"
                  tabIndex={4}
                  maxLength={30}
                  placeholder="Ex: Lazer"
                  value={manualForm.cat}
                  onFocus={handleInputFocus}
                  onChange={e => setManualForm({...manualForm, cat: e.target.value})}
                  onKeyDown={e => handleNextInput(e, sourceRef)}
                  className="w-full px-4 py-3 min-h-[48px] bg-slate-50/80 border border-slate-200/80 rounded-xl text-base font-semibold focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-400 transition-all placeholder:text-slate-400"
                />
                <datalist id="categories-list-global">
                  {(profile?.categories || [
                    'Alimentação', 'Transporte', 'Lazer', 'Saúde', 
                    'Educação', 'Moradia', 'Salário', 'Investimentos'
                  ]).map((cat) => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5 ml-1">
                  <CreditCard className="w-3.5 h-3.5" /> Origem
                </label>
                <input
                  ref={sourceRef}
                  type="text"
                  list="source-list-global"
                  enterKeyHint="send"
                  tabIndex={5}
                  maxLength={30}
                  placeholder="Ex: Nubank"
                  value={manualForm.source}
                  onFocus={handleInputFocus}
                  onChange={e => setManualForm({...manualForm, source: e.target.value})}
                  className="w-full px-4 py-3 min-h-[48px] bg-slate-50/80 border border-slate-200/80 rounded-xl text-base font-semibold focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-400 transition-all placeholder:text-slate-400"
                />
                <datalist id="source-list-global">
                  <option value="Nubank" />
                  <option value="Inter" />
                  <option value="Santander" />
                  <option value="Itaú" />
                  <option value="Bradesco" />
                  <option value="Dinheiro" />
                  <option value="Pix" />
                </datalist>
              </div>
            </div>

          </div>
          <div 
            className="flex-shrink-0 p-4 sm:px-6 sm:pb-6 sm:pt-0 bg-white sm:bg-transparent border-t sm:border-0 border-slate-200 z-10 flex gap-3" 
            style={typeof window !== 'undefined' && window.innerWidth < 640 ? { paddingBottom: isKeyboardOpen ? '1rem' : 'calc(1rem + env(safe-area-inset-bottom, 0px))' } : undefined}
          >
              {transaction && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isSubmitting}
                  className={`flex-1 py-3.5 px-3 min-h-[52px] rounded-2xl font-bold flex items-center justify-center gap-2 transition-all border active:scale-[0.98] disabled:opacity-50 shadow-sm text-base ${isConfirmingDelete ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-600 ring-4 ring-rose-500/20 shadow-[0_4px_14px_0_rgba(225,29,72,0.39)]' : 'bg-white hover:bg-rose-50 text-rose-600 border-rose-200 hover:border-rose-300'}`}
                >
                  <Trash2 className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
                  <span className="truncate">{isConfirmingDelete ? 'Confirmar' : 'Excluir'}</span>
                </button>
              )}
              <button
                type="submit"
                disabled={isSubmitting || !manualForm.desc.trim() || !manualForm.amount.trim()}
                className={`${transaction ? 'flex-[1.8]' : 'w-full'} py-3.5 px-4 min-h-[52px] bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-[0_4px_14px_0_rgba(5,150,105,0.39)] hover:shadow-[0_6px_20px_rgba(5,150,105,0.23)] hover:-translate-y-0.5 focus:ring-4 focus:ring-emerald-500/30 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 disabled:cursor-not-allowed disabled:shadow-none text-base`}
              >
                {isSubmitting ? (
                  <Zap className="w-4 h-4 sm:w-5 sm:h-5 animate-spin flex-shrink-0" />
                ) : (
                  <>
                    {transaction ? <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" /> : <Plus className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />}
                    <span className="truncate">{transaction ? 'Salvar Alterações' : 'Salvar Transação'}</span>
                  </>
                )}
              </button>
            </div>
          </form>
      </div>
    </div>
  );
});

