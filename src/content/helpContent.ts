import type { HelpFaqConfig, HelpItem } from './helpFaqTypes';

export type { HelpItem, HelpFaqConfig } from './helpFaqTypes';
export { getFaqItemsForSurface } from './helpFaqTypes';

export type HelpSurface = 'dashboard' | 'workspace';

export type HelpGuideLink = {
  id: string;
  label: string;
  href: string;
  description?: string;
};

export type WorkspaceHelpState = {
  hasOpenPdf: boolean;
  isCalibrating: boolean;
  isMeasuring: boolean;
  hasSelectedCondition: boolean;
};

export const DEFAULT_HELP_FAQ_CONFIG: HelpFaqConfig = {
  version: 1,
  dashboard: [
  {
    id: 'where-is-help',
    question: 'Where can I find help while using the app?',
    answer:
      'Click Help in the header on this page, or press ? inside a project for common questions and links to full guides. Mode banners (calibration, titleblock, auto count) also have a ? icon for context-specific tips.',
  },
  {
    id: 'new-vs-restore',
    question: 'How do I create a project vs restore a backup?',
    answer:
      'Use New Project to start fresh and attach PDFs. Use Open Existing to import a Meridian backup or export file into your account — restored projects belong to you.',
  },
  {
    id: 'open-existing',
    question: 'What does Open Existing do?',
    answer:
      'It opens the same backup/restore flow used when exporting projects. Pick a .json backup file to import measurements, conditions, and documents into your workspace.',
  },
  {
    id: 'profile',
    question: 'Where are account and password settings?',
    answer:
      'Click Profile in the top-right of this page to edit your name, company, change password, sign out, or delete your account.',
  },
  ],
  workspace: [
  {
    id: 'where-is-help',
    question: 'Where is in-app help?',
    answer:
      'Click the ? icon in the top command bar, near Tools, or press ? on your keyboard. Open the workspace or shortcuts guide from the menu for the full walkthrough.',
  },
  {
    id: 'pdfs-sheets',
    question: 'Where do I upload PDFs and open sheets?',
    answer:
      'Open the right sidebar with the edge chevron, then the Documents tab. Upload PDFs there and click a page to open it in the viewer. Ctrl/⌘+click or right-click opens a new sheet tab.',
  },
  {
    id: 'calibrate',
    question: 'How do I calibrate scale?',
    answer:
      'Use Calibrate Scale (or Recalibrate) in the top command bar. Enter a known real-world distance, then click two points along that dimension on the drawing. Re-calibrate after rotating a page.',
  },
  {
    id: 'measure',
    question: 'How do I start measuring?',
    answer:
      'Create or select a condition in the left Takeoff sidebar, then draw on the plan for that condition type. Each compact condition card shows its total, unit, and quick action icons. On desktop, press Space (when not typing in a field) to start drawing from plan-only selection. On iPad, tap the condition and use touch or Apple Pencil on the canvas. The status bar shows your active condition.',
  },
  {
    id: 'left-vs-right',
    question: "What's the difference between left Takeoff and right Documents?",
    answer:
      'Left: conditions, quantities, reports, and costs. Right (optional panel): project PDFs, OCR search, and AI Chat. They are separate — documents are not listed on the left.',
  },
  {
    id: 'titleblock',
    question: 'How do sheet names and titleblock extraction work?',
    answer:
      'In Documents, use the gear on a PDF or Document Actions → Extract Titleblock Info. You can also draw titleblock regions when prompted. Extracted sheet numbers and names appear on each page row.',
  },
  {
    id: 'ocr-search',
    question: 'How does OCR search work?',
    answer:
      'Open the Search tab in the right sidebar. If PDFs lack OCR text, queue OCR from the footer hint and watch the purple progress indicator in the bottom status bar, then search again.',
  },
  {
    id: 'space-escape',
    question: 'What do Space and Escape do?',
    answer:
      'Space starts drawing for the selected condition or clears/re-selects it depending on context. Escape backs out one step (last point, mode, or selection). On iPad without a keyboard, use the floating Undo/Cancel/Finish toolbar — it appears whenever you are measuring, calibrating, annotating, drawing a cutout, or placing a hyperlink. See the shortcuts guide for the full list.',
  },
  {
    id: 'ipad-tablet',
    question: 'Can I use Meridian Takeoff on iPad?',
    answer:
      'Yes. Use Safari or add to your Home Screen for full-screen use. One-finger drag pans; two-finger pinch zooms (pinch is safely ignored during active drawing so it cannot cancel a measurement). Tap to place measurement points; double-tap or tap Finish to complete a shape. Tap an existing markup to select it; drag a selected markup to move it. Hyperlink regions, cutouts, and annotation shapes all work with touch — use the floating Cancel/Finish toolbar at the bottom of the canvas whenever any drawing mode is active. Long-press a markup for the context menu. Sidebars open as slide-over drawers on narrow screens. See the workspace guide section Tablet & touch for details.',
  },
  {
    id: 'tools-profile',
    question: 'Where are Tools vs Profile settings?',
    answer:
      'Profile is on the project dashboard (Back to Projects, then Profile). Tools (wrench icon) in this workspace opens takeoff preferences: appearance, crosshairs, magnifier, ortho default, and hyperlinks. Press ? anytime for the help menu.',
  },
  ],
};

const DASHBOARD_FAQ = DEFAULT_HELP_FAQ_CONFIG.dashboard;
const WORKSPACE_FAQ = DEFAULT_HELP_FAQ_CONFIG.workspace;

