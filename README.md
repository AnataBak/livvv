# Gemini Live Starter

Minimal `Next.js` starter for talking to `gemini-3.1-flash-live-preview` with:

- live voice conversation
- microphone on/off
- camera on/off
- stop conversation
- new dialog button
- text input fallback
- mobile-friendly layout
- Vercel-ready server route for ephemeral tokens

## Stack

- `Next.js` App Router
- `@google/genai` on the server for ephemeral token creation
- direct browser WebSocket connection to Gemini Live API
- `Vitest` for smoke tests around config and message parsing

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy envs:

   ```bash
   copy .env.example .env.local
   ```

3. Put your Gemini API key into `.env.local`:

   ```env
   GEMINI_API_KEY=your_key_here
   ```

4. Start the app:

   ```bash
   npm run dev
   ```

## Checks

- `npm run test` - unit tests for message parsing, audio helpers, and token config
- `npm run typecheck` - TypeScript validation
- `npm run build` - production build check
- `npm run check` - full local verification

## Vercel deploy

1. Import the project into Vercel.
2. Add `GEMINI_API_KEY` in Project Settings -> Environment Variables.
3. Deploy.

## Notes

- The browser connects to Gemini Live with short-lived ephemeral tokens, so the real API key stays server-side.
- Audio input is converted to `audio/pcm;rate=16000`.
- Camera frames are sent as `image/jpeg` once per second.
- Gemini audio output is played back as 24kHz PCM.
