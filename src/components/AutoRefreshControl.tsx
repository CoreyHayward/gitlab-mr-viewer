'use client';

import { useState } from 'react';
import { ChevronDown, RefreshCcw } from 'lucide-react';

interface AutoRefreshControlProps {
  loading: boolean;
  onRefresh: () => void;
  autoRefreshEnabled: boolean;
  onAutoRefreshEnabledChange: (enabled: boolean) => void;
  className: string;
}

export default function AutoRefreshControl({
  loading,
  onRefresh,
  autoRefreshEnabled,
  onAutoRefreshEnabledChange,
  className
}: AutoRefreshControlProps) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  return (
    <div
      className="relative inline-flex items-stretch"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsPopoverOpen(false);
      }}
    >
      <button type="button" onClick={onRefresh} disabled={loading} className={`${className} rounded-r-none`}>
        <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        {loading ? 'Refreshing...' : 'Refresh'}
      </button>
      <button
        type="button"
        onClick={() => setIsPopoverOpen((open) => !open)}
        aria-expanded={isPopoverOpen}
        aria-haspopup="true"
        aria-label={`Auto refresh ${autoRefreshEnabled ? 'on' : 'off'}; change setting`}
        className="inline-flex items-center justify-center rounded-r-lg border border-l-0 border-gray-300 bg-white px-2 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-gray-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-gray-400 dark:hover:bg-neutral-700 dark:hover:text-gray-200"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isPopoverOpen ? 'rotate-180' : ''}`} />
      </button>
      {isPopoverOpen && (
        <label className="absolute right-0 top-full z-40 mt-1 flex w-52 items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 shadow-lg dark:border-neutral-700 dark:bg-neutral-800 dark:text-gray-200">
          <input
            type="checkbox"
            checked={autoRefreshEnabled}
            onChange={(event) => onAutoRefreshEnabledChange(event.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500 dark:border-neutral-600 dark:bg-neutral-700"
          />
          <span>
            <span className="block font-medium">Auto-refresh</span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">Every minute when idle</span>
          </span>
        </label>
      )}
    </div>
  );
}
