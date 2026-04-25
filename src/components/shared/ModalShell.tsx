import { useEffect } from 'react';

interface Props {
  onDismiss: () => void;
  children: React.ReactNode;
  zIndex?: string;
}

export default function ModalShell({ onDismiss, children, zIndex = 'z-50' }: Props) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div
      className={`fixed inset-0 ${zIndex} flex items-center justify-center p-4 bg-background/85 backdrop-blur-sm`}
      onClick={onDismiss}
    >
      <div
        className="card-forged w-full max-w-md flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 max-h-[90dvh]"
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
