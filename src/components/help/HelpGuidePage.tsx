import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { SimpleMarkdown, extractGuideToc } from './SimpleMarkdown';
import { HelpGuideLayout } from './HelpGuideLayout';
import { HelpGuideActions, PRINT_ROOT_ID } from './HelpGuideActions';
import { preprocessGuideMarkdown } from './preprocessGuideMarkdown';
import {
  HELP_GUIDE_TITLES,
  isHelpGuideSlug,
  type HelpGuideSlug,
} from '../../content/helpContent';
import { scrollToHelpHash } from './scrollToHelpHash';

const guideLoaders: Record<HelpGuideSlug, () => Promise<{ default: string }>> = {
  'whats-new': () => import('../../../docs/WHATS_NEW.md?raw'),
  workspace: () => import('../../../docs/WORKSPACE_GUIDE.md?raw'),
  shortcuts: () => import('../../../docs/QUICKSTART_AND_HOTKEYS.md?raw'),
};

function GuideTableOfContents({ slug, entries }: { slug: HelpGuideSlug; entries: ReturnType<typeof extractGuideToc> }) {
  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">On this page</p>
      <ul className="space-y-1 border-l border-border pl-3">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              className="text-muted-foreground hover:text-primary leading-snug block py-0.5"
            >
              {entry.label}
            </a>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground pt-4 border-t">
        {slug === 'workspace' ? (
          <a href="/help/shortcuts" className="text-primary hover:underline">
            Keyboard reference →
          </a>
        ) : (
          <a href="/help/workspace" className="text-primary hover:underline">
            Full workspace guide →
          </a>
        )}
      </p>
    </div>
  );
}

export function HelpGuidePage() {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const guideSlug = isHelpGuideSlug(slug) ? slug : null;
  const [rawMarkdown, setRawMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!guideSlug) return;
    let cancelled = false;
    setRawMarkdown(null);
    setError(null);
    guideLoaders[guideSlug]()
      .then((mod) => {
        if (!cancelled) setRawMarkdown(mod.default);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this guide.');
      });
    return () => {
      cancelled = true;
    };
  }, [guideSlug]);

  const markdown = useMemo(
    () => (rawMarkdown ? preprocessGuideMarkdown(rawMarkdown) : null),
    [rawMarkdown]
  );

  const toc = useMemo(() => (markdown ? extractGuideToc(markdown) : []), [markdown]);

  useEffect(() => {
    if (!markdown || !location.hash) return;
    scrollToHelpHash(location.hash);
  }, [markdown, location.hash]);

  if (!guideSlug) {
    return <Navigate to="/help" replace />;
  }

  const title = HELP_GUIDE_TITLES[guideSlug];
  const pdfFilename = `meridian-${guideSlug}-guide`;

  return (
    <HelpGuideLayout
      title={title}
      currentSlug={guideSlug}
      actions={<HelpGuideActions filename={pdfFilename} />}
      aside={<GuideTableOfContents slug={guideSlug} entries={toc} />}
    >
      {error && <p className="text-destructive">{error}</p>}
      {!error && markdown === null && (
        <p className="text-muted-foreground animate-pulse">Loading guide…</p>
      )}
      {markdown && (
        <div id={PRINT_ROOT_ID}>
          <SimpleMarkdown content={markdown} className={cn('pb-12')} omitFirstH1 />
          <p className="text-xs text-muted-foreground border-t pt-6">
            This guide reflects the current Meridian Takeoff UI. Features such as AI Chat depend on your
            deployment&apos;s server configuration.
          </p>
        </div>
      )}
    </HelpGuideLayout>
  );
}
