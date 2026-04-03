import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { renderObsidianMarkdown } from '../lib/markdown';
import type { VaultNote } from '../types';

type NoteModalProps = {
  note: VaultNote;
  onClose: () => void;
};

type ViewMode = 'rendered' | 'raw';

export function NoteModal({ note, onClose }: NoteModalProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('rendered');

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  }, [onClose]);

  return (
    <div className="note-modal-backdrop" onClick={onClose} role="presentation">
      <div className="note-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <div className="note-modal-header">
          <div>
            <p className="eyebrow">Full Note</p>
            <h2>{note.title}</h2>
            <p className="inspector-path">{note.path}</p>
          </div>

          <div className="note-modal-actions">
            <div className="note-view-toggle">
              <button
                type="button"
                className={viewMode === 'rendered' ? 'note-action-button active' : 'note-action-button'}
                onClick={() => setViewMode('rendered')}
              >
                Rendered
              </button>
              <button
                type="button"
                className={viewMode === 'raw' ? 'note-action-button active' : 'note-action-button'}
                onClick={() => setViewMode('raw')}
              >
                Raw Markdown
              </button>
            </div>

            <button type="button" className="note-action-button close" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="note-modal-content">
          {viewMode === 'rendered' ? (
            <div className="markdown-shell full-note">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{renderObsidianMarkdown(note.markdown)}</ReactMarkdown>
            </div>
          ) : (
            <pre className="raw-note-shell">{note.fullMarkdown}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
