import { useEffect } from 'react';

type AboutModalProps = {
  onClose: () => void;
};

const KARPATHY_GIST_URL = 'https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f';

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
            <p className="inspector-path">
              Inspired by Andrej Karpathy's "LLM Wiki" pattern
            </p>
          </div>

          <div className="note-modal-actions">
            <a
              className="note-action-button"
              href={KARPATHY_GIST_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Karpathy's gist ↗
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
                <em>"the LLM is rediscovering knowledge from scratch on every question.
                There's no accumulation."</em>
              </p>
              <p>
                His proposal is to treat the LLM less like an answer generator and more like
                a librarian. Instead of asking it the same questions over and over, you let
                it maintain a <strong>persistent, incrementally-updated wiki</strong> as an
                intermediary layer between your sources and your queries. The wiki is the
                compounding artifact — cross-references are already wired, contradictions
                already flagged, summaries already filed.
              </p>
            </section>

            <section>
              <h3>The three layers</h3>
              <ol>
                <li>
                  <strong>Raw sources</strong> — immutable inputs (papers, articles, meeting
                  notes, transcripts, screenshots, internal documents).
                </li>
                <li>
                  <strong>The wiki</strong> — LLM-generated and LLM-maintained markdown:
                  entity pages, topic pages, summaries, and dense cross-references.
                </li>
                <li>
                  <strong>The schema</strong> — a small config document (Karpathy uses a
                  CLAUDE.md-style file) that describes the wiki's structure and the rules
                  for ingest, query, and lint workflows. The pattern, not the
                  implementation.
                </li>
              </ol>
              <p>
                Humans curate sources and ask questions. The LLM does{' '}
                <em>"the summarizing, cross-referencing, filing, and bookkeeping that makes
                a knowledge base actually useful over time."</em> Karpathy traces the
                lineage back to Vannevar Bush's 1945 <strong>Memex</strong> essay; the part
                Bush could never solve was who would do the maintenance. LLMs are the
                answer.
              </p>
            </section>

            <section>
              <h3>How Cerebro Atlas implements it</h3>
              <p>
                Cerebro Atlas is one concrete instantiation of the pattern. It treats an
                Obsidian vault as the wiki, a Node build script as the indexer, and a 3D
                force-directed graph as the navigation surface — so you can <em>see</em>{' '}
                the topology of your own mind.
              </p>
              <ul>
                <li>
                  <strong>The vault (raw + wiki layers).</strong> An Obsidian folder of
                  markdown notes — frontmatter, <code>[[wikilinks]]</code>, inline tags,
                  Obsidian color groups. New sources get ingested by the LLM into the same
                  vault, which means the wiki <em>is</em> a first-class file tree, not a
                  hidden vector store.
                </li>
                <li>
                  <strong>The build script (the indexer).</strong>{' '}
                  <code>scripts/build-vault-graph.mjs</code> walks the vault, parses
                  frontmatter with gray-matter, extracts wikilinks, computes importance
                  scores from in/out-degree and word count, assigns clusters from
                  Obsidian's color groups, and synthesizes sibling edges for orphan-heavy
                  folders so unconnected content still clusters visually. The output is a
                  single <code>vault-graph.json</code> snapshot.
                </li>
                <li>
                  <strong>The viewer (the navigation surface).</strong> A React 19 +
                  Three.js (react-three-fiber) scene renders every note as a colored sphere,
                  every link as a glowing edge, and three topology modes — centralized,
                  clustered, distributed — let you flip between "where's the gravity?",
                  "what are the islands?", and "how flat is my knowledge?". Click a node to
                  inspect, click empty space to deselect, toggle Pan/Orbit for mouse
                  navigation, or drive the camera with hand gestures via MediaPipe.
                </li>
                <li>
                  <strong>The sync layer (the moat).</strong> A second script publishes the
                  generated snapshot to a private Supabase Storage bucket
                  (<code>cerebro-private</code>). The viewer authenticates against Supabase
                  with email + password, fetches the latest snapshot through a serverless
                  function, and caches it locally for offline reads. Your raw vault never
                  leaves your machine; only the derived graph crosses the wire.
                </li>
              </ul>
            </section>

            <section>
              <h3>How a large bank could use this</h3>
              <p>
                The Karpathy pattern maps unusually well onto an enterprise knowledge
                problem. Banks already produce vast amounts of internal text — credit
                memos, deal notes, model documentation, incident postmortems, regulatory
                correspondence, RFP responses, control attestations — and most of it dies
                inside SharePoint. A bank-grade Cerebro deployment would look like this:
              </p>
              <ul>
                <li>
                  <strong>Private-by-default ingestion.</strong> Run the entire pipeline
                  inside the bank's tenancy: Azure Private Link to a self-hosted Supabase /
                  Postgres, Entra ID (formerly Azure AD) for SSO via OIDC, customer-managed
                  keys for storage encryption, and a private LLM endpoint (Azure OpenAI,
                  Anthropic on Bedrock, or an internal Llama deployment). Raw sources never
                  touch a public model.
                </li>
                <li>
                  <strong>Audit-grade provenance.</strong> Because the wiki is a flat
                  markdown tree under git, every LLM edit is a diffable commit. Every
                  cross-reference points to a stable note ID. That's exactly what model
                  risk management (SR 11-7), the EU AI Act, and internal audit teams ask
                  for: "show me the lineage of this answer." A vector-only RAG can't answer
                  that question; a wiki-of-record can.
                </li>
                <li>
                  <strong>Domain spines.</strong> Spin up parallel vaults per business line
                  — Markets, Wealth, Commercial Credit, Risk, Compliance — each with its
                  own schema document defining the ontology (Counterparty, Facility, Limit,
                  Control, Issue, Regulation, Examiner Finding). The same build script and
                  3D viewer work unchanged; only the schema and color bands differ.
                </li>
                <li>
                  <strong>Onboarding & institutional memory.</strong> A new analyst can
                  literally <em>see</em> how a deal type connects to a counterparty, a
                  control, a regulator, a precedent. Senior bankers' tacit knowledge gets
                  captured at the point of conversation by an LLM transcribing into the
                  wiki, instead of evaporating when they leave.
                </li>
                <li>
                  <strong>Regulatory & control mapping.</strong> Each control or regulation
                  becomes an entity page; every test, exception, and remediation links back
                  to it. The 3D view becomes a literal heatmap of where your control
                  coverage clusters and where it leaves orphan zones. That's a story you
                  can tell an examiner.
                </li>
                <li>
                  <strong>Incident & change postmortems.</strong> Every incident gets
                  ingested as a source. The LLM updates the relevant system, team, and
                  control pages, flags contradictions with prior postmortems, and raises a
                  lint warning when the same root cause recurs. Compounding learning, not
                  another forgotten Confluence page.
                </li>
              </ul>
              <p>
                The bet is that the value isn't in any single answer — it's in the
                <em> shape </em>of the institution's knowledge over time, kept honest and
                current by a tireless librarian, and made legible by a view that lets a
                human eye actually navigate it.
              </p>
            </section>

            <section>
              <h3>Stack snapshot</h3>
              <ul>
                <li>
                  <strong>Vault format:</strong> Obsidian markdown with frontmatter,
                  wikilinks, inline tags, color groups
                </li>
                <li>
                  <strong>Indexer:</strong> Node ESM script using gray-matter; outputs a
                  single JSON snapshot with notes, edges, groups, and importance scores
                </li>
                <li>
                  <strong>Viewer:</strong> React 19 + Vite + TypeScript, Three.js via{' '}
                  <code>@react-three/fiber</code> and <code>@react-three/drei</code>,
                  custom force-directed layouts (centralized / clustered / distributed)
                </li>
                <li>
                  <strong>Hosting:</strong> Vercel for the viewer, Supabase for private
                  snapshot storage and email/password auth
                </li>
                <li>
                  <strong>Optional:</strong> MediaPipe Tasks Vision for hand-gesture
                  camera control
                </li>
              </ul>
            </section>

            <section>
              <p style={{ opacity: 0.78, fontStyle: 'italic' }}>
                "The document's only job is to communicate the pattern. Your LLM can figure
                out the rest." — A. Karpathy
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
