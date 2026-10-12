import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { button, card, mono } from '@/lib/ui';
import { cn } from '@/lib/cn';
import QrCard from './QrCard';

export default function CounterPanel() {
  // Static build: read the invoice from the URL on the client (defaults to the demo invoice).
  const [invoice] = useState(() => (typeof location === 'undefined' ? '' : new URLSearchParams(location.search).get('invoice')) || 'INV-204');
  const [copied, setCopied] = useState(false);
  const [url] = useState(() =>
    typeof window !== 'undefined'
      ? `${window.location.origin}/buy?counter=${encodeURIComponent(invoice)}`
      : `https://moltol.app/buy?counter=${invoice}`,
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className={cn(card, 'mx-auto flex max-w-md flex-col items-center gap-5 p-8 text-center')}>
      <QrCard value={url} />
      <div>
        <p className="text-sm text-ink-muted">Invoice</p>
        <p className={cn(mono, 'text-lg font-semibold text-ink')}>{invoice}</p>
      </div>
      <button type="button" onClick={copy} className={cn(button('secondary'), 'w-full')}>
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied ? 'Copied' : 'Copy link'}
      </button>
      <p className={cn(mono, 'break-all text-[11px] text-ink-faint')}>{url}</p>
    </div>
  );
}
