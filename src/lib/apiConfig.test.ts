import { describe, it, expect, vi, beforeEach } from 'vitest';

async function loadApiConfig() {
  vi.resetModules();
  return import('./apiConfig');
}

describe('apiConfig', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('getApiBaseUrl prefers VITE_API_BASE_URL', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://custom.example/api');
    const { getApiBaseUrl } = await loadApiConfig();
    expect(getApiBaseUrl()).toBe('https://custom.example/api');
  });

  it('getServerBaseUrl strips /api from an absolute api url', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:4000/api');
    const { getServerBaseUrl } = await loadApiConfig();
    expect(getServerBaseUrl()).toBe('http://localhost:4000');
  });
});
