import { useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import methodologyMarkdown from '../../docs/METHODOLOGY.md?raw';

const KARPATHY_GIST_URL = 'https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f';

export default function DocsPage() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Cerebro Atlas Docs';
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });

    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <div className="docs-page-shell">
      <div className="page-atmosphere" />

      <header className="docs-page-header">
        <div className="docs-page-header-copy">
          <p className="eyebrow">Cerebro Atlas</p>
          <h1>Methodology Guide</h1>
          <p className="support-copy">
            Rebuild the full system from scratch: Obsidian vault, Node graph builder, graphify
            semantic edges, Louvain clustering, React viewer, and private snapshot publishing.
          </p>
        </div>

        <div className="docs-page-actions">
          <a className="note-action-button" href="/">
            Back to graph
          </a>
          <a
            className="note-action-button"
            href={KARPATHY_GIST_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Karpathy gist
          </a>
        </div>
      </header>

      <main className="docs-page-main">
        <article className="markdown-shell full-note about-shell docs-article">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a({ href, children, ...props }) {
                const isExternal = typeof href === 'string' && /^https?:\/\//.test(href);

                return (
                  <a
                    href={href}
                    target={isExternal ? '_blank' : undefined}
                    rel={isExternal ? 'noopener noreferrer' : undefined}
                    {...props}
                  >
                    {children}
                  </a>
                );
              },
            }}
          >
            {methodologyMarkdown}
          </ReactMarkdown>
        </article>
      </main>
    </div>
  );
}
