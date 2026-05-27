import React, { useState } from 'react';
import { UploadCloud, BrainCircuit, Bot, Cpu, Trash2, FileText, Image as ImageIcon, Camera } from 'lucide-react';
import { collection, doc, setDoc, getDocs, deleteDoc, serverTimestamp, updateDoc, query, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Transaction, UserProfile } from '../App';
import { secureGenerateContent, Type } from '../lib/gemini';
import { toast } from 'sonner';
import { runLocalRecognition } from '../lib/recognition/engine/recognitionEngine';
import { AUTO_ACCEPT, ACCEPT_WITH_BADGE, REVIEW_OR_AI } from '../lib/recognition/constants';

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

function parseOFX(text: string): any[] {
  const transactions: any[] = [];
  const stmttrns = text.match(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi) || [];
  
  for (const block of stmttrns) {
    const typeMatch = block.match(/<TRNTYPE>(.*)/i);
    const dateMatch = block.match(/<DTPOSTED>(\d{8})/i);
    const amountMatch = block.match(/<TRNAMT>([\d.-]+)/i);
    const memoMatch = block.match(/<MEMO>([^<]+)/i) || block.match(/<NAME>([^<]+)/i);
    
    if (amountMatch && (memoMatch || dateMatch)) {
      const rawAmt = parseFloat(amountMatch[1]);
      const dateRaw = dateMatch ? dateMatch[1] : ''; // YYYYMMDD
      let dateFormatted = '';
      if (dateRaw.length >= 8) {
        dateFormatted = `${dateRaw.substring(6, 8)}/${dateRaw.substring(4, 6)}/${dateRaw.substring(0, 4)}`;
      } else {
        const d = new Date();
        dateFormatted = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      }
      
      const desc = memoMatch ? memoMatch[1].trim() : 'Transação Sem Nome';
      const isDespesa = rawAmt < 0;
      
      transactions.push({
        date: dateFormatted,
        desc: desc,
        amount: rawAmt,
        type: isDespesa ? 'Despesa' : 'Receita',
        source: 'Importação OFX'
      });
    }
  }
  return transactions;
}

