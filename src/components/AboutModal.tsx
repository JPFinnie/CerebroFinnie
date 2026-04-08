import { useEffect } from 'react';

type AboutModalProps = {
  onClose: () => void;
};

const KARPATHY_GIST_URL = 'https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f';
const DOCS_URL = '/docs';

export function AboutModal({ onClose }: AboutModalProps) {
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
      <div
        className="note-modal about-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-modal-title"
      >
        <div className="note-modal-header">
          <div>
            <p className="eyebrow">About Cerebro Atlas</p>
            <h2 id="about-modal-title">A persistent, compounding knowledge brain</h2>
            <p className="inspector-path">Inspired by Andrej Karpathy's "LLM Wiki" pattern</p>
          </div>

          <div className="note-modal-actions">
            <a
              className="note-action-button"
              href={KARPATHY_GIST_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Karpathy's gist
            </a>
            <a className="note-action-button" href={DOCS_URL}>
              Read full docs
            </a>
            <button type="button" className="note-action-button close" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="note-modal-content">
          <div className="markdown-shell full-note about-shell">
            <section>
              <h3>The problem Karpathy framed</h3>
              <p>
                Most LLM + document setups today use retrieval-augmented generation: every
                question triggers a fresh search across raw files, the model synthesizes an
                answer in the moment, and then the work evaporates. As Karpathy puts it:{' '}
                <em>"the LLM is rediscovering knowledge from scratch on every question. There's no accumulation."</em>
              </p>
              <p>
                His proposal is to treat the LLM less like an answer generator and more like a
                librarian. Instead of asking it the same questions over and over, you let it
                maintain a <strong>persistent, incrementally-updated wiki</strong> as an
                intermediary layer between your sources and your queries. The wiki is the
                compounding artifact - cross-references are already wired, contradictions already
                flagged, and summaries are already filed.
              </p>
            </section>

            <section>
              <h3>The three layers</h3>
              <ol>
                <li>
                  <strong>Raw sources</strong> - immutable inputs such as papers, articles,
                  meeting notes, transcripts, screenshots, and internal documents.
                </li>
                <li>
                  <strong>The wiki</strong> - LLM-generated and LLM-maintained markdown:
                  entity pages, topic pages, summaries, and dense cross-references.
                </li>
                <li>
                  <strong>The schema</strong> - a small config document that describes the
                  wiki's structure and the rules for ingest, query, and lint workflows.
                </li>
              </ol>
              <p>
                Humans curate sources and ask questions. The LLM does the summarizing,
                cross-referencing, filing, and bookkeeping that makes a knowledge base useful
                over time.
              </p>
            </section>

            <section>
              <h3>How Cerebro Atlas implements it</h3>
              <p>
                Cerebro Atlas treats an Obsidian vault as the wiki, a Node build script as the
                indexer, and a 3D force-directed graph as the navigation surface so you can see
                the topology of your own notes.
              </p>
              <ul>
                <li>
                  <strong>The vault.</strong> Markdown notes with frontmatter, wikilinks, inline
                  tags, and Obsidian color groups.
                </li>
                <li>
                  <strong>The build script.</strong> `scripts/build-vault-graph.mjs` parses the
                  vault, resolves links, computes importance, imports semantic edges, and writes
                  a single `vault-graph.json` snapshot.
                </li>
                <li>
                  <strong>The viewer.</strong> A React 19 + Three.js scene renders notes as
                  spheres, links as edges, and clusters as visible topic islands.
                </li>
                <li>
                  <strong>The sync layer.</strong> A publish script uploads only the derived
                  snapshot to private Supabase storage; the raw vault stays local.
                </li>
              </ul>
            </section>

            <section>
              <h3>How a large bank could use this</h3>
              <p>
                The same pattern maps well to enterprise knowledge systems: private ingestion,
                audit-grade provenance, business-line-specific ontologies, control mapping, and
                institutional memory that compounds instead of disappearing into SharePoint or
                Confluence.
              </p>
              <p>
                The detailed implementation guide, full scripts, and zero-to-live walkthrough are
                in the public docs page linked above.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
