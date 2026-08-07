'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, LogOut, Settings2, Sparkles, X } from 'lucide-react';
import { DEFAULT_AI_API_BASE_URL, DEFAULT_AI_MODEL } from '@/review/ai';
import { readAiProviderConfig } from '@/review/storage';
import type { AiProviderConfig } from '@/review/types';
import { GitLabService } from '@/services/gitlab';

interface ConnectionSettingsModalProps {
  service: GitLabService;
  aiConfig: AiProviderConfig | null;
  onClose: () => void;
  onSave: (
    service: GitLabService,
    aiConfig: AiProviderConfig | null,
    rememberAiSettings: boolean,
    connectionChanged: boolean,
    instanceChanged: boolean
  ) => void;
  onDisconnect: () => void;
}

const normaliseUrl = (value: string) => value.trim().replace(/\/+$/, '');
const isCustomEndpoint = (baseUrl: string) => normaliseUrl(baseUrl) !== DEFAULT_AI_API_BASE_URL;

export default function ConnectionSettingsModal({
  service,
  aiConfig,
  onClose,
  onSave,
  onDisconnect
}: ConnectionSettingsModalProps) {
  const currentInstanceUrl = service.getInstanceUrl();
  const [instanceUrl, setInstanceUrl] = useState(currentInstanceUrl);
  const [token, setToken] = useState('');
  const [rememberGitLabCredentials, setRememberGitLabCredentials] = useState(() => (
    typeof window !== 'undefined' && Boolean(window.localStorage.getItem('gitlab-token'))
  ));
  const [aiEnabled, setAiEnabled] = useState(Boolean(aiConfig));
  const [aiApiKey, setAiApiKey] = useState(aiConfig?.apiKey ?? '');
  const [aiModel, setAiModel] = useState(aiConfig?.model ?? DEFAULT_AI_MODEL);
  const [aiApiBaseUrl, setAiApiBaseUrl] = useState(aiConfig?.apiBaseUrl ?? DEFAULT_AI_API_BASE_URL);
  const [showCustomAiUrl, setShowCustomAiUrl] = useState(aiConfig ? isCustomEndpoint(aiConfig.apiBaseUrl) : false);
  const [rememberAiSettings, setRememberAiSettings] = useState(() => Boolean(readAiProviderConfig()));
  const [showGitLabToken, setShowGitLabToken] = useState(false);
  const [showAiToken, setShowAiToken] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isValidating) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isValidating, onClose]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const normalizedInstanceUrl = normaliseUrl(instanceUrl);
    const normalizedCurrentInstanceUrl = normaliseUrl(currentInstanceUrl);
    const normalizedToken = token.trim();
    const instanceChanged = normalizedInstanceUrl !== normalizedCurrentInstanceUrl;
    const connectionChanged = instanceChanged || Boolean(normalizedToken);

    if (!normalizedInstanceUrl) {
      setError('Enter a GitLab instance URL.');
      return;
    }
    try {
      new URL(normalizedInstanceUrl);
    } catch {
      setError('Enter a valid GitLab instance URL.');
      return;
    }
    if (instanceChanged && !normalizedToken) {
      setError('Enter a GitLab token when changing the GitLab instance.');
      return;
    }

    let nextAiConfig: AiProviderConfig | null = null;
    if (aiEnabled) {
      const normalizedAiKey = aiApiKey.trim();
      const normalizedModel = aiModel.trim();
      const normalizedAiBaseUrl = normaliseUrl(showCustomAiUrl ? aiApiBaseUrl : DEFAULT_AI_API_BASE_URL);

      if (!normalizedAiKey) {
        setError('Enter an AI API key or turn off AI-assisted semantic reviews.');
        return;
      }
      if (!normalizedModel) {
        setError('Enter an AI model name supported by your provider.');
        return;
      }
      try {
        new URL(normalizedAiBaseUrl);
      } catch {
        setError('Enter a valid OpenAI-compatible AI API URL.');
        return;
      }
      nextAiConfig = {
        apiKey: normalizedAiKey,
        model: normalizedModel,
        apiBaseUrl: normalizedAiBaseUrl
      };
    }

    let nextService = service;
    if (connectionChanged) {
      if (!normalizedToken) {
        setError('Enter a replacement GitLab token to update this connection.');
        return;
      }
      setIsValidating(true);
      try {
        const candidateService = new GitLabService(normalizedInstanceUrl, normalizedToken);
        const result = await candidateService.testConnection();
        if (!result.success) {
          setError(result.error || 'Failed to connect to GitLab.');
          return;
        }
        nextService = candidateService;
      } catch (validationError) {
        setError(validationError instanceof Error ? validationError.message : 'Unable to validate the GitLab connection.');
        return;
      } finally {
        setIsValidating(false);
      }

      if (rememberGitLabCredentials) {
        window.localStorage.setItem('gitlab-instance-url', normalizedInstanceUrl);
        window.localStorage.setItem('gitlab-token', normalizedToken);
      } else {
        window.localStorage.removeItem('gitlab-instance-url');
        window.localStorage.removeItem('gitlab-token');
      }
    } else if (!rememberGitLabCredentials) {
      window.localStorage.removeItem('gitlab-instance-url');
      window.localStorage.removeItem('gitlab-token');
    }

    onSave(nextService, nextAiConfig, aiEnabled && rememberAiSettings, connectionChanged, instanceChanged);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="connection-settings-title">
      <form onSubmit={submit} className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-[#f7f7f5] shadow-2xl dark:border-white/10 dark:bg-[#10131b]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-white/10">
          <div>
            <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-300"><Settings2 className="h-4 w-4" /><span className="text-xs font-bold uppercase tracking-[0.16em]">Connection</span></div>
            <h2 id="connection-settings-title" className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">Connection settings</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Update GitLab or optional AI credentials without leaving your current workspace.</p>
          </div>
          <button type="button" onClick={onClose} disabled={isValidating} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-white" aria-label="Close connection settings"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-6 px-5 py-5">
          <section className="rounded-xl border border-slate-200 bg-white/70 p-4 dark:border-white/10 dark:bg-white/[0.04]">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200"><KeyRound className="h-4 w-4" /></span>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">GitLab connection</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Connected to {currentInstanceUrl}. Your active token is never shown here.</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">GitLab instance URL</span>
                <input type="url" value={instanceUrl} onChange={(event) => setInstanceUrl(event.target.value)} placeholder="https://gitlab.com" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-white/15 dark:bg-white/[0.05] dark:text-white dark:focus:border-indigo-400 dark:focus:ring-indigo-500/20" />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">Replace GitLab access token</span>
                <span className="relative block">
                  <input type={showGitLabToken ? 'text' : 'password'} value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" placeholder="Leave blank to keep the active session" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 pr-10 text-sm text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-white/15 dark:bg-white/[0.05] dark:text-white dark:focus:border-indigo-400 dark:focus:ring-indigo-500/20" />
                  <button type="button" onClick={() => setShowGitLabToken((visible) => !visible)} className="absolute inset-y-0 right-0 px-3 text-slate-400 hover:text-slate-700 dark:hover:text-white" aria-label={showGitLabToken ? 'Hide GitLab token' : 'Show GitLab token'}>{showGitLabToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                </span>
                <span className="mt-1.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">Only required when replacing the token or changing GitLab instances. A replacement is checked before it becomes active.</span>
              </label>

              <label className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={rememberGitLabCredentials} onChange={(event) => setRememberGitLabCredentials(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                <span>Remember a replacement GitLab token in this browser.</span>
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 dark:border-indigo-500/25 dark:bg-indigo-500/10">
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={aiEnabled} onChange={(event) => setAiEnabled(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
              <span>
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white"><Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />Enable AI-assisted semantic reviews</span>
                <span className="mt-1 block text-xs leading-5 text-slate-600 dark:text-slate-300">Optional. Without an AI key, the review workspace still groups changed files locally.</span>
              </span>
            </label>

            {aiEnabled && (
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">AI API key</span>
                  <span className="relative block">
                    <input type={showAiToken ? 'text' : 'password'} value={aiApiKey} onChange={(event) => setAiApiKey(event.target.value)} autoComplete="off" placeholder="sk-…" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 pr-10 text-sm text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-white/15 dark:bg-white/[0.05] dark:text-white dark:focus:border-indigo-400 dark:focus:ring-indigo-500/20" />
                    <button type="button" onClick={() => setShowAiToken((visible) => !visible)} className="absolute inset-y-0 right-0 px-3 text-slate-400 hover:text-slate-700 dark:hover:text-white" aria-label={showAiToken ? 'Hide AI API key' : 'Show AI API key'}>{showAiToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                  </span>
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">Model</span>
                  <input value={aiModel} onChange={(event) => setAiModel(event.target.value)} placeholder={DEFAULT_AI_MODEL} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-white/15 dark:bg-white/[0.05] dark:text-white dark:focus:border-indigo-400 dark:focus:ring-indigo-500/20" />
                </label>

                {!showCustomAiUrl ? (
                  <button type="button" onClick={() => setShowCustomAiUrl(true)} className="text-sm font-medium text-indigo-700 underline-offset-4 hover:underline dark:text-indigo-300">Use a custom OpenAI-compatible endpoint</button>
                ) : (
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">API base URL</span>
                    <input type="url" value={aiApiBaseUrl} onChange={(event) => setAiApiBaseUrl(event.target.value)} placeholder={DEFAULT_AI_API_BASE_URL} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-white/15 dark:bg-white/[0.05] dark:text-white dark:focus:border-indigo-400 dark:focus:ring-indigo-500/20" />
                    <span className="mt-1.5 block text-xs text-slate-500 dark:text-slate-400">Usually ends in <code className="rounded bg-slate-200 px-1 py-0.5 dark:bg-white/10">/v1</code>. The provider must allow browser CORS requests.</span>
                  </label>
                )}

                <label className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={rememberAiSettings} onChange={(event) => setRememberAiSettings(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                  <span>Remember these AI settings in this browser.</span>
                </label>
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100">Your selected provider receives the merge-request title, description, and clipped diff when you start an AI review. No data is sent through an app server. Use this direct browser mode only with a personal, restricted key on a trusted device.</p>
              </div>
            )}
          </section>

          {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4 dark:border-white/10">
          <button type="button" onClick={onClose} disabled={isValidating} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 dark:hover:bg-white/10">Cancel</button>
          <button type="submit" disabled={isValidating} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60">{isValidating && <Loader2 className="h-4 w-4 animate-spin" />}{isValidating ? 'Checking GitLab…' : 'Save settings'}</button>
        </div>

        <div className="flex flex-col gap-3 border-t border-rose-200 bg-rose-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-rose-500/25 dark:bg-rose-500/[0.07]">
          <div>
            <p className="text-sm font-semibold text-rose-900 dark:text-rose-100">Disconnect</p>
            <p className="mt-1 text-xs leading-5 text-rose-800/80 dark:text-rose-100/75">Clear saved GitLab and AI credentials and return to the sign-in screen. Saved local review progress remains on this device.</p>
          </div>
          <button type="button" onClick={onDisconnect} disabled={isValidating} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-500/35 dark:bg-transparent dark:text-rose-200 dark:hover:bg-rose-500/15"><LogOut className="h-4 w-4" />Disconnect</button>
        </div>
      </form>
    </div>
  );
}
