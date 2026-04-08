import { LiveConsole } from '@/components/live-console';

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero-panel">
        <p className="eyebrow">Vercel-ready starter</p>
        <h1>Minimal Gemini Live voice sandbox</h1>
        <p className="hero-copy">
          This is a barebones Next.js app for talking to Gemini 3.1 Flash Live Preview with
          microphone, camera, text input, session reset, and mobile-friendly controls.
        </p>
      </section>

      <LiveConsole />
    </main>
  );
}
