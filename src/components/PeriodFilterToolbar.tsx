import React from 'react';
import { FilterConfig } from '../App';
import { Calendar, ChevronRight, Infinity } from 'lucide-react';

interface PeriodFilterToolbarProps {
  filterConfig: FilterConfig;
  setFilterConfig: (config: FilterConfig) => void;
}

export const PeriodFilterToolbar = React.memo(function PeriodFilterToolbar({ filterConfig, setFilterConfig }: PeriodFilterToolbarProps) {
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
    { value: 12, label: 'Dezembro' }
  ];

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  const getTabClass = (type: string) => {
    const isActive = filterConfig.type === type;
    return `px-3 py-1.5 text-[11px] font-bold rounded-md transition-all whitespace-nowrap ${
      isActive 
        ? 'bg-white shadow-sm text-emerald-700 border border-slate-200' 
        : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 border border-transparent'
    }`;
  };

  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center bg-white border border-slate-200 sm:rounded-xl rounded-2xl shadow-sm w-full sm:w-fit transition-all max-w-full">
      <div className="flex items-center gap-1 p-1 bg-slate-50/80 sm:bg-transparent border-b sm:border-b-0 sm:border-r border-slate-200 sm:h-[38px] sm:rounded-l-xl rounded-t-2xl">
        <button 
          onClick={() => setFilterConfig({ ...filterConfig, type: 'month' })}
          className={getTabClass('month')}
        >
          Mensal
        </button>
        <button 
          onClick={() => setFilterConfig({ ...filterConfig, type: 'year' })}
          className={getTabClass('year')}
        >
          Anual
        </button>
        <button 
          onClick={() => setFilterConfig({ ...filterConfig, type: 'custom' })}
          className={getTabClass('custom')}
        >
          Período
        </button>
        <button 
          onClick={() => setFilterConfig({ ...filterConfig, type: 'all' })}
          className={getTabClass('all')}
        >
          Tudo
        </button>
      </div>

      <div className="flex items-center px-4 py-2 sm:py-0 sm:h-[38px] min-w-0 sm:min-w-[240px] justify-center bg-white sm:rounded-r-xl rounded-b-2xl">
        {filterConfig.type === 'month' && (
          <div className="flex items-center gap-2 w-full justify-center">
            <select 
              value={filterConfig.month}
              onChange={(e) => setFilterConfig({ ...filterConfig, month: parseInt(e.target.value) })}
              className="bg-slate-50 sm:bg-transparent px-3 py-1.5 sm:px-0 sm:py-0 rounded-lg sm:rounded-none border border-slate-100 sm:border-none text-[12px] sm:text-[11px] font-bold text-slate-700 focus:outline-none cursor-pointer hover:text-emerald-700 transition-colors w-full sm:w-auto text-center appearance-none"
            >
              {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <span className="text-slate-300 hidden sm:inline">/</span>
            <select 
              value={filterConfig.year}
              onChange={(e) => setFilterConfig({ ...filterConfig, year: parseInt(e.target.value) })}
              className="bg-slate-50 sm:bg-transparent px-3 py-1.5 sm:px-0 sm:py-0 rounded-lg sm:rounded-none border border-slate-100 sm:border-none text-[12px] sm:text-[11px] font-bold text-slate-700 focus:outline-none cursor-pointer hover:text-emerald-700 transition-colors w-full sm:w-auto text-center appearance-none"
            >
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        )}

        {filterConfig.type === 'year' && (
          <div className="flex items-center gap-2 w-full justify-center">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest hidden sm:inline">Ano de</span>
            <select 
              value={filterConfig.year}
              onChange={(e) => setFilterConfig({ ...filterConfig, year: parseInt(e.target.value) })}
              className="bg-slate-50 sm:bg-transparent px-4 py-2 sm:px-0 sm:py-0 rounded-lg sm:rounded-none border border-slate-100 sm:border-none text-[12px] sm:text-[11px] font-bold text-slate-700 focus:outline-none cursor-pointer hover:text-emerald-700 transition-colors w-full sm:w-auto text-center appearance-none"
            >
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        )}

        {filterConfig.type === 'custom' && (
          <div className="flex items-center gap-0.5 sm:gap-2 w-full justify-center px-1 sm:px-0">
            <div className="flex items-center gap-1 focus-within:text-emerald-600 text-slate-500 transition-colors bg-slate-50 sm:bg-transparent px-1.5 py-1 sm:p-0 rounded-lg sm:rounded-none border border-slate-100 sm:border-transparent min-w-0 flex-1 sm:flex-none sm:w-auto overflow-hidden">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0 hidden sm:block" />
              <input 
                type="date" 
                value={filterConfig.startDate}
                onChange={(e) => setFilterConfig({ ...filterConfig, startDate: e.target.value })}
                className="bg-transparent text-[10px] sm:text-[11px] font-bold text-slate-700 focus:outline-none cursor-pointer w-full sm:w-[100px]" 
              />
            </div>
            <ChevronRight className="w-3 h-3 text-slate-300 flex-shrink-0" />
            <div className="flex items-center gap-1 focus-within:text-emerald-600 text-slate-500 transition-colors bg-slate-50 sm:bg-transparent px-1.5 py-1 sm:p-0 rounded-lg sm:rounded-none border border-slate-100 sm:border-transparent min-w-0 flex-1 sm:flex-none sm:w-auto overflow-hidden">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0 hidden sm:block" />
              <input 
                type="date" 
                value={filterConfig.endDate}
                onChange={(e) => setFilterConfig({ ...filterConfig, endDate: e.target.value })}
                className="bg-transparent text-[10px] sm:text-[11px] font-bold text-slate-700 focus:outline-none cursor-pointer w-full sm:w-[100px]" 
              />
            </div>
          </div>
        )}

        {filterConfig.type === 'all' && (
          <div className="flex items-center gap-2 w-full justify-center text-slate-400 py-1 sm:py-0">
            <Infinity className="w-4 h-4" />
            <span className="text-[11px] sm:text-[10px] font-bold uppercase tracking-widest">Todo o Período</span>
          </div>
        )}
      </div>
    </div>
  );
});
