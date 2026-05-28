import React, { useState } from 'react';
import { Brain } from 'lucide-react';

interface AIConfirmationModalProps {
  isOpen: boolean;
  onConfirm: (dontAskAgain: boolean) => void;
  onCancel: () => void;
}

export function AIConfirmationModal({ isOpen, onConfirm, onCancel }: AIConfirmationModalProps) {
  const [dontAskAgain, setDontAskAgain] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/65 backdrop-blur-sm animate-fade-in" id="ai-confirm-dialog-overlay">
      <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-md p-6 shadow-xl border border-slate-150 dark:border-slate-750 animate-scale-in" id="ai-confirm-dialog">
        <div className="flex items-center gap-3 text-emerald-600 dark:text-emerald-400 mb-4">
          <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl">
            <Brain className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-lg text-slate-850 dark:text-slate-100">Confirmação de Envio para IA</h3>
        </div>
        
        <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed mb-5">
          Esta ação enviará os dados necessários para a tarefa ao provedor de IA configurado usando sua própria chave. Deseja continuar?
        </p>

        <div className="flex items-center gap-2 mb-6">
          <input
            id="dont-ask-session"
            type="checkbox"
            checked={dontAskAgain}
            onChange={(e) => setDontAskAgain(e.target.checked)}
            className="w-4 h-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500 cursor-pointer"
          />
          <label htmlFor="dont-ask-session" className="text-xs text-slate-500 dark:text-slate-400 font-medium cursor-pointer select-none">
            Não perguntar novamente nesta sessão.
          </label>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            id="ai-confirm-btn-cancel"
            onClick={onCancel}
            className="px-4 py-2 border border-slate-200 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            id="ai-confirm-btn-approve"
            onClick={() => onConfirm(dontAskAgain)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-xl text-xs font-bold text-white transition-colors"
          >
            Continuar
          </button>
        </div>
      </div>
    </div>
  );
}
