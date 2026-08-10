import { DEFAULT_AI_API_BASE_URL } from '@/review/ai';
import type { AiProviderConfig } from '@/review/types';

export const normaliseUrl = (value: string) => value.trim().replace(/\/+$/, '');

const isHttpUrl = (value: string) => {
  const url = new URL(value);
  return url.protocol === 'http:' || url.protocol === 'https:';
};

const isAllowedAiUrl = (value: string) => {
  const url = new URL(value);
  return url.protocol === 'https:' || (
    url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  );
};

export const validateGitLabInstanceUrl = (value: string): string | null => {
  const normalized = normaliseUrl(value);
  if (!normalized) return 'Enter a GitLab instance URL.';
  try {
    return isHttpUrl(normalized) ? null : 'Enter a valid GitLab instance URL.';
  } catch {
    return 'Enter a valid GitLab instance URL.';
  }
};

export const isCustomAiEndpoint = (baseUrl: string) => normaliseUrl(baseUrl) !== DEFAULT_AI_API_BASE_URL;

export const buildAiProviderConfig = (
  enabled: boolean,
  apiKey: string,
  model: string,
  apiBaseUrl: string
): { config: AiProviderConfig | null; error: string | null } => {
  if (!enabled) return { config: null, error: null };
  const normalizedKey = apiKey.trim();
  const normalizedModel = model.trim();
  const normalizedBaseUrl = normaliseUrl(apiBaseUrl);
  if (!normalizedKey) return { config: null, error: 'Enter an AI API key or turn off AI-assisted semantic reviews.' };
  if (!normalizedModel) return { config: null, error: 'Enter an AI model name supported by your provider.' };
  try {
    if (!isAllowedAiUrl(normalizedBaseUrl)) {
      return { config: null, error: 'Enter a valid OpenAI-compatible AI API URL.' };
    }
  } catch {
    return { config: null, error: 'Enter a valid OpenAI-compatible AI API URL.' };
  }
  return {
    config: { apiKey: normalizedKey, model: normalizedModel, apiBaseUrl: normalizedBaseUrl },
    error: null
  };
};
