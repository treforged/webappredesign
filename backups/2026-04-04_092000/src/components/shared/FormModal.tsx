import { useEffect } from 'react';
import { X } from 'lucide-react';

type Field = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select';
  placeholder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  step?: string;
};

type Props = {
  title: string;
  fields: Field[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onSave: () => void;
  onClose: () => void;
  saving?: boolean;
  saveLabel?: string;
};

export default function FormModal({ title, fields, values, onChange, onSave, onClose, saving, saveLabel = 'Save' }: Props) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div className="fixed inset-0 bg-background/80 z-[60] flex items-end sm:items-center justify-center sm:p-4" style={{ touchAction: 'none' }} onClick={onClose}>
      <div
        className="card-forged w-full sm:max-w-md flex flex-col max-h-[78dvh] sm:max-h-[90dvh] rounded-b-none sm:rounded-b-[var(--radius)]"
        onClick={e => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="flex items-center justify-between px-4 sm:px-6 pt-4 sm:pt-6 pb-3 shrink-0">
          <h2 className="font-display font-semibold text-sm">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
        </div>

        {/* Scrollable fields */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 space-y-2 sm:space-y-3" style={{ WebkitOverflowScrolling: 'touch' }}>
          {fields.map(f => (
            <div key={f.key}>
              <label className="text-[10px] text-muted-foreground uppercase">{f.label}</label>
              {f.type === 'select' ? (
                <select
                  value={values[f.key] || ''}
                  onChange={e => onChange(f.key, e.target.value)}
                  className="w-full mt-0.5 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  {f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input
                  type={f.type}
                  step={f.step}
                  value={values[f.key] || ''}
                  onChange={e => onChange(f.key, e.target.value)}
                  className="w-full mt-0.5 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground"
                  style={{ borderRadius: 'var(--radius)' }}
                  placeholder={f.placeholder}
                />
              )}
            </div>
          ))}
        </div>

        {/* Sticky save button — always visible */}
        <div className="px-4 sm:px-6 pt-3 pb-4 sm:pb-6 shrink-0 border-t border-border">
          <button
            onClick={onSave}
            disabled={saving}
            className="w-full bg-primary text-primary-foreground py-2 text-xs font-semibold btn-press disabled:opacity-50"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {saving ? 'Saving...' : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
