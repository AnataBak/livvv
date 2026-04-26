import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const contentType = 'image/png';

const SIZE = 192;

export async function GET() {
  return new ImageResponse(<LivIcon size={SIZE} padding={SIZE * 0.16} />, {
    width: SIZE,
    height: SIZE,
  });
}

function LivIcon({ size, padding }: { size: number; padding: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0d3322',
      }}
    >
      <div
        style={{
          width: size - padding * 2,
          height: size - padding * 2,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #1f8a70 0%, #16a34a 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ffffff',
          fontSize: size * 0.55,
          fontWeight: 800,
          fontFamily: 'system-ui, sans-serif',
          letterSpacing: -2,
        }}
      >
        L
      </div>
    </div>
  );
}
