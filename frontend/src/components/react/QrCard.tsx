import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

/** Renders a QR to canvas. The whole library is only pulled into this island. */
export default function QrCard({ value, size = 220 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    void QRCode.toCanvas(ref.current, value, {
      width: size,
      margin: 1,
      color: { dark: '#1b1f3b', light: '#fff9ee' },
    });
  }, [value, size]);

  return (
    <canvas
      ref={ref}
      className="surface p-3"
      width={size}
      height={size}
      role="img"
      aria-label={`QR code linking to ${value}`}
    />
  );
}
