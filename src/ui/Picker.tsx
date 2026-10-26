import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { EntityType } from '../model/types';
import { IconClose, IconPlus, IconSearch } from './icons';

export interface Option {
  key: string;
  label: string;
  sub?: string;
  kind?: EntityType;
}

interface Props {
  options: Option[];
  value: string | null;
  onChange(key: string | null): void;
  placeholder?: string;
  /** Offer "＋ Create …" for whatever was typed. */
  onCreate?(query: string): void;
  createLabel?(query: string): string;
  autoFocus?: boolean;
  /** Keep the list open even before typing (used by quick search). */
  alwaysOpen?: boolean;
  emptyText?: string;
}

const matches = (o: Option, q: string) => {
  if (!q) return true;
  const hay = `${o.label} ${o.sub ?? ''}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t));
};

/** Searchable dropdown. Type to filter, arrow keys + Enter to choose. */
export function Picker({
  options,
  value,
  onChange,
  placeholder = 'Search…',
  onCreate,
  createLabel = (q) => `Create "${q}"`,
  autoFocus,
  alwaysOpen,
  emptyText = 'No matches',
}: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(!!alwaysOpen);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.key === value);

  const filtered = useMemo(() => options.filter((o) => matches(o, query.trim())).slice(0, 80), [options, query]);
  const q = query.trim();
  const canCreate = !!onCreate && q.length > 0 && !options.some((o) => o.label.toLowerCase() === q.toLowerCase());
  const total = filtered.length + (canCreate ? 1 : 0);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const choose = (i: number) => {
    if (i < filtered.length) {
      onChange(filtered[i].key);
      setQuery('');
      setOpen(!!alwaysOpen);
    } else if (canCreate) {
      onCreate!(q);
      setQuery('');
      setOpen(false);
    }
  };

  if (selected && !alwaysOpen) {
    return (
      <div className="picker-selected">
        {selected.kind && <span className={`ent-dot ${selected.kind}`} style={{ width: 9, height: 9, borderRadius: 9 }} />}
        <div className="grow">
          <div className="opt-label">{selected.label}</div>
          {selected.sub && <div className="opt-sub">{selected.sub}</div>}
        </div>
        <button
          type="button"
          className="icon-btn sm"
          aria-label="Clear"
          onClick={() => {
            onChange(null);
            setOpen(true);
            setTimeout(() => inputRef.current?.focus());
          }}
        >
          <IconClose size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="picker">
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 12, top: 12, color: 'var(--muted)' }}>
          <IconSearch size={17} />
        </span>
        <input
          ref={inputRef}
          className="input"
          style={{ paddingLeft: 36 }}
          value={query}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          onFocus={() => setOpen(true)}
          onBlur={() => !alwaysOpen && setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(total - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (total) choose(active);
            }
          }}
        />
      </div>
      {open && (
        <div className="picker-list" id={listId} role="listbox">
          {filtered.map((o, i) => (
            <button
              type="button"
              key={o.key}
              className={`picker-opt ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
              role="option"
              aria-selected={i === active}
            >
              {o.kind && <span className={`ent-dot ${o.kind}`} style={{ width: 9, height: 9, borderRadius: 9, flex: 'none' }} />}
              <div>
                <div className="opt-label">{o.label}</div>
                {o.sub && <div className="opt-sub">{o.sub}</div>}
              </div>
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              className={`picker-opt picker-create ${active === filtered.length ? 'active' : ''}`}
              onMouseEnter={() => setActive(filtered.length)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(filtered.length)}
            >
              <IconPlus size={16} /> {createLabel(q)}
            </button>
          )}
          {!total && <div className="picker-empty">{emptyText}</div>}
        </div>
      )}
    </div>
  );
}