const DASHBOARD_GUIDES: HelpGuideLink[] = [
  {
    id: 'workspace',
    label: 'Workspace guide',
    href: '/help/workspace',
    description: 'Full walkthrough of panels, tabs, and features',
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts & quick start',
    href: '/help/shortcuts',
    description: 'Keyboard reference and getting started steps',
  },
];

const WORKSPACE_GUIDES: HelpGuideLink[] = [
  {
    id: 'workspace',
    label: 'Workspace guide',
    href: '/help/workspace',
    description: 'Panels, documents, search, AI chat, and status bar',
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts & quick start',
    href: '/help/shortcuts',
    description: 'Space, Escape, undo, hyperlinks, and zoom',
  },
];

export const HELP_GUIDE_SLUGS = ['workspace', 'shortcuts'] as const;
export type HelpGuideSlug = (typeof HELP_GUIDE_SLUGS)[number];

export const HELP_SEEN_STORAGE_KEY = 'meridian-help-seen-v1';
export const HELP_WELCOME_DISMISSED_KEY = 'meridian-help-welcome-dismissed-v1';

/** Featured on /help for quick answers (workspace FAQ ids). */
export const HELP_POPULAR_FAQ_IDS = [
  'calibrate',
  'measure',
  'pdfs-sheets',
  'space-escape',
  'ocr-search',
] as const;

export const HELP_HUB_INTRO =
  'These guides describe the Meridian Takeoff app as it works today — project dashboard, takeoff workspace, documents, measurements, and exports. They are updated alongside the product.';

export const HELP_HUB_CARDS: Array<{
  slug: HelpGuideSlug;
  title: string;
  description: string;
  highlights: string[];
}> = [
  {
    slug: 'workspace',
    title: 'Workspace & features',
    description: 'Where everything lives and how panels work together.',
    highlights: [
      'Three-column layout and sidebars',
      'Documents, Search, and AI Chat',
      'Titleblock extraction and status bar',
      'Tablet & touch (iPad) gestures',
    ],
  },
  {
    slug: 'shortcuts',
    title: 'Quick start & shortcuts',
    description: 'Get productive fast with keyboard and mouse reference.',
    highlights: [
      'Calibrate and measure in six steps',
      'Space, Escape, undo, and hyperlinks',
      'Touch & tablet gesture reference',
      'Profile vs Tools settings',
    ],
  },
];

export function getHelpFaq(surface: HelpSurface): HelpItem[] {
  return surface === 'dashboard' ? DASHBOARD_FAQ : WORKSPACE_FAQ;
}

export function getHelpGuides(surface: HelpSurface): HelpGuideLink[] {
  return surface === 'dashboard' ? DASHBOARD_GUIDES : WORKSPACE_GUIDES;
}

export function getHelpSubtitle(surface: HelpSurface): string {
  return surface === 'dashboard' ? 'Projects' : 'Takeoff workspace';
}

export function getWorkspaceContextTip(state: WorkspaceHelpState): string | null {
  if (state.isCalibrating) {
    return 'Tap two points along your known dimension. Escape or Cancel (floating toolbar on iPad) removes the last point.';
  }
  if (state.isMeasuring) {
    return 'Draw on the plan for the selected condition. Escape or Cancel removes the last point; double-tap or Finish completes multi-point shapes.';
  }
  if (!state.hasOpenPdf) {
    return 'Open the right sidebar (edge chevron) → Documents to upload PDFs and open a sheet.';
  }
  if (!state.hasSelectedCondition) {
    return 'Select a condition on the left, then press Space (desktop) or tap and draw on the plan (iPad).';
  }
  return null;
}

export function isHelpGuideSlug(slug: string | undefined): slug is HelpGuideSlug {
  return slug !== undefined && (HELP_GUIDE_SLUGS as readonly string[]).includes(slug);
}

export const HELP_GUIDE_TITLES: Record<HelpGuideSlug, string> = {
  workspace: 'Workspace & features',
  shortcuts: 'Quick start & keyboard reference',
};

/** Focused help shown on mode banners and calibration UI */
export const HELP_TOPIC_IDS = ['auto-count', 'titleblock', 'calibrate'] as const;
export type HelpTopicId = (typeof HELP_TOPIC_IDS)[number];

const HELP_TOPICS: Record<HelpTopicId, HelpItem & { guideHref: string }> = {
  'auto-count': {
    id: 'auto-count',
    question: 'Auto Count mode',
    answer:
      'Draw a tight box around one representative symbol on the plan. The app searches the sheet for similar graphics and adds counts to the active condition. Cancel by exiting visual search or selecting another tool.',
    guideHref: '/help/workspace',
  },
  titleblock: {
    id: 'titleblock',
    question: 'Titleblock selection',
    answer:
      'Draw a box around the sheet number or sheet name region in the titleblock. After both regions are set (when required), extraction runs for that document. Use Document Actions for batch extraction across PDFs.',
    guideHref: '/help/workspace',
  },
  calibrate: {
    id: 'calibrate',
    question: 'Calibrating scale',
    answer:
      'Enter a known real-world length, then click or tap two points along that dimension on the drawing. Use a dimension line or scale bar when possible. Escape or Cancel removes the last point; re-calibrate after rotating a page.',
    guideHref: '/help/shortcuts',
  },
};

export function getHelpTopic(topicId: HelpTopicId): HelpItem & { guideHref: string } {
  return HELP_TOPICS[topicId];
}
