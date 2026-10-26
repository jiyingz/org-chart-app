import { useState } from 'react';
import { formatDate, nowIso, uid } from '../model/graph';
import { emptyNotes, type NoteSection, type Notes } from '../model/types';
import { IconClose } from './icons';

const SECTIONS: { key: NoteSection; title: string; placeholder: string }[] = [
  { key: 'notable', title: 'Notable work', placeholder: 'e.g. Led the Ads ranking rewrite' },
  { key: 'other', title: 'Other notes', placeholder: 'Add a note…' },
];

interface Props {
  notes: Notes;
  onAdd(section: NoteSection, text: string): void;
  onRemove(section: NoteSection, id: string): void;
}

/** Two note lists. Type a line, press Add (or Enter); each line is stamped with today's date. */
export function NotesEditor({ notes, onAdd, onRemove }: Props) {
  return (
    <div>
      {SECTIONS.map((s) => (
        <NoteGroup key={s.key} section={s} items={notes[s.key]} onAdd={(t) => onAdd(s.key, t)} onRemove={(id) => onRemove(s.key, id)} />
      ))}
    </div>
  );
}

function NoteGroup({
  section,
  items,
  onAdd,
  onRemove,
}: {
  section: (typeof SECTIONS)[number];
  items: Notes[NoteSection];
  onAdd(text: string): void;
  onRemove(id: string): void;
}) {
  const [text, setText] = useState('');
  const submit = () => {
    if (!text.trim()) return;
    onAdd(text);
    setText('');
  };
  return (
    <div className="notes-group">
      <h4>{section.title}</h4>
      <div className="note-add">
        <input
          className="input"
          value={text}
          placeholder={section.placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" className="btn" onClick={submit} disabled={!text.trim()}>
          Add
        </button>
      </div>
      {items.map((n) => (
        <div key={n.id} className={`note ${section.key}`}>
          <div className="text">
            {n.text}
            <span className="date">{formatDate(n.createdAt)}</span>
          </div>
          <button type="button" className="icon-btn sm" aria-label="Delete note" onClick={() => onRemove(n.id)}>
            <IconClose size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Notes held in form state before the entity exists. */
export function useDraftNotes() {
  const [notes, setNotes] = useState<Notes>(emptyNotes);
  return {
    notes,
    onAdd: (section: NoteSection, text: string) =>
      setNotes((n) => ({ ...n, [section]: [{ id: uid(), text: text.trim(), createdAt: nowIso() }, ...n[section]] })),
    onRemove: (section: NoteSection, id: string) => setNotes((n) => ({ ...n, [section]: n[section].filter((x) => x.id !== id) })),
  };
}
