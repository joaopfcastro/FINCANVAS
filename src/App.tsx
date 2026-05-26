import React, { useState, useEffect, useRef } from 'react';
import { Toaster, toast } from 'sonner';
import { auth, googleProvider, db, handleFirestoreError, OperationType } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, collection, query, where, serverTimestamp } from 'firebase/firestore';
import { Wallet, LayoutDashboard, UploadCloud, PieChart, Settings, CloudCog, Menu, CheckCircle2, AlertCircle, Loader2, LogOut, PlusCircle, Eye, EyeOff, Tag } from 'lucide-react';
import { DashboardView } from './components/DashboardView';
import { ImportView } from './components/ImportView';
import { ReportsView } from './components/ReportsView';
import { SettingsView } from './components/SettingsView';
import { ManualEntryModal } from './components/ManualEntryModal';
import { CategoriesModal } from './components/CategoriesModal';

export interface FilterConfig {
  type: 'month' | 'year' | 'custom' | 'all';
  month: number;
  year: number;
  startDate: string;
  endDate: string;
}

export interface UserProfile {
  userId: string;
  highSpendingAlerts: boolean;
  categories?: string[];
  darkMode?: boolean;
  phone?: string;
  pluggyClientId?: string;
  pluggyClientSecret?: string;
  pluggyItemIds?: string[];
  createdAt: any;
  updatedAt: any;
}

export interface Transaction {
  id?: string;
  date: string;
  desc: string;
  cat: string;
  type: 'Receita' | 'Despesa';
  amount: number;
  source: string;
  userId: string;
  pluggyId?: string;
  createdAt: any;
  updatedAt: any;
  // Audit and normalized metadata:
  rawAmount?: number;
  sourceRaw?: string;
  bankRawName?: string;
  accountRawName?: string;
  accountLabel?: string;
  accountId?: string;
  itemId?: string;
  pluggyType?: string;
  accountType?: string;
  accountSubtype?: string;
  operationType?: string | null;
  paymentData?: any;
  merchant?: string | null;
  descriptionRaw?: string;
  detectedDirection?: 'Receita' | 'Despesa';
  directionConfidence?: number;
  directionReason?: string;
  isLikelyInternalTransfer?: boolean;
  shouldIgnoreInTotals?: boolean;
}

