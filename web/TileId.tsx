import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

async function copyId(id: string, button: HTMLButtonElement): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(id);
      return;
    } catch {
      /* HTTP and restricted clipboard permissions use the selection fallback. */
    }
  }
  const previousFocus = document.activeElement;
  const input = document.createElement('textarea');
  input.value = id;
  input.readOnly = true;
  input.setAttribute('aria-hidden', 'true');
  input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  // Keep the selection inside the active dialog; the page behind it is inert.
  (button.closest('dialog') ?? document.body).appendChild(input);
  try {
    input.focus({ preventScroll: true });
    input.select();
    if (!document.execCommand('copy')) throw new Error('Copie indisponible');
  } finally {
    input.remove();
    if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
  }
}

export function TileId({ id, className = '' }: { id: string; className?: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const [feedback, setFeedback] = useState<{ id: string; copied: boolean } | null>(null);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 3000);
    return () => clearTimeout(timer);
  }, [feedback]);
  const current = feedback?.id === id ? feedback : null;
  async function copy() {
    try {
      await copyId(id, button.current!);
      setFeedback({ id, copied: true });
    } catch {
      setFeedback({ id, copied: false });
    }
  }
  return (
    <div className={`tile-identity ${className}`}>
      <button
        ref={button}
        type="button"
        className="tile-id"
        disabled={!id}
        aria-label={`Copier l’identifiant ${id}`}
        title={current?.copied ? `ID copié : ${id}` : `Copier l’identifiant : ${id}`}
        onClick={() => void copy()}
      >
        <span>ID</span>
        <code>{id || '—'}</code>
        {current?.copied ? (
          <Check size={12} aria-hidden="true" />
        ) : (
          <Copy size={12} aria-hidden="true" />
        )}
      </button>
      <span role="status" className={current && !current.copied ? 'id-copy-error' : 'sr-only'}>
        {current
          ? current.copied
            ? `Identifiant ${id} copié`
            : 'Copie indisponible : sélectionnez et copiez l’ID.'
          : ''}
      </span>
    </div>
  );
}
