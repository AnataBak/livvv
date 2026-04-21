export type LiveServerEvent =
  | { type: 'setup-complete' }
  | { type: 'audio'; data: string }
  | { type: 'text'; text: string }
  | { type: 'input-transcription'; text: string; finished: boolean }
  | { type: 'output-transcription'; text: string; finished: boolean }
  | { type: 'interrupted' }
  | { type: 'turn-complete' }
  | { type: 'session-resumption-update'; handle: string; resumable: boolean }
  | { type: 'error'; message: string };

type MaybeMessage = {
  error?: { message?: string };
  setupComplete?: unknown;
  sessionResumptionUpdate?: {
    newHandle?: string;
    resumable?: boolean;
  };
  serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    inputTranscription?: { text?: string; finished?: boolean };
    outputTranscription?: { text?: string; finished?: boolean };
    modelTurn?: {
      parts?: Array<{
        text?: string;
        inlineData?: { data?: string };
      }>;
    };
  };
};

export function parseLiveMessage(message: MaybeMessage): LiveServerEvent[] {
  const events: LiveServerEvent[] = [];

  if (message.error?.message) {
    events.push({ type: 'error', message: message.error.message });
  }

  if (message.setupComplete) {
    events.push({ type: 'setup-complete' });
  }

  const parts = message.serverContent?.modelTurn?.parts ?? [];

  for (const part of parts) {
    if (part.inlineData?.data) {
      events.push({ type: 'audio', data: part.inlineData.data });
    }

    if (part.text) {
      events.push({ type: 'text', text: part.text });
    }
  }

  const inputTranscription = message.serverContent?.inputTranscription;
  if (inputTranscription?.text) {
    events.push({
      type: 'input-transcription',
      text: inputTranscription.text,
      finished: Boolean(inputTranscription.finished),
    });
  }

  const outputTranscription = message.serverContent?.outputTranscription;
  if (outputTranscription?.text) {
    events.push({
      type: 'output-transcription',
      text: outputTranscription.text,
      finished: Boolean(outputTranscription.finished),
    });
  }

  if (message.serverContent?.interrupted) {
    events.push({ type: 'interrupted' });
  }

  if (message.serverContent?.turnComplete) {
    events.push({ type: 'turn-complete' });
  }

  const resumption = message.sessionResumptionUpdate;
  if (resumption?.newHandle) {
    events.push({
      type: 'session-resumption-update',
      handle: resumption.newHandle,
      resumable: Boolean(resumption.resumable),
    });
  }

  return events;
}
