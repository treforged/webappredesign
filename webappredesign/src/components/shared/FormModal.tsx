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
  return (
    <div className="fixed inset-0 bg-background/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card-forged p-6 w-full max-w-md space-y-3 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold text-sm">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
        </div>
        {fields.map(f => (
          <div key={f.key}>
            <label className="text-[10px] text-muted-foreground uppercase">{f.label}</label>
            {f.type === 'select' ? (
              <select
                value={values[f.key] || ''}
                onChange={e => onChange(f.key, e.target.value)}
                className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground"
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
                className="w-full mt-1 bg-secondary border border-border px-2 py-1.5 text-xs text-foreground"
                style={{ borderRadius: 'var(--radius)' }}
                placeholder={f.placeholder}
              />
            )}
          </div>
        ))}
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
  );
}
