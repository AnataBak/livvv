import { describe, expect, it } from 'vitest';
import { buildLiveServiceUrl, normalizeLiveServiceHost } from '@/lib/client/gemini-live-client';

describe('buildLiveServiceUrl', () => {
  it('builds a direct browser websocket URL for an API key', () => {
    const url = buildLiveServiceUrl({ apiKey: 'abc 123' });

    expect(url).toBe(
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=abc%20123',
    );
  });

  it('builds a constrained websocket URL for an ephemeral token', () => {
    const url = buildLiveServiceUrl({ accessToken: 'short token' });

    expect(url).toBe(
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=short%20token',
    );
  });

  it('uses a custom host (e.g. Cloudflare Worker proxy) when provided', () => {
    const url = buildLiveServiceUrl({ apiKey: 'k1' }, 'livvv-proxy.artemhttp.workers.dev');

    expect(url).toBe(
      'wss://livvv-proxy.artemhttp.workers.dev/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=k1',
    );
  });

  it('uses a custom host for ephemeral-token routing too', () => {
    const url = buildLiveServiceUrl({ accessToken: 't1' }, 'proxy.example.com');

    expect(url).toBe(
      'wss://proxy.example.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=t1',
    );
  });
});

describe('normalizeLiveServiceHost', () => {
  it('returns the default host when input is empty', () => {
    expect(normalizeLiveServiceHost('')).toBe('generativelanguage.googleapis.com');
    expect(normalizeLiveServiceHost('   ')).toBe('generativelanguage.googleapis.com');
    expect(normalizeLiveServiceHost(null)).toBe('generativelanguage.googleapis.com');
    expect(normalizeLiveServiceHost(undefined)).toBe('generativelanguage.googleapis.com');
  });

  it('strips wss:// / ws:// / https:// / http:// prefixes', () => {
    expect(normalizeLiveServiceHost('wss://example.workers.dev')).toBe('example.workers.dev');
    expect(normalizeLiveServiceHost('ws://example.workers.dev')).toBe('example.workers.dev');
    expect(normalizeLiveServiceHost('https://example.workers.dev')).toBe('example.workers.dev');
    expect(normalizeLiveServiceHost('http://example.workers.dev')).toBe('example.workers.dev');
  });

  it('strips trailing slashes and surrounding whitespace', () => {
    expect(normalizeLiveServiceHost('  example.workers.dev/  ')).toBe('example.workers.dev');
    expect(normalizeLiveServiceHost('https://example.workers.dev///')).toBe('example.workers.dev');
  });
});
