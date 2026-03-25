'use client';

import { useState, useEffect } from 'react';
import { GitLabService } from '@/services/gitlab';

interface ConfigFormProps {
  onConfigured: (service: GitLabService) => void;
}

const TOKEN_EXPIRY_DAYS = 30;

const STORAGE_KEYS = {
  TOKEN: 'gitlab-token',
  INSTANCE_URL: 'gitlab-instance-url',
  TOKEN_EXPIRY: 'gitlab-token-expiry',
} as const;

export function clearAllStoredCredentials() {
  sessionStorage.removeItem(STORAGE_KEYS.TOKEN);
  sessionStorage.removeItem(STORAGE_KEYS.INSTANCE_URL);
  localStorage.removeItem(STORAGE_KEYS.TOKEN);
  localStorage.removeItem(STORAGE_KEYS.INSTANCE_URL);
  localStorage.removeItem(STORAGE_KEYS.TOKEN_EXPIRY);
}

function loadStoredCredentials(): { instanceUrl: string | null; token: string | null } {
  // Prefer sessionStorage (current session only, cleared when the tab is closed)
  const sessionToken = sessionStorage.getItem(STORAGE_KEYS.TOKEN);
  const sessionInstanceUrl = sessionStorage.getItem(STORAGE_KEYS.INSTANCE_URL);
  if (sessionToken) {
    return { token: sessionToken, instanceUrl: sessionInstanceUrl };
  }

  // Fall back to localStorage (remembered across sessions), but respect expiry
  const expiry = localStorage.getItem(STORAGE_KEYS.TOKEN_EXPIRY);
  if (expiry && Date.now() > parseInt(expiry, 10)) {
    // Token has expired — clear it and treat as unauthenticated
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
    localStorage.removeItem(STORAGE_KEYS.INSTANCE_URL);
    localStorage.removeItem(STORAGE_KEYS.TOKEN_EXPIRY);
    return { token: null, instanceUrl: null };
  }

  return {
    token: localStorage.getItem(STORAGE_KEYS.TOKEN),
    instanceUrl: localStorage.getItem(STORAGE_KEYS.INSTANCE_URL),
  };
}

export default function ConfigForm({ onConfigured }: ConfigFormProps) {
  const [instanceUrl, setInstanceUrl] = useState('https://gitlab.com');
  const [token, setToken] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(false);

  // Load saved credentials on component mount
  useEffect(() => {
    const { token: savedToken, instanceUrl: savedInstanceUrl } = loadStoredCredentials();

    if (savedInstanceUrl) {
      setInstanceUrl(savedInstanceUrl);
    }

    if (savedToken) {
      setToken(savedToken);
      // Auto-connect if we have saved credentials
      const service = new GitLabService(savedInstanceUrl || 'https://gitlab.com', savedToken);
      service.testConnection().then(result => {
        if (result.success) {
          onConfigured(service);
        }
      }).catch(() => {
        // If auto-connect fails, clear all saved credentials and let user re-enter
        clearAllStoredCredentials();
        setToken('');
      });
    }
  }, [onConfigured]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsValidating(true);
    setError(null);

    try {
      const service = new GitLabService(instanceUrl, token);
      const result = await service.testConnection();
      
      if (result.success) {
        if (rememberMe) {
          // Store in localStorage so credentials persist across browser sessions
          localStorage.setItem(STORAGE_KEYS.INSTANCE_URL, instanceUrl);
          localStorage.setItem(STORAGE_KEYS.TOKEN, token);
          localStorage.setItem(
            STORAGE_KEYS.TOKEN_EXPIRY,
            (Date.now() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toString()
          );
          // Avoid duplication in sessionStorage
          sessionStorage.removeItem(STORAGE_KEYS.INSTANCE_URL);
          sessionStorage.removeItem(STORAGE_KEYS.TOKEN);
        } else {
          // Store in sessionStorage only — cleared automatically when the tab closes
          sessionStorage.setItem(STORAGE_KEYS.INSTANCE_URL, instanceUrl);
          sessionStorage.setItem(STORAGE_KEYS.TOKEN, token);
          // Remove any previously remembered credentials
          localStorage.removeItem(STORAGE_KEYS.INSTANCE_URL);
          localStorage.removeItem(STORAGE_KEYS.TOKEN);
          localStorage.removeItem(STORAGE_KEYS.TOKEN_EXPIRY);
        }
        
        onConfigured(service);
      } else {
        setError(result.error || 'Failed to connect to GitLab');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-8 p-6 bg-white dark:bg-neutral-800 rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        GitLab Configuration
      </h2>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="instanceUrl" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            GitLab Instance URL
          </label>
          <input
            type="url"
            id="instanceUrl"
            value={instanceUrl}
            onChange={(e) => setInstanceUrl(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-neutral-700 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 dark:bg-neutral-700 dark:text-white"
            placeholder="https://gitlab.com"
            required
          />
        </div>

        <div>
          <label htmlFor="token" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Personal Access Token
          </label>
          <input
            type="password"
            id="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-neutral-700 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 dark:bg-neutral-700 dark:text-white"
            placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
            required
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Create a token at:{' '}
            <a
              href="https://gitlab.com/-/user_settings/personal_access_tokens"
              target="_blank"
              rel="noreferrer"
              className="text-violet-600 underline hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
            >
              GitLab Personal Access Tokens
            </a>
            <br />
            Required scopes: <code className="bg-gray-100 dark:bg-neutral-700 px-1 rounded">api</code>, <code className="bg-gray-100 dark:bg-neutral-700 px-1 rounded">read_user</code>
          </p>
        </div>

        <div className="flex items-center">
          <input
            type="checkbox"
            id="rememberMe"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="h-4 w-4 text-violet-600 focus:ring-violet-500 border-gray-300 rounded"
          />
          <label htmlFor="rememberMe" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
            Remember my credentials across sessions (stored in local storage for {TOKEN_EXPIRY_DAYS} days)
          </label>
        </div>

        {error && (
          <div className="p-3 bg-red-100 dark:bg-red-900/20 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-400 rounded-md">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isValidating}
          className="w-full bg-violet-600 hover:bg-violet-700 disabled:bg-violet-400 text-white font-medium py-2 px-4 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2"
        >
          {isValidating ? 'Validating...' : 'Connect to GitLab'}
        </button>
      </form>

      <div className="mt-6 p-4 bg-slate-50 dark:bg-neutral-900/20 border border-slate-200 dark:border-neutral-800 rounded-md">
        <h3 className="text-sm font-medium text-slate-800 dark:text-neutral-300 mb-2">
          🔒 Privacy & Security
        </h3>
        <ul className="text-xs text-slate-700 dark:text-neutral-400 space-y-1">
          <li>• Your token is stored in session storage by default — cleared automatically when you close this tab</li>
          <li>• Checking &quot;Remember me&quot; stores the token in local storage for {TOKEN_EXPIRY_DAYS} days so you stay connected across browser sessions</li>
          <li>• All API calls are made directly from your browser to GitLab</li>
          <li>• No data is sent to or stored on our servers</li>
          <li>• Use the &quot;Disconnect&quot; button to clear all stored credentials at any time</li>
        </ul>
      </div>
    </div>
  );
}
