import React, { useState, useRef } from 'react';
import { User, signOut, sendPasswordResetEmail, updateProfile } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { UserProfile, Transaction } from '../App';
import { doc, updateDoc, serverTimestamp, collection, setDoc, deleteDoc } from 'firebase/firestore';
import { PluggySettingsPanel } from './PluggySettingsPanel';
import { User as UserIcon, Bell, LogOut, CloudCog, Download, UploadCloud, Trash2, Loader2, Database, Palette, CheckCircle2, ChevronLeft, ChevronRight, CreditCard } from 'lucide-react';
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
                {activePanel === 'ia' && 'Dados e Nuvem'}
                {activePanel === 'pluggy' && 'Integração bancária'}
              </span>
            </>
          )}
        </div>
        <h1 className="hidden md:block text-lg font-bold text-slate-800 dark:text-slate-100">Preferências</h1>
      </header>
      
      <div className={`flex-1 p-4 md:p-8 w-full sm:pb-8 flex flex-col ${isMobileMenu ? 'overflow-hidden pb-20' : 'overflow-y-auto pb-24'}`}>
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-0 md:gap-8 flex-1 w-full relative">
          <aside className={`w-full md:w-64 flex-shrink-0 flex-col gap-2.5 md:gap-2 pb-2 md:pb-0 h-full overflow-y-auto md:overflow-y-visible ${isMobileMenu ? 'flex' : 'hidden md:flex'}`}>
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
              className={`w-full text-left px-4 py-3.5 md:px-4 md:py-2.5 text-sm md:font-bold rounded-2xl md:rounded-lg transition-all flex items-center shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] md:shadow-none border border-slate-100 md:border-transparent ${activePanel === 'ia' ? 'bg-emerald-50/50 md:bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-100/50' : 'bg-white md:bg-transparent text-slate-700 md:text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'} active:scale-[0.98]`}>
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
              <span className="font-bold text-[14px] md:text-sm">Integração bancária</span>
              <ChevronRight className="md:hidden w-4 h-4 ml-auto text-slate-300" />
            </button>
            <div className="hidden md:block border-t border-slate-200 dark:border-slate-700 my-4"></div>
            <button 
              onClick={handleLogout}
              className="mt-auto md:mt-0 w-full text-left px-4 py-3.5 md:px-4 md:py-2.5 text-sm md:font-bold rounded-2xl md:rounded-lg transition-all flex items-center shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] md:shadow-none border border-rose-100 md:border-transparent bg-rose-50 md:bg-transparent text-rose-600 dark:text-rose-404 hover:bg-rose-100 md:hover:bg-rose-50 dark:hover:bg-rose-900/30 active:scale-[0.98]">
              <div className="md:hidden p-2 rounded-xl bg-white text-rose-500 mr-3"><LogOut className="w-4 h-4" /></div>
              <LogOut className="hidden md:block w-4 h-4 mr-2 opacity-70" /> 
              <span className="font-bold text-[14px] md:text-sm">Sair da Conta</span>
              <ChevronRight className="md:hidden w-4 h-4 ml-auto text-rose-300" />
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
            
            {activePanel === 'ia' && (
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

            {activePanel === 'pluggy' && (
              <PluggySettingsPanel 
                user={user} 
                profile={profile} 
                transactions={transactions} 
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
});
