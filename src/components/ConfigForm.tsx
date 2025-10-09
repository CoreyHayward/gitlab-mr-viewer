'use client';

import { useState, useEffect } from 'react';
import { GitLabService } from '@/services/gitlab';

interface ConfigFormProps {
  onConfigured: (service: GitLabService) => void;
}

export default function ConfigForm({ onConfigured }: ConfigFormProps) {
  const [instanceUrl, setInstanceUrl] = useState('https://gitlab.com');
  const [token, setToken] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(true);

  // Load saved credentials on component mount
  useEffect(() => {
    const savedInstanceUrl = localStorage.getItem('gitlab-instance-url');
    const savedToken = localStorage.getItem('gitlab-token');
    
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
        // If auto-connect fails, clear saved token and let user re-enter
        localStorage.removeItem('gitlab-token');
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
        // Save credentials to localStorage if remember me is checked
        if (rememberMe) {
          localStorage.setItem('gitlab-instance-url', instanceUrl);
          localStorage.setItem('gitlab-token', token);
        } else {
          // Clear saved credentials if user unchecked remember me
          localStorage.removeItem('gitlab-instance-url');
          localStorage.removeItem('gitlab-token');
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
            Create a token at: Settings → Access Tokens → Personal Access Tokens
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
            Remember my credentials (stored in browser local storage)
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
          <li>• Your token is stored only in your browser (memory or local storage if you choose &quot;Remember me&quot;)</li>
          <li>• All API calls are made directly from your browser to GitLab</li>
          <li>• No data is sent to or stored on our servers</li>
          <li>• Refresh the page to clear your token from memory (or clear your local storage if you choose &quot;Remember me&quot;)</li>
        </ul>
      </div>
    </div>
  );
}
