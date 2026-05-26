import React, { useState, useRef } from 'react';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { X, Plus, Trash2, Edit3, Save, Tag } from 'lucide-react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile } from '../App';
import { toast } from 'sonner';

interface CategoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
}

const DEFAULT_CATEGORIES = [
  'Alimentação', 'Transporte', 'Lazer', 'Saúde', 
  'Educação', 'Moradia', 'Salário', 'Investimentos'
];

export const CategoriesModal = React.memo(function CategoriesModal({ isOpen, onClose, profile }: CategoriesModalProps) {
  const [newCat, setNewCat] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);

  const { viewportHeight, offsetTop, isKeyboardOpen } = useVisualViewport();
  const [dragY, setDragY] = useState(0);
  const startYRef = useRef(0);

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
      onClose();
      setTimeout(() => setDragY(0), 300);
    } else {
      setDragY(0);
    }
  };

  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setTimeout(() => {
      e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  };

  const categories = profile.categories || DEFAULT_CATEGORIES;

  const handleUpdate = async (newCategories: string[]) => {
    try {
      await updateDoc(doc(db, 'users', profile.userId), {
        categories: newCategories,
        updatedAt: serverTimestamp()
      });
      toast.success('Categorias salvas com sucesso!');
    } catch (e: any) {
      console.error('Category update failed:', e.message || e);
      toast.error('Erro ao atualizar categorias: ' + (e.message || e));
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCat.trim();
    if (!trimmed) return;
    
    // Case-insensitive check for duplicates
    if (categories.some(cat => cat.toLowerCase() === trimmed.toLowerCase())) {
      toast.error('Essa categoria já existe!');
      return;
    }

    const newCategories = [...categories, trimmed];
    await handleUpdate(newCategories);
    setNewCat('');
  };

  const handleEditSave = async (index: number) => {
    const trimmed = editValue.trim();
    if (!trimmed) return;
    
    const newCategories = [...categories];
    newCategories[index] = trimmed;
    
    await handleUpdate(newCategories);
    setEditingIndex(null);
  };

  const handleDelete = async (index: number) => {
    if (deletingIndex !== index) {
      setDeletingIndex(index);
      return;
    }
    
    const newCategories = categories.filter((_, i) => i !== index);
    await handleUpdate(newCategories);
    setDeletingIndex(null);
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-slate-900/40 sm:bg-slate-900/60 z-[100] flex flex-col justify-end sm:items-center sm:justify-center backdrop-blur-sm sm:backdrop-blur-md pt-10 sm:pt-4 sm:p-4 transition-all"
      onClick={onClose}
      style={{ 
        opacity: dragY > 0 ? 1 - (dragY / 500) : 1,
        height: viewportHeight > 0 && typeof window !== 'undefined' && window.innerWidth < 640 ? `${viewportHeight}px` : undefined,
        top: offsetTop > 0 && typeof window !== 'undefined' && window.innerWidth < 640 ? `${offsetTop}px` : undefined,
      }}
    >
      <div 
        className="bg-white rounded-t-[32px] sm:rounded-[32px] shadow-2xl w-full max-h-[90%] sm:h-auto sm:max-h-[90vh] sm:max-w-md overflow-hidden flex flex-col transform transition-all border-t sm:border border-slate-200 animate-in slide-in-from-bottom-10 duration-300 relative"
        onClick={e => e.stopPropagation()}
        style={{ 
            transform: dragY > 0 ? `translateY(${dragY}px)` : 'translateY(0)',
            transition: dragY > 0 ? 'none' : 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)'
        }}
      >
        <div 
          className="relative px-6 py-5 sm:py-6 pt-7 sm:pt-6 border-b flex-shrink-0 touch-none sm:touch-auto transition-colors duration-300 bg-slate-50/50 border-slate-100"
          onTouchStart={handleTouchStart} 
          onTouchMove={handleTouchMove} 
          onTouchEnd={handleTouchEnd}
        >
          {/* Handle Mobile */}
          <div className="w-12 h-1.5 bg-slate-200 rounded-full absolute top-3 left-1/2 -translate-x-1/2 sm:hidden cursor-grab active:cursor-grabbing hover:bg-slate-300 transition-colors" />

          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-800 flex items-center gap-2 tracking-tight">
              <Tag className="w-5 h-5 text-indigo-600" />
              Gerenciar Categorias
            </h3>
            <button 
              onClick={onClose}
              className="p-2 sm:p-2.5 hover:bg-slate-200 rounded-full transition-colors text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        <div className="p-6 flex-1 overflow-y-auto pb-24 sm:pb-6">
          <form onSubmit={handleAdd} className="flex gap-2 max-sm:flex-col mb-6 flex-shrink-0">
            <input 
              type="text" 
              maxLength={30}
              enterKeyHint="send"
              tabIndex={1}
              placeholder="Nova categoria..."
              value={newCat}
              onFocus={handleInputFocus}
              onChange={e => setNewCat(e.target.value)}
              className="flex-1 w-full px-4 py-3.5 sm:py-3 bg-slate-50/80 border border-slate-200/80 rounded-xl text-[16px] sm:text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 transition-all placeholder:text-slate-400"
            />
            <button 
              type="submit"
              disabled={!newCat.trim()}
              className="px-6 py-3.5 sm:py-3 bg-indigo-400 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-sm active:scale-[0.98] disabled:active:scale-100 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" /> Adicionar
            </button>
          </form>

          <div className="space-y-3">
            {categories.map((cat, index) => (
              <div key={`${cat}-${index}`} className="flex items-center justify-between p-4 sm:p-3.5 bg-slate-50/80 border border-slate-100 rounded-2xl sm:rounded-xl group hover:border-slate-200 transition-all">
                {editingIndex === index ? (
                  <div className="flex-1 flex gap-2 mr-2">
                    <input 
                      autoFocus
                      type="text"
                      maxLength={30}
                      enterKeyHint="send"
                      tabIndex={1}
                      value={editValue}
                      onFocus={handleInputFocus}
                      onChange={e => setEditValue(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleEditSave(index)}
                      className="flex-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-[16px] sm:text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-indigo-500/10 text-slate-800"
                    />
                  </div>
                ) : (
                  <div className="flex-1 text-[15px] font-bold text-slate-800 truncate mr-2 ml-1">
                    {cat}
                  </div>
                )}

                <div className="flex items-center gap-1.5 mr-1">
                  {editingIndex === index ? (
                    <>
                      <button 
                        onClick={() => handleEditSave(index)}
                        disabled={!editValue.trim()}
                        className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                        title="Salvar"
                      >
                        <Save className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => setEditingIndex(null)}
                        className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors"
                        title="Cancelar"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      {deletingIndex === index ? (
                        <button 
                          onClick={() => handleDelete(index)}
                          className="px-3 py-1.5 text-xs font-bold text-white bg-rose-600 rounded-lg hover:bg-rose-700 transition-all shadow-sm active:scale-95"
                        >
                          Confirmar
                        </button>
                      ) : (
                        <>
                          <button 
                            onClick={() => {
                              setEditingIndex(index);
                              setEditValue(cat);
                              setDeletingIndex(null);
                            }}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                            title="Editar"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDelete(index)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                            title="Excluir"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});
