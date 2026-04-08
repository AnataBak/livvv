export const LIVE_MODEL = 'gemini-3.1-flash-live-preview';
export const LIVE_VOICE = 'Puck';
export const AUDIO_INPUT_SAMPLE_RATE = 16000;
export const AUDIO_OUTPUT_SAMPLE_RATE = 24000;
export const CAMERA_FRAME_RATE = 1;
export const CAMERA_WIDTH = 640;
export const CAMERA_HEIGHT = 480;
export const SYSTEM_INSTRUCTION =
  'You are a concise, friendly live voice assistant. Answer clearly and keep responses short unless the user asks for detail.';

export function buildSessionSetupMessage() {
  return {
    setup: {
      model: `models/${LIVE_MODEL}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        temperature: 0.6,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: LIVE_VOICE,
            },
          },
        },
      },
      systemInstruction: {
        parts: [{ text: SYSTEM_INSTRUCTION }],
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
}
