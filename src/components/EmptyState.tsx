import React from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';

interface EmptyStateProps {
  onNavigateImport: () => void;
  pluggyItemIdsCount?: number;
  onSyncPluggy?: () => void;
  isSyncingPluggy?: boolean;
}

export function EmptyState({ 
  onNavigateImport, 
  pluggyItemIdsCount = 0, 
  onSyncPluggy, 
  isSyncingPluggy = false 
}: EmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col w-full h-full overflow-y-auto bg-slate-50 dark:bg-slate-900 border-none m-0 p-0">
      <div className="flex-1 flex flex-col w-full max-w-lg mx-auto p-6 pb-28 sm:pb-12 sm:p-8 min-h-min justify-center my-auto border-none">
        <div className="text-center mb-6 sm:mb-10 mt-auto sm:mt-0 pt-4 sm:pt-0">
          <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight leading-tight">Olá! 👋</h1>
          <p className="text-slate-500 mt-2 sm:mt-3 text-[17px] sm:text-xl font-medium">Sincronize sua vida financeira agora.</p>
        </div>
        <div className="bg-white rounded-[28px] sm:rounded-3xl border border-slate-100 sm:border-slate-200 p-6 sm:p-12 text-center shadow-[0_8px_30px_rgb(0,0,0,0.06)] sm:shadow-lg flex flex-col items-center mb-auto sm:mb-0">
          <div className="w-20 h-20 sm:w-24 sm:h-24 bg-emerald-50 sm:bg-emerald-100/50 rounded-full flex items-center justify-center mb-5 sm:mb-8 flex-shrink-0">
            <BarChart3 className="w-10 h-10 sm:w-12 sm:h-12 text-emerald-500 sm:text-emerald-500" />
          </div>
          <h3 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight mb-2 sm:mb-3">Nenhum dado na sua nuvem</h3>
          <p className="text-slate-500 max-w-sm mx-auto text-[15px] sm:text-sm leading-relaxed mb-6 sm:mb-8">
            {pluggyItemIdsCount > 0
              ? 'Importe seus extratos ou sincronize suas contas Pluggy para começar a visualizar sua vida financeira.'
              : 'Vá para a aba Importar Dados e envie seus extratos bancários para começar.'}
          </p>
          
          <div className="flex flex-col sm:flex-row gap-3 w-full justify-center">
            <button onClick={onNavigateImport} className="px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-[20px] sm:rounded-2xl hover:shadow-lg transition-all text-sm active:scale-[0.98] sm:active:scale-100 flex items-center justify-center gap-2 flex-shrink-0">
              Começar Importação
            </button>
            {pluggyItemIdsCount > 0 && onSyncPluggy && (
              <button 
                onClick={onSyncPluggy} 
                disabled={isSyncingPluggy}
                className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-[20px] sm:rounded-2xl hover:shadow-lg transition-all text-sm active:scale-[0.98] sm:active:scale-100 flex items-center justify-center gap-2 flex-shrink-0 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncingPluggy ? 'animate-spin' : ''}`} />
                {isSyncingPluggy ? 'Sincronizando...' : 'Sincronizar Pluggy'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
