import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { renderObsidianMarkdown } from '../lib/markdown';
import type { VaultNote } from '../types';

type NoteInspectorProps = {
  note: VaultNote | null;
  onOpenNote: () => void;
};

export function NoteInspector({ note, onOpenNote }: NoteInspectorProps) {
  if (!note) {
    return (
      <section className="inspector-shell empty">
        <p className="eyebrow">Inspector</p>
        <h2>Select a note</h2>
        <p>
          Pick any node in the terrain or use the search list to inspect the source markdown behind it.
        </p>
      </section>
    );
  }

  return (
    <section className="inspector-shell">
      <p className="eyebrow">Selected Note</p>
      <div className="inspector-header">
        <div className="inspector-title-block">
          <h2>{note.title}</h2>
          <p className="inspector-path">{note.path}</p>
        </div>
        <button type="button" className="note-action-button" onClick={onOpenNote}>
          Open Full Note
        </button>
      </div>

      <dl className="inspector-metrics">
        <div>
          <dt>Importance</dt>
          <dd>{note.importance.toFixed(1)}</dd>
        </div>
        <div>
          <dt>Links</dt>
          <dd>
            {note.incomingCount} in / {note.outgoingCount} out
          </dd>
        </div>
        <div>
          <dt>Words</dt>
          <dd>{note.wordCount}</dd>
        </div>
      </dl>

      {note.tags.length > 0 ? (
        <div className="tag-cloud">
          {note.tags.map((tag) => (
            <span key={tag} className="tag-chip">
              #{tag}
            </span>
          ))}
        </div>
      ) : null}

      {note.aliases.length > 0 ? (
        <div className="alias-block">
          <p className="mini-label">Aliases</p>
          <p>{note.aliases.join(' / ')}</p>
        </div>
      ) : null}

      <div className="markdown-shell">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{renderObsidianMarkdown(note.markdown)}</ReactMarkdown>
      </div>
    </section>
  );
}
