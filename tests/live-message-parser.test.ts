import { describe, expect, it } from 'vitest';
import { parseLiveMessage, parseToolCallMessage } from '@/lib/client/live-message-parser';

describe('parseLiveMessage', () => {
  it('extracts all bundled events from one server message', () => {
    const events = parseLiveMessage({
      setupComplete: true,
      serverContent: {
        modelTurn: {
          parts: [
            { inlineData: { data: 'audio-chunk' } },
            { text: 'assistant text' },
          ],
        },
        inputTranscription: {
          text: 'user speech',
          finished: true,
        },
        outputTranscription: {
          text: 'assistant speech',
          finished: false,
        },
        interrupted: true,
        turnComplete: true,
      },
    });

    expect(events).toEqual([
      { type: 'setup-complete' },
      { type: 'audio', data: 'audio-chunk' },
      { type: 'text', text: 'assistant text' },
      { type: 'input-transcription', text: 'user speech', finished: true },
      { type: 'output-transcription', text: 'assistant speech', finished: false },
      { type: 'interrupted' },
      { type: 'turn-complete' },
    ]);
  });

  it('surfaces error messages', () => {
    const events = parseLiveMessage({
      error: {
        message: 'socket failed',
      },
    });

    expect(events).toEqual([{ type: 'error', message: 'socket failed' }]);
  });

  it('extracts resumable session handle updates', () => {
    const events = parseLiveMessage({
      sessionResumptionUpdate: {
        newHandle: 'abc-123',
        resumable: true,
      },
    });

    expect(events).toEqual([
      { type: 'session-resumption-update', handle: 'abc-123', resumable: true },
    ]);
  });

  it('ignores session resumption updates without a new handle', () => {
    const events = parseLiveMessage({
      sessionResumptionUpdate: { resumable: true },
    });

    expect(events).toEqual([]);
  });

  it('extracts tool calls from one server message', () => {
    const events = parseLiveMessage({
      toolCall: {
        functionCalls: [
          {
            id: 'call-1',
            name: 'tavily_search',
            args: { query: 'latest AI news' },
          },
        ],
      },
    });

    expect(events).toEqual([
      {
        type: 'tool-call',
        functionCalls: [
          {
            id: 'call-1',
            name: 'tavily_search',
            args: { query: 'latest AI news' },
          },
        ],
      },
    ]);
  });

  it('extracts normalized tool calls directly', () => {
    const toolCalls = parseToolCallMessage({
      toolCall: {
        functionCalls: [
          {
            id: 'call-1',
            name: 'tavily_search',
            args: { query: 'weather', maxResults: 3 },
          },
          {
            id: 'call-2',
            name: 'broken',
            args: null,
          },
        ],
      },
    });

    expect(toolCalls).toEqual([
      {
        id: 'call-1',
        name: 'tavily_search',
        args: { query: 'weather', maxResults: 3 },
      },
      {
        id: 'call-2',
        name: 'broken',
        args: {},
      },
    ]);
  });
});
