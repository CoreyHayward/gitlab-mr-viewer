'use client';

import { useState, useEffect } from 'react';
import { GitLabService } from '@/services/gitlab';
import { DEFAULT_AI_API_BASE_URL, DEFAULT_AI_MODEL } from '@/review/ai';
import { clearAiProviderConfig, readAiProviderConfig, writeAiProviderConfig } from '@/review/storage';
import type { AiProviderConfig } from '@/review/types';

interface ConfigFormProps {
  onConfigured: (service: GitLabService, aiConfig: AiProviderConfig | null) => void;
}

export default function ConfigForm({ onConfigured }: ConfigFormProps) {
  const [instanceUrl, setInstanceUrl] = useState('https://gitlab.com');
  const [token, setToken] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(true);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState(DEFAULT_AI_MODEL);
  const [aiApiBaseUrl, setAiApiBaseUrl] = useState(DEFAULT_AI_API_BASE_URL);
  const [showCustomAiUrl, setShowCustomAiUrl] = useState(false);
  const [rememberAiSettings, setRememberAiSettings] = useState(false);

  // Load saved credentials on component mount
  useEffect(() => {
    const savedInstanceUrl = localStorage.getItem('gitlab-instance-url');
    const savedToken = localStorage.getItem('gitlab-token');
    const savedAiConfig = readAiProviderConfig();
    
    if (savedInstanceUrl) {
      setInstanceUrl(savedInstanceUrl);
    }
    
    if (savedAiConfig) {
      setAiEnabled(true);
      setAiApiKey(savedAiConfig.apiKey);
      setAiModel(savedAiConfig.model);
      setAiApiBaseUrl(savedAiConfig.apiBaseUrl);
      setShowCustomAiUrl(savedAiConfig.apiBaseUrl !== DEFAULT_AI_API_BASE_URL);
      setRememberAiSettings(true);
    }

    if (savedToken) {
      setToken(savedToken);
      // Auto-connect if we have saved credentials
      const service = new GitLabService(savedInstanceUrl || 'https://gitlab.com', savedToken);
      service.testConnection().then(result => {
        if (result.success) {
          onConfigured(service, savedAiConfig);
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
        let aiConfig: AiProviderConfig | null = null;
        if (aiEnabled) {
          const normalizedKey = aiApiKey.trim();
          const normalizedModel = aiModel.trim();
          const normalizedBaseUrl = (showCustomAiUrl ? aiApiBaseUrl : DEFAULT_AI_API_BASE_URL).trim().replace(/\/+$/, '');
          if (!normalizedKey) {
            setError('Enter an AI API key or turn off AI-assisted reviewing.');
            return;
          }
          if (!normalizedModel) {
            setError('Enter an AI model name supported by your provider.');
            return;
          }
          try {
            new URL(normalizedBaseUrl);
          } catch {
            setError('Enter a valid OpenAI-compatible AI API URL.');
            return;
          }
          aiConfig = { apiKey: normalizedKey, model: normalizedModel, apiBaseUrl: normalizedBaseUrl };
        }

        // Save credentials to localStorage if remember me is checked
        if (rememberMe) {
          localStorage.setItem('gitlab-instance-url', instanceUrl);
          localStorage.setItem('gitlab-token', token);
        } else {
          // Clear saved credentials if user unchecked remember me
          localStorage.removeItem('gitlab-instance-url');
          localStorage.removeItem('gitlab-token');
        }
        if (aiConfig && rememberAiSettings) writeAiProviderConfig(aiConfig);
        else clearAiProviderConfig();
        
        onConfigured(service, aiConfig);
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

        <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-4 dark:border-indigo-500/20 dark:bg-indigo-500/10">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={aiEnabled}
              onChange={(e) => setAiEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span>
              <span className="block text-sm font-medium text-slate-900 dark:text-white">Enable AI-assisted semantic reviews</span>
              <span className="mt-1 block text-xs leading-5 text-slate-600 dark:text-slate-300">Optional. Without an AI key, the review workspace still groups the diff with local rules.</span>
            </span>
          </label>

          {aiEnabled && (
            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="aiApiKey" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">AI API key</label>
                <input
                  type="password"
                  id="aiApiKey"
                  value={aiApiKey}
                  onChange={(e) => setAiApiKey(e.target.value)}
                  autoComplete="off"
                  placeholder="sk-..."
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-neutral-700 dark:bg-neutral-700 dark:text-white"
                />
              </div>
              <div>
                <label htmlFor="aiModel" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Model</label>
                <input
                  id="aiModel"
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  placeholder={DEFAULT_AI_MODEL}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-neutral-700 dark:bg-neutral-700 dark:text-white"
                />
              </div>
              {showCustomAiUrl ? (
                <div>
                  <label htmlFor="aiApiBaseUrl" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">OpenAI-compatible API base URL</label>
                  <input
                    type="url"
                    id="aiApiBaseUrl"
                    value={aiApiBaseUrl}
                    onChange={(e) => setAiApiBaseUrl(e.target.value)}
                    placeholder={DEFAULT_AI_API_BASE_URL}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-neutral-700 dark:bg-neutral-700 dark:text-white"
                  />
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Your provider must permit browser CORS requests.</p>
                </div>
              ) : (
                <button type="button" onClick={() => setShowCustomAiUrl(true)} className="text-left text-xs font-medium text-indigo-700 underline-offset-4 hover:underline dark:text-indigo-300">Use a custom OpenAI-compatible endpoint</button>
              )}
              <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-5 text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={rememberAiSettings} onChange={(e) => setRememberAiSettings(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                <span>Remember this AI key and settings in this browser.</span>
              </label>
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100">The selected AI provider receives the merge-request title, description, and clipped diff when you launch an AI review. OpenAI recommends server-side API-key management; this client-only mode is best for a personal, restricted key on a trusted device.</p>
            </div>
          )}
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
            Remember my GitLab credentials (stored in browser local storage)
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
          <li>• GitLab and optional AI tokens stay in your browser (memory unless you explicitly choose to remember them)</li>
          <li>• All API calls are made directly from your browser to GitLab (and your optional AI provider)</li>
          <li>• No data is sent to or stored on our servers</li>
          <li>• Refresh the page to clear your token from memory (or clear your local storage if you choose &quot;Remember me&quot;)</li>
        </ul>
      </div>
    </div>
  );
}
