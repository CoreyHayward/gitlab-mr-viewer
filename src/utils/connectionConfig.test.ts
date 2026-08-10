import { describe, expect, it } from 'vitest';
import { buildAiProviderConfig, validateGitLabInstanceUrl } from '@/utils/connectionConfig';

describe('connection configuration validation', () => {
  it('normalizes a valid AI configuration in one shared validator', () => {
    expect(buildAiProviderConfig(true, ' key ', ' model ', 'https://ai.example.com/v1/')).toEqual({
      config: { apiKey: 'key', model: 'model', apiBaseUrl: 'https://ai.example.com/v1' },
      error: null
    });
    expect(buildAiProviderConfig(true, 'key', 'model', 'http://localhost:11434/v1').error).toBeNull();
  });

  it('reports invalid GitLab and AI URLs', () => {
    expect(validateGitLabInstanceUrl('not a url')).toBe('Enter a valid GitLab instance URL.');
    expect(validateGitLabInstanceUrl('ftp://gitlab.example.com')).toBe('Enter a valid GitLab instance URL.');
    expect(buildAiProviderConfig(true, 'key', 'model', 'not a url').error).toBe('Enter a valid OpenAI-compatible AI API URL.');
    expect(buildAiProviderConfig(true, 'key', 'model', 'ftp://ai.example.com').error).toBe(
      'Enter a valid OpenAI-compatible AI API URL.'
    );
    expect(buildAiProviderConfig(true, 'key', 'model', 'http://ai.example.com').error).toBe(
      'Enter a valid OpenAI-compatible AI API URL.'
    );
  });
});