type View = 'dashboard' | 'import' | 'reports' | 'settings';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(true);
  const [loadingContext, setLoadingContext] = useState(true);
  const [activeView, setActiveView] = useState<View>('dashboard');
  const [authError, setAuthError] = useState('');
  const [showManualModal, setShowManualModal] = useState(false);
  const [showCategoriesModal, setShowCategoriesModal] = useState(false);
  const [transactionToEdit, setTransactionToEdit] = useState<Transaction | null>(null);

  const handleNavigateImport = React.useCallback(() => setActiveView('import'), []);
  const handleNavigateDashboard = React.useCallback(() => setActiveView('dashboard'), []);
  
  const handleOpenManualEntry = React.useCallback(() => {
    setTransactionToEdit(null);
    setShowManualModal(true);
  }, []);

  const handleEditTransaction = React.useCallback((t: Transaction) => {
    setTransactionToEdit(t);
    setShowManualModal(true);
  }, []);

  const handleCloseManualModal = React.useCallback(() => {
    setShowManualModal(false);
    setTransactionToEdit(null);
  }, []);
  const handleCloseCategoriesModal = React.useCallback(() => setShowCategoriesModal(false), []);

  const [filterConfig, setFilterConfig] = useState<FilterConfig>({
    type: 'month',
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    startDate: '',
    endDate: ''
  });

  const months = [
    { value: 1, label: 'Janeiro' },
    { value: 2, label: 'Fevereiro' },
    { value: 3, label: 'Março' },
    { value: 4, label: 'Abril' },
    { value: 5, label: 'Maio' },
    { value: 6, label: 'Junho' },
    { value: 7, label: 'Julho' },
    { value: 8, label: 'Agosto' },
    { value: 9, label: 'Setembro' },
    { value: 10, label: 'Outubro' },
    { value: 11, label: 'Novembro' },
    { value: 12, label: 'Dezembro' },
  ];

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  useEffect(() => {
    let profileUnsub: () => void;
    const authUnsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const profileRef = doc(db, 'users', u.uid);
          profileUnsub = onSnapshot(profileRef, { includeMetadataChanges: true }, async (snap) => {
            if (snap.metadata.fromCache && !snap.exists()) {
              return; // Wait for the server before assuming the user doesn't exist
            }
            if (snap.exists()) {
              setProfile(snap.data() as UserProfile);
            } else {
              const newProfile: UserProfile = {
                userId: u.uid,
                highSpendingAlerts: true,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
              };
              try {
                await setDoc(profileRef, newProfile);
                setProfile(newProfile); 
              } catch (e) {
                console.error("Failed to create profile:", e);
              }
            }
            setLoadingContext(false);
          }, (err) => {
            handleFirestoreError(err, OperationType.GET, `users/${u.uid}`);
            setLoadingContext(false);
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `users/${u.uid}`);
          setLoadingContext(false);
        }
      } else {
        if (profileUnsub) profileUnsub();
        setProfile(null);
        setTransactions([]);
        setLoadingContext(false);
      }
    });
    return () => {
      authUnsub();
      if (profileUnsub) profileUnsub();
    };
  }, []);

  useEffect(() => {
    let unsubs: () => void;
    if (!user) {
      setTransactions([]);
      setLoadingTransactions(false);
      return;
    }
    setLoadingTransactions(true);
    const colRef = collection(db, 'transactions');
    import('firebase/firestore').then(({ query, where }) => {
      const q = query(colRef, where('userId', '==', user.uid));
      unsubs = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
        if (snap.metadata.fromCache && snap.empty) {
          return; // Wait for the server before assuming there are no transactions
        }
        const trxs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction));
        setTransactions(trxs);
        setLoadingTransactions(false);
      }, err => {
        setLoadingTransactions(false);
        handleFirestoreError(err, OperationType.LIST, 'transactions');
      });
    });
    return () => {
      if (unsubs) unsubs();
    };
  }, [user]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const handleNextInput = (e: React.KeyboardEvent<HTMLInputElement>, nextRef: React.RefObject<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      nextRef.current?.focus();
    }
  };

  const handleAuthError = (err: any) => {
    console.error("Auth Exception:", err);
    const errorCode = err?.code || '';
    const errorMessage = err?.message || String(err);

    if (errorCode.includes('operation-not-allowed') || errorMessage.includes('operation-not-allowed')) {
      setAuthError('Autenticação por e-mail não ativada. Acesse o Firebase Console > Authentication > Settings e ative o provedor "Email/Password".');
    } else if (
      errorCode.includes('invalid-credential') || errorMessage.includes('invalid-credential') || 
      errorCode.includes('user-not-found') || errorMessage.includes('user-not-found') ||
      errorCode.includes('wrong-password') || errorMessage.includes('wrong-password') ||
      errorCode.includes('invalid-login-credentials') || errorMessage.includes('invalid-login-credentials')
    ) {
      setAuthError('E-mail ou senha incorretos, ou conta não cadastrada.');
    } else {
      setAuthError('Erro de autenticação: ' + errorCode.replace('auth/', '').replace(/-/g, ' '));
    }
  };

  const handleLogin = async () => {
    let fallbackTimer: any;
    
    const cleanupListeners = () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };

    const handleFocus = () => {
      // Quando a janela volta ao foco (pop-up fechado), esperamos um instante para ver se a promise rejeita ou resolve.
      // Se não houver resposta nativa da API, nós destravamos o UI para evitar carregamento infinito.
      if (fallbackTimer) clearTimeout(fallbackTimer);
      fallbackTimer = setTimeout(() => {
        setIsAuthLoading((prev) => {
          if (prev) {
            console.log('Destravando UI via fallback de foco.');
            return false;
          }
          return prev;
        });
        cleanupListeners();
      }, 1500);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
         handleFocus();
      }
    };

    try {
      setAuthError('');
      setAuthMessage('');
      setIsAuthLoading(true);

      // Limpa possíveis referências antigas antes de adicionar novos
      cleanupListeners();

      window.addEventListener('focus', handleFocus);
      document.addEventListener('visibilitychange', handleVisibilityChange);

      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      const errorCode = err?.code || '';
      // Captura o fechamento do pop-up ou cancelamento de forma explícita
      if (
        errorCode === 'auth/popup-closed-by-user' || 
        errorCode === 'auth/cancelled-popup-request' ||
        errorCode === 'auth/popup-blocked'
      ) {
        console.log('Interação com o pop-up de login foi cancelada ou bloqueada pela API nativa.');
      } else {
        handleAuthError(err);
      }
    } finally {
      setIsAuthLoading(false);
      cleanupListeners();
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthMessage('');
    
    // Purificar e validar dados contra injeção (Sanitization)
    const sanitizedEmail = email.trim();
    
    if (!sanitizedEmail || !password) {
      setAuthError('Preencha email e senha.');
      return;
    }

    // Regras estritas para e-mail para evitar XSS e Injeção
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(sanitizedEmail) || /[<>{}[\]\\;'"`]/.test(sanitizedEmail)) {
      setAuthError('E-mail contém caracteres inválidos ou formato incorreto.');
      return;
    }

    if (sanitizedEmail.length > 100 || password.length > 100) {
      setAuthError('Tamanho de entrada excedeu o limite máximo (buffer overflow protection).');
      return;
    }
    
    // basic password length check
    if (isRegistering && password.length < 6) {
      setAuthError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    try {
      setIsAuthLoading(true);
      const { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification } = await import('firebase/auth');
      if (isRegistering) {
        const userCredential = await createUserWithEmailAndPassword(auth, sanitizedEmail, password);
        await sendEmailVerification(userCredential.user);
        
        // Success register
        setAuthMessage('Conta criada com sucesso! Enviamos um link de confirmação para o seu e-mail. Verifique sua caixa de entrada.');
        await signOut(auth); // force them to verify before actually using it
        
        // Clear fields and switch to login
        setEmail('');
        setPassword('');
        setIsRegistering(false);
      } else {
        const userCredential = await signInWithEmailAndPassword(auth, sanitizedEmail, password);
        if (!userCredential.user.emailVerified) {
          setAuthError('Por favor, verifique seu e-mail antes de acessar. (Se não recebeu, clique em "Esqueceu a senha?")');
          await signOut(auth);
        }
      }
    } catch (err: any) {
      handleAuthError(err);
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleResetPassword = async () => {
    setAuthError('');
    setAuthMessage('');
    
    const sanitizedEmail = email.trim();
    if (!sanitizedEmail) {
      setAuthError('Preencha seu e-mail no campo acima para recuperar a senha.');
      return;
    }
    
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(sanitizedEmail) || /[<>{}[\]\\;'"`]/.test(sanitizedEmail)) {
      setAuthError('E-mail contém caracteres inválidos ou formato incorreto.');
      return;
    }
    
    try {
      setIsAuthLoading(true);
      const { sendPasswordResetEmail } = await import('firebase/auth');
      await sendPasswordResetEmail(auth, sanitizedEmail);
      setAuthMessage('Instruções de recuperação de senha enviadas para o seu e-mail.');
    } catch (err: any) {
      handleAuthError(err);
    } finally {
      setIsAuthLoading(false);
    }
  };

  const toggleRegisterMode = () => {
    setIsRegistering(!isRegistering);
    setAuthError('');
    setAuthMessage('');
    // Optionally clear fields when switching context
    setEmail('');
    setPassword('');
  };

  useEffect(() => {
    if (profile?.darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [profile?.darkMode]);

  if (loadingContext) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <div className="flex min-h-[100dvh] bg-white md:bg-slate-100 p-4 md:py-8 md:px-4 font-sans justify-center items-center">
        <div className="bg-white md:rounded-2xl md:shadow-xl w-full max-w-4xl flex flex-col md:flex-row md:overflow-hidden border-0 md:border border-slate-200">
          <div className="hidden md:flex w-full md:w-5/12 bg-gradient-to-br from-emerald-600 to-emerald-800 text-white p-6 sm:p-8 md:p-10 flex-col justify-between shrink-0">
            <div>
              <div className="flex items-center mb-8">
                <Wallet className="w-8 h-8 mr-3 text-white" />
                <span className="font-bold text-2xl tracking-tight">FinCanvas IA</span>
              </div>
              <h2 className="text-3xl font-bold mb-4 leading-tight">Assuma o controle total do seu dinheiro.</h2>
              <p className="text-emerald-100 mb-8 font-medium text-lg leading-relaxed">
                Transforme sua relação com o dinheiro usando inteligência artificial. Organize, planeje e alcance suas metas financeiras com total segurança e privacidade.
              </p>
            </div>
            <div className="space-y-4 text-sm text-emerald-100 font-medium">
              <div className="flex items-center"><CheckCircle2 className="w-5 h-5 mr-3 text-emerald-300" /> Autenticação Segura</div>
              <div className="flex items-center"><CheckCircle2 className="w-5 h-5 mr-3 text-emerald-300" /> Inteligência Artificial Integrada</div>
              <div className="flex items-center"><CheckCircle2 className="w-5 h-5 mr-3 text-emerald-300" /> Privacidade Total dos seus Dados</div>
            </div>
          </div>
          <div className="w-full md:w-7/12 p-2 sm:p-12 bg-white flex flex-col justify-center max-w-sm mx-auto md:max-w-none">
            <div className="flex md:hidden items-center justify-center mb-8">
              <Wallet className="w-8 h-8 mr-3 text-emerald-600" />
              <span className="font-bold text-2xl tracking-tight text-slate-800">FinCanvas IA</span>
            </div>
            <h3 className="text-2xl font-bold text-slate-800 mb-2 text-center md:text-left">
              {isRegistering ? 'Criar Nova Conta' : 'Acessar Conta'}
            </h3>
            <p className="text-slate-500 mb-6 text-sm font-medium text-center md:text-left">
              {isRegistering ? 'Cadastre-se com e-mail e senha ou use sua conta Google.' : 'Acesse com e-mail e senha ou use sua conta Google.'}
            </p>
            {authError && (
              <div className="mb-4 p-4 bg-rose-50 border-l-4 border-rose-500 text-rose-700 text-sm font-bold rounded-r-md flex items-start">
                <AlertCircle className="w-5 h-5 mr-2 flex-shrink-0" />
                <span>{authError}</span>
              </div>
            )}
            {authMessage && (
              <div className="mb-4 p-4 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 text-sm font-bold rounded-r-md flex items-start">
                <CheckCircle2 className="w-5 h-5 mr-2 flex-shrink-0" />
                <span>{authMessage}</span>
              </div>
            )}
            
            <form onSubmit={handleEmailAuth} className="space-y-4 mb-6">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">E-mail</label>
                <input 
                  ref={emailRef}
                  type="email" 
                  tabIndex={1}
                  enterKeyHint="next"
                  maxLength={100}
                  value={email}
                  disabled={isAuthLoading}
                  onChange={(e) => { setEmail(e.target.value); setAuthError(''); setAuthMessage(''); }}
                  onKeyDown={e => handleNextInput(e, passwordRef)}
                  className="w-full px-3 py-2 text-[16px] sm:text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:opacity-50 transition-shadow" 
                  placeholder="Seu e-mail"
                />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-xs font-bold text-slate-700">Senha</label>
                  {!isRegistering && (
                    <button 
                      type="button" 
                      tabIndex={-1}
                      onClick={handleResetPassword}
                      disabled={isAuthLoading}
                      className="text-xs text-emerald-600 hover:text-emerald-700 font-bold disabled:opacity-50"
                    >
                      Esqueceu a senha?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input 
                    ref={passwordRef}
                    type={showPassword ? "text" : "password"} 
                    tabIndex={2}
                    enterKeyHint="send"
                    maxLength={100}
                    value={password}
                    disabled={isAuthLoading}
                    onChange={(e) => { setPassword(e.target.value); setAuthError(''); setAuthMessage(''); }}
                    className="w-full px-3 py-2 pr-10 text-[16px] sm:text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:opacity-50 transition-shadow" 
                    placeholder="Sua senha"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-emerald-600 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button type="submit" tabIndex={4} disabled={isAuthLoading} className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold rounded shadow-sm transition-colors flex items-center justify-center">
                {isAuthLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (isRegistering ? 'Registrar via E-mail' : 'Entrar com E-mail')}
              </button>
            </form>

            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-slate-500 font-medium">Ou continue com</span>
              </div>
            </div>

            <button onClick={handleLogin} tabIndex={6} disabled={isAuthLoading} className="w-full py-2.5 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-sm font-bold rounded shadow-sm transition-colors flex items-center justify-center mb-6">
              {isAuthLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                <>
                  <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Google
                </>
              )}
            </button>
            
            <p className="text-center text-sm font-medium text-slate-500">
              {isRegistering ? 'Já tem uma conta?' : 'Ainda não tem conta?'}
              <button 
                type="button"
                tabIndex={7}
                onClick={toggleRegisterMode} 
                disabled={isAuthLoading}
                className="ml-1 text-emerald-600 hover:text-emerald-700 font-bold disabled:opacity-50"
              >
                {isRegistering ? 'Entrar' : 'Cadastre-se'}
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="text-slate-900 dark:text-slate-100 h-[100dvh] w-full flex flex-col md:flex-row overflow-hidden overscroll-none bg-slate-50 dark:bg-slate-900 font-sans">
      <Toaster position="top-right" richColors />
      <aside className="w-64 flex-shrink-0 border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hidden md:flex flex-col z-20">
        <div className="p-6 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-500">
            <Wallet className="w-8 h-8" />
            <span className="font-bold text-xl tracking-tight text-slate-800 dark:text-slate-100">FinCanvas IA</span>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-3 mb-2">Menu Principal</div>
          <button onClick={() => setActiveView('dashboard')} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${activeView === 'dashboard' ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 font-medium'}`}>
            <LayoutDashboard className="w-5 h-5" /> Dashboard
          </button>
          <button onClick={() => setActiveView('import')} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${activeView === 'import' ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 font-medium'}`}>
            <UploadCloud className="w-5 h-5" /> Importar Dados
          </button>
          <button onClick={() => setActiveView('reports')} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${activeView === 'reports' ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 font-medium'}`}>
            <PieChart className="w-5 h-5" /> Relatórios & Insights
          </button>
          
          <div className="pt-4">
            <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-3 mb-2">Lançamentos</div>
            <button 
              onClick={() => {
                setTransactionToEdit(null);
                setShowManualModal(true);
              }} 
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${showManualModal && !transactionToEdit ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-semibold shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 hover:text-emerald-700 dark:hover:text-emerald-400 font-medium'}`}
            >
              <PlusCircle className="w-5 h-5" /> Adicionar Manualmente
            </button>
            <button 
              onClick={() => setShowCategoriesModal(true)} 
              className={`w-full mt-1 flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${showCategoriesModal ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-semibold shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:text-indigo-700 dark:hover:text-indigo-400 font-medium'}`}
            >
              <PieChart className="w-5 h-5" /> Gerenciar Categorias
            </button>
          </div>
          
          <div className="pt-4">
            <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-3 mb-2">Configurações</div>
            <button onClick={() => setActiveView('settings')} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${activeView === 'settings' ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 font-medium'}`}>
              <Settings className="w-5 h-5" /> Preferências
            </button>
            <button onClick={async () => {
              try { await signOut(auth); } catch (e) { console.error(e); }
            }} className="w-full mt-1 flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 font-medium">
              <LogOut className="w-5 h-5" /> Sair da Conta
            </button>
          </div>
        </nav>
        <div className="p-4 border-t border-slate-100 dark:border-slate-700">
          <button 
            onClick={() => setActiveView('settings')}
            className="w-full text-left flex items-center gap-3 bg-slate-50 dark:bg-slate-700/30 p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
          >
            <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-xs shadow-sm uppercase overflow-hidden">
               {user.photoURL ? (
                  <img src={user.photoURL} alt="Avatar" className="w-full h-full object-cover" />
               ) : (
                  user.displayName?.[0] || user.email?.[0] || 'U'
               )}
            </div>
            <div className="flex-1 overflow-hidden">
              <div className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{user.displayName || 'Usuário'}</div>
              <div className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Configurar Perfil
              </div>
            </div>
          </button>
        </div>
      </aside>

      {/* Mobile Top Header */}
      <div className="md:hidden flex flex-shrink-0 items-center justify-between p-4 bg-white/80 dark:bg-slate-800/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-700 z-20 shadow-sm sticky top-0">
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-500">
          <Wallet className="w-6 h-6" />
          <span className="font-bold text-lg tracking-tight text-slate-800 dark:text-slate-100">FinCanvas IA</span>
        </div>
        <div className="flex items-center">
           <button 
             onClick={() => setActiveView('settings')}
             className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center p-0.5 shadow-inner transition-transform active:scale-95"
           >
              <div className="w-full h-full rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-xs shadow-sm uppercase overflow-hidden border-2 border-white dark:border-slate-800">
                 {user.photoURL ? (
                    <img src={user.photoURL} alt="Avatar" className="w-full h-full object-cover" />
                 ) : (
                    user.displayName?.[0] || user.email?.[0] || 'U'
                 )}
              </div>
           </button>
        </div>
      </div>

      <main className="flex-1 flex flex-col min-w-0 min-h-0 bg-slate-50 dark:bg-slate-900 relative overflow-hidden">
        {activeView === 'dashboard' && (
          <DashboardView 
            transactions={transactions} 
            loadingTransactions={loadingTransactions}
            filterConfig={filterConfig}
            setFilterConfig={setFilterConfig}
            onNavigateImport={handleNavigateImport} 
            onOpenManualEntry={handleOpenManualEntry} 
            onEditTransaction={handleEditTransaction}
          />
        )}
        {activeView === 'import' && <ImportView userId={user.uid} onNavigateDashboard={handleNavigateDashboard} profile={profile} />}
        {activeView === 'reports' && (
          <ReportsView 
            transactions={transactions} 
            loadingTransactions={loadingTransactions}
            filterConfig={filterConfig}
            setFilterConfig={setFilterConfig}
            onEditTransaction={handleEditTransaction}
            onOpenManualEntry={handleOpenManualEntry}
            onNavigateImport={handleNavigateImport}
          />
        )}
        {activeView === 'settings' && <SettingsView user={user} profile={profile} transactions={transactions} />}
      </main>

      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl z-50 border-t border-slate-200/50 dark:border-slate-700/50 shadow-[0_-8px_20px_-6px_rgba(0,0,0,0.08)]" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}>
        <div className="flex justify-around items-end px-2 pt-2 pb-1 relative">
          <button onClick={() => setActiveView('dashboard')} className="flex flex-col items-center justify-center w-full h-14 transition-all active:scale-95">
            <div className={`mb-1 p-2 rounded-2xl transition-all duration-300 ${activeView === 'dashboard' ? 'bg-emerald-600 shadow-lg shadow-emerald-200 dark:shadow-emerald-900/40 text-white' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600'}`}>
              <LayoutDashboard className="w-5 h-5" />
            </div>
            <span className={`text-[10px] tracking-tight transition-all duration-300 min-h-[14px] flex items-center ${activeView === 'dashboard' ? 'font-bold text-emerald-700 dark:text-emerald-400' : 'font-medium text-slate-400'}`}>Início</span>
          </button>
          
          <button onClick={() => setActiveView('import')} className="flex flex-col items-center justify-center w-full h-14 transition-all active:scale-95">
            <div className={`mb-1 p-2 rounded-2xl transition-all duration-300 ${activeView === 'import' ? 'bg-emerald-600 shadow-lg shadow-emerald-200 dark:shadow-emerald-900/40 text-white' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600'}`}>
              <UploadCloud className="w-5 h-5" />
            </div>
            <span className={`text-[10px] tracking-tight transition-all duration-300 min-h-[14px] flex items-center ${activeView === 'import' ? 'font-bold text-emerald-700 dark:text-emerald-400' : 'font-medium text-slate-400'}`}>Importar</span>
          </button>
          
          <div className="relative px-2 flex justify-center w-full h-14 z-10 w-[70px]">
            <button 
              onClick={() => {
                setTransactionToEdit(null);
                setShowManualModal(true);
              }}
              className="absolute -top-7 w-14 h-14 bg-gradient-to-tr from-emerald-500 to-teal-400 rounded-2xl flex items-center justify-center text-white shadow-[0_8px_20px_-6px_rgba(16,185,129,0.5)] active:scale-95 transition-all outline outline-4 outline-slate-50 dark:outline-slate-900 shadow-emerald-500/40 rotate-[22deg] hover:rotate-[112deg] duration-300"
            >
              <PlusCircle className="w-7 h-7 -rotate-[22deg]" />
            </button>
          </div>

          <button onClick={() => setActiveView('reports')} className="flex flex-col items-center justify-center w-full h-14 transition-all active:scale-95">
            <div className={`mb-1 p-2 rounded-2xl transition-all duration-300 ${activeView === 'reports' ? 'bg-emerald-600 shadow-lg shadow-emerald-200 dark:shadow-emerald-900/40 text-white' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600'}`}>
              <PieChart className="w-5 h-5" />
            </div>
            <span className={`text-[10px] tracking-tight transition-all duration-300 min-h-[14px] flex items-center ${activeView === 'reports' ? 'font-bold text-emerald-700 dark:text-emerald-400' : 'font-medium text-slate-400'}`}>Análise</span>
          </button>

          <button onClick={() => setShowCategoriesModal(true)} className="flex flex-col items-center justify-center w-full h-14 transition-all active:scale-95">
            <div className={`mb-1 p-2 rounded-2xl transition-all duration-300 ${showCategoriesModal ? 'bg-indigo-600 shadow-lg shadow-indigo-200 dark:shadow-indigo-900/40 text-white' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600'}`}>
              <Tag className="w-5 h-5" />
            </div>
            <span className={`text-[10px] tracking-tight transition-all duration-300 min-h-[14px] flex items-center ${showCategoriesModal ? 'font-bold text-indigo-700 dark:text-indigo-400' : 'font-medium text-slate-400'}`}>Categorias</span>
          </button>
        </div>
      </div>

      <ManualEntryModal 
        isOpen={showManualModal} 
        onClose={handleCloseManualModal} 
        userId={user.uid}
        transaction={transactionToEdit}
        profile={profile}
        onNavigateImport={handleNavigateImport}
      />
      
      {profile && (
        <CategoriesModal 
          isOpen={showCategoriesModal}
          onClose={handleCloseCategoriesModal}
          profile={profile}
        />
      )}
    </div>
  );
}

