import React from 'react';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
  label: string;
  description?: string;
  id?: string;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  loading = false,
  label,
  description,
  id,
}) => {
  const switchId = id || `toggle-switch-${label.replace(/\s+/g, '-').toLowerCase()}`;

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    if (disabled || loading) return;
    onChange(!checked);
  };

  return (
    <div className="flex items-center justify-between py-2 transition-colors duration-200">
      <div className="flex flex-col pr-4">
        <label
          htmlFor={switchId}
          className={`text-sm font-medium transition-colors duration-150 select-none ${
            disabled ? 'text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-200'
          }`}
        >
          {label}
        </label>
        {description && (
          <span
            className={`text-xs mt-0.5 transition-colors duration-150 ${
              disabled ? 'text-slate-300 dark:text-slate-600' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {description}
          </span>
        )}
      </div>

      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled || loading}
        onClick={handleToggle}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${
          checked 
            ? (disabled ? 'bg-emerald-300 dark:bg-emerald-800' : 'bg-emerald-600') 
            : (disabled ? 'bg-slate-200 dark:bg-slate-800' : 'bg-slate-300 dark:bg-slate-700')
        } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        <span
          className={`pointer-events-none relative inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out flex items-center justify-center ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        >
          {loading && (
            <svg
              className="animate-spin h-3.5 w-3.5 text-emerald-600"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          )}
        </span>
      </button>
    </div>
  );
};