function parseCSV(text: string): any[] {
  const transactions: any[] = [];
  const lines = text.split(/\r?\n/);
  if (lines.length <= 1) return [];
  
  // Try to guess delimiter: , or ;
  const firstLine = lines[0];
  const delimiter = firstLine.includes(';') ? ';' : ',';
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const cols = line.split(delimiter).map(c => c.replace(/^["']|["']$/g, '').trim());
    if (cols.length < 2) continue;
    
    const datePattern = /(\d{2})\/(\d{2})\/(\d{4})/;
    const foundDateIdx = cols.findIndex(col => datePattern.test(col));
    
    const amtPattern = /^-?\d+([.,]\d{2})?$/;
    const foundAmtIdx = cols.findIndex(col => amtPattern.test(col.replace(',', '.')));
    
    if (foundDateIdx !== -1 && foundAmtIdx !== -1) {
      const date = cols[foundDateIdx];
      const desc = cols[foundDateIdx + 1] || cols[0] || 'Transação';
      const cleanAmtStr = cols[foundAmtIdx].replace(/\./g, '').replace(',', '.');
      const amount = parseFloat(cleanAmtStr) || 0;
      
      transactions.push({
        date: date,
        desc: desc,
        amount: amount,
        type: amount < 0 ? 'Despesa' : 'Receita',
        source: 'Importação CSV'
      });
    }
  }
  return transactions;
}

interface ImportViewProps {
  userId: string;
  onNavigateDashboard: () => void;
  profile?: UserProfile | null;
}

export const ImportView = React.memo(function ImportView({ userId, onNavigateDashboard, profile }: ImportViewProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const fileToPart = async (file: File) => {
    if (file.name.endsWith('.ofx') || file.type.startsWith('text/')) {
      const text = await file.text();
      return { text: `File: ${file.name}\n\n${text}` };
    } else {
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      });
      return {
        inlineData: { data: base64, mimeType: file.type || 'application/octet-stream' },
      };
    }
  };

  const handleProcess = async () => {
    setLoading(true);
    setProgress(0);
    
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 95) {
          return 95;
        }
        return prev + Math.floor(Math.random() * 3) + 1;
      });
    }, 500);

    try {
      const userCategories = profile?.categories || [
        'Alimentação', 'Transporte', 'Lazer', 'Saúde', 
        'Educação', 'Moradia', 'Salário', 'Investimentos',
        'Compras Online', 'Assinaturas', 'Outros'
      ];

      // Separate files into local-parseable vs AI-requiring
      const localTransactions: any[] = [];
      const aiFiles: File[] = [];

      for (const file of files) {
        const nameLower = file.name.toLowerCase();
        if (nameLower.endsWith('.ofx') || nameLower.endsWith('.xml')) {
          const text = await file.text();
          const parsed = parseOFX(text);
          localTransactions.push(...parsed.map(t => ({ ...t, isAiExtracted: false })));
        } else if (nameLower.endsWith('.csv')) {
          const text = await file.text();
          const parsed = parseCSV(text);
          localTransactions.push(...parsed.map(t => ({ ...t, isAiExtracted: false })));
        } else {
          aiFiles.push(file);
        }
      }

      let aiTransactions: any[] = [];

      if (aiFiles.length > 0) {
        const parts = await Promise.all(aiFiles.map(fileToPart));
        const prompt = `Você é um assistente financeiro de elite, especializado em extração de extratos bancários brasileiros a partir de documentos ou imagens.
Extraia detalhadamente todas as transações financeiras dos documentos ou imagens em anexo (PDF ou imagem). 

Siga estritamente estas diretrizes de extração:
1. Extraia a data no formato DD/MM/YYYY.
2. Extraia o valor numérico bruto (negativo para despesas, positivo para receitas).
3. Extraia a descrição literal do estabelecimento ou pagamento sem encurtar.
4. Identifique o banco emissor ou origem (ex: Itaú, Bradesco, Recibo).

Não faça classificação de categorias. Retorne o campo 'cat' vazio.

Retorne OBRIGATORIAMENTE um array JSON de objetos contendo as chaves descritas, sem explicações textuais fora do JSON.`;

        const response = await secureGenerateContent({
          model: 'gemini-3.5-flash',
          contents: {
            parts: [...parts, { text: prompt }],
          },
          config: {
             responseMimeType: "application/json",
             responseSchema: {
               type: Type.ARRAY,
               items: {
                 type: Type.OBJECT,
                 properties: {
                   date: { type: Type.STRING, description: "Date in DD/MM/YYYY" },
                   desc: { type: Type.STRING, description: "Transaction description" },
                   cat: { type: Type.STRING, description: "Category (leave empty)" },
                   type: { type: Type.STRING, description: "Either 'Receita' or 'Despesa'" },
                   amount: { type: Type.NUMBER, description: "Value of transaction (numeric)" },
                   source: { type: Type.STRING, description: "Source of transaction, e.g. Bradesco" }
                 },
                 required: ["date", "desc", "type", "amount", "source"]
               }
             }
          }
        });

        const text = response.text || "[]";
        try {
          const parsedList = JSON.parse(text);
          aiTransactions = parsedList.map((t: any) => ({ ...t, isAiExtracted: true }));
        } catch (e) {
          console.error("Failed to parse AI output:", text);
        }
      }

      // Combine both local parsed lines and AI extracted receipts
      const rawExtractedList = [...localTransactions, ...aiTransactions];

      // Run ALL extracted entries through local validation funnel
      const generatedTransactions = rawExtractedList.map(item => {
        const localRec = runLocalRecognition({
          description: item.desc,
          amount: item.amount,
          detectedDirection: item.type as 'Receita' | 'Despesa',
          source: item.source || 'Importação'
        }, [], [], userCategories);

        return {
          date: item.date,
          desc: localRec.cleanDescription || item.desc,
          cat: localRec.category || 'Outros',
          type: localRec.type || item.type,
          amount: item.amount,
          source: item.source || 'Importação',
          directionConfidence: localRec.confidence,
          directionReason: localRec.evidence.join(' | '),
          
          // Modern recognition parameters
          recognitionConfidence: localRec.confidence,
          recognitionMethod: item.isAiExtracted ? 'AI_FALLBACK' : localRec.method,
          recognitionEvidence: item.isAiExtracted ? ['Extraído por IA visual (OCR / Imagem)'] : localRec.evidence,
          needsReview: localRec.needsReview,
          aiUsed: item.isAiExtracted,
          merchantKey: localRec.merchantKey,
          cleanDescription: localRec.cleanDescription || item.desc
        };
      });
      
      const colRef = collection(db, 'transactions');
      const newCategories = new Set<string>();
      
      // Fetch all existing user transactions to prevent inserts of duplicates
      const existingQuery = query(colRef, where('userId', '==', userId));
      const existingSnapshot = await getDocs(existingQuery);
      const existingTransactions = existingSnapshot.docs.map(doc => doc.data() as Transaction);

      const existingCounts: Record<string, number> = {};
      for (const trx of existingTransactions) {
        const key = makeKey(trx.date, trx.desc, trx.amount, trx.source, trx.type);
        existingCounts[key] = (existingCounts[key] || 0) + 1;
      }

      const transactionsToInsert: any[] = [];
      let duplicateCount = 0;

      for (const item of generatedTransactions) {
        const key = makeKey(item.date, item.desc, item.amount, item.source, item.type);
        if (existingCounts[key] && existingCounts[key] > 0) {
          existingCounts[key]--;
          duplicateCount++;
        } else {
          transactionsToInsert.push(item);
        }
      }

      for (const item of transactionsToInsert) {
        if (item.cat) newCategories.add(item.cat.trim());
        const ref = doc(colRef);
        await setDoc(ref, {
          ...item,
          userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
      
      if (profile && profile.userId && newCategories.size > 0) {
        const currentCategories = profile.categories || [
          'Alimentação', 'Transporte', 'Lazer', 'Saúde', 
          'Educação', 'Moradia', 'Salário', 'Investimentos'
        ];
        let hasChanges = false;
        const updatedCategories = [...currentCategories];
        
        newCategories.forEach(cat => {
          if (cat && !updatedCategories.includes(cat)) {
            updatedCategories.push(cat);
            hasChanges = true;
          }
        });
        
        if (hasChanges) {
          try {
            await updateDoc(doc(db, 'users', profile.userId), {
              categories: updatedCategories,
              updatedAt: serverTimestamp()
            });
          } catch(e) {
            console.error("Failed to add new categories", e);
          }
        }
      }
      
      clearInterval(progressInterval);
      setProgress(100);

      // Extract statistics for beautiful summary output
      let localRecognizedCount = 0;
      let aiFallbackAppliedCount = 0;
      let needsReviewTransactionsCount = 0;

      for (const item of transactionsToInsert) {
        if (item.aiUsed) {
          aiFallbackAppliedCount++;
        } else {
          localRecognizedCount++;
        }
        if (item.needsReview) {
          needsReviewTransactionsCount++;
        }
      }
      
      if (transactionsToInsert.length === 0) {
        toast.info(`Nenhuma nova transação foi importada. Todas as ${duplicateCount} transações já existem no sistema!`);
      } else {
        const summaryMsg = `Importação concluída:
- ${localRecognizedCount} reconhecidas localmente
- ${aiFallbackAppliedCount} por IA fallback
- ${needsReviewTransactionsCount} precisam revisão`;
        
        toast.success(<div className="whitespace-pre-line font-medium text-xs">{summaryMsg}</div>, { duration: 6000 });
        
        if (duplicateCount > 0) {
          toast.info(`${duplicateCount} duplicadas foram detectadas e desconsideradas.`);
        }
      }
      setTimeout(() => {
        setLoading(false);
        setFiles([]);
        setProgress(0);
        onNavigateDashboard();
      }, 700);

    } catch (err: any) {
      clearInterval(progressInterval);
      setProgress(0);
      toast.error("Ocorreu um erro ao processar seus documentos.");
      console.error(err);
      handleFirestoreError(err, OperationType.CREATE, 'transactions');
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <header className="h-16 flex-shrink-0 bg-white border-b border-slate-200 flex items-center px-4 sm:px-8 z-10">
        <h1 className="text-lg font-bold text-slate-800">Importar Dados</h1>
      </header>
      
      <div className="flex-1 p-4 sm:p-8 overflow-y-auto w-full pb-32 sm:pb-8">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm text-center">
            <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <UploadCloud className="w-8 h-8" />
            </div>
            <h2 className="text-sm font-bold text-slate-800 mb-2">Importe seus Arquivos</h2>
            <p className="text-xs text-slate-500 mb-6">
              O FINCANVAS tenta reconhecer seus lançamentos localmente. A IA só será usada em itens incertos ou arquivos sem texto estruturado.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <input type="file" id="file-upload" className="hidden" multiple accept="image/*,.pdf,.ofx,text/xml" onChange={handleFileChange} />
              <label htmlFor="file-upload" className="bg-slate-800 text-white hover:bg-slate-700 px-6 min-h-[48px] py-3 flex items-center justify-center rounded-xl text-sm font-bold cursor-pointer transition-colors w-full sm:w-auto gap-2 shadow-sm">
                <UploadCloud className="w-5 h-5" /> Selecionar Arquivos
              </label>

              <input type="file" id="camera-upload" className="hidden" multiple accept="image/*" capture="environment" onChange={handleFileChange} />
              <label htmlFor="camera-upload" className="bg-emerald-600 text-white hover:bg-emerald-700 px-6 min-h-[48px] py-3 flex items-center justify-center rounded-xl text-sm font-bold cursor-pointer transition-colors w-full gap-2 sm:hidden shadow-sm">
                <Camera className="w-5 h-5" /> Tirar Foto
              </label>
            </div>
            
            {files.length > 0 && (
              <div className="mt-6 text-left border border-slate-200 rounded-lg max-h-60 overflow-y-auto w-full bg-slate-50">
                <ul className="divide-y divide-slate-200">
                  {files.map((f, i) => (
                    <li key={i} className="px-4 py-3 flex justify-between items-center hover:bg-slate-100 transition-colors">
                      <div className="flex items-center overflow-hidden">
                        {f.type.startsWith('image/') ? <ImageIcon className="w-4 h-4 text-emerald-500 mr-3 flex-shrink-0" /> : <FileText className="w-4 h-4 text-emerald-500 mr-3 flex-shrink-0" />}
                        <span className="font-semibold text-xs text-slate-700 truncate">{f.name}</span>
                        <span className="text-[10px] text-slate-400 ml-2">({(f.size / 1024).toFixed(1)} KB)</span>
                      </div>
                      <button onClick={() => removeFile(i)} className="text-slate-400 hover:text-rose-500 transition-colors p-1" title="Remover arquivo">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {(files.length > 0 || loading) && (
            <button onClick={handleProcess} disabled={loading || files.length === 0} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 min-h-[48px] rounded-2xl transition-all shadow-md active:scale-[0.98] flex justify-center items-center text-sm disabled:opacity-70 disabled:cursor-not-allowed">
              {loading ? <><Cpu className="w-5 h-5 mr-2 animate-spin" /> Reconhecendo transações...</> : 'Processar Documentos'}
            </button>
          )}

          {loading && (
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-slate-700">Progresso da Extração</span>
                <span className="text-emerald-600 font-bold">{progress}%</span>
              </div>
              <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${progress}%` }}></div>
              </div>
              <p className="text-[10px] text-center text-slate-500 uppercase tracking-widest font-bold">Processando arquivos • Reconhecimento Inteligente FINCANVAS</p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
});
