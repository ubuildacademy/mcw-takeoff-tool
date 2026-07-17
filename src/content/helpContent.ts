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
      'Space starts drawing for the selected condition or clears/re-selects it depending on context. Escape backs out one step (last point, mode, or selection) — or exits draw mode entirely when no points are in progress (e.g. right after finishing a segment). On iPad without a keyboard, use the floating Undo/Cancel/Finish toolbar — it appears whenever you are measuring, calibrating, annotating, drawing a cutout, or placing a hyperlink. See the shortcuts guide for the full list.',
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
  {
    id: 'condition-folders',
    question: 'How do I organize conditions into folders?',
    answer:
      'Click the folder + button at the top of the Conditions tab to create a new folder, then type a name and press Enter. To assign a condition to a folder, right-click the condition and choose "Move to folder" — a searchable submenu shows your folders. Right-click the same way to remove a condition from its folder. Hover over a folder header to rename (pencil) or delete (trash) it. Conditions in a deleted folder move to Uncategorized.',
  },
  {
    id: 'count-sub-quantity',
    question: 'Can a count condition also track a linear, area, or volume quantity?',
    answer:
      'Yes — use "Quantity per Count" in the condition form. Set a type (Linear, Area, or Volume), a unit (e.g. LF), and a value per count (e.g. 10). Every marker you place adds that amount to the sub-quantity total. Example: 5 window markers × 10 LF each = 50 LF shown in Reports and Costs. When a material cost is set, it prices on the sub-quantity total (e.g. $3/LF × 50 LF = $150).',
  },
  {
    id: 'copy-paste-conditions',
    question: 'Can I copy markups to a different condition, or fix markups drawn under the wrong condition?',
    answer:
      'Yes — two ways. To copy markups into a brand-new condition: select the markups, copy (Cmd/Ctrl+C or right-click → Copy), then Paste as New Condition (Cmd/Ctrl+Shift+V or right-click → Paste as New Condition). A new condition named "[Original] - COPY" is created with a distinct color and the markups are pasted under it — auto-selected so you can rename it immediately. To reassign existing markups to a different condition: select them on the canvas, right-click → Move to condition, then pick the target from the flyout. The flyout only shows conditions with the same type AND unit — so a linear (LF) markup cannot move to a linear-with-height (SF) condition even though both are "linear", preventing silent unit mismatches. Color and totals update instantly.',
  },
  {
    id: 'quantity-multiplier',
    question: 'What is the Quantity Multiplier on a condition?',
    answer:
      'The Quantity Multiplier scales a condition\'s total without re-drawing. Set it to an integer (e.g. 3) when the same area, run, or count repeats in N identical locations — draw one instance and multiply. The condition card, Reports, Costs, and Excel export all show the already-multiplied total (measured × N). Waste applies on top. An amber ×N badge on the condition name makes the multiplier visible at a glance. To remove it, edit the condition and clear the Multiplier field.',
  },
  {
    id: 'command-palette',
    question: 'What does the ⌘K command palette do?',
    answer:
      'Press ⌘K (Ctrl+K on Windows) to open a searchable palette. Type to jump to any sheet by number or name, activate a condition, or run an action like Calibrate, Magic wand, Compare sheet revisions, or Fit to window. Use the arrow keys and Enter to run the highlighted item; Escape closes the palette.',
  },
  {
    id: 'magic-wand',
    question: 'How does the magic wand measure a room automatically?',
    answer:
      'Click Wand in the top command bar (or find it in ⌘K), select an area or volume condition, then click inside an enclosed room — the app fills to the inside face of the walls and adds the measurement for you. The sheet must be calibrated first. If the room is not fully enclosed (an open doorway, for example) the wand refuses and tells you why instead of guessing. Escape exits wand mode, and the result undoes like any other measurement.',
  },
  {
    id: 'revision-compare',
    question: 'How do I compare sheet revisions and carry takeoffs forward?',
    answer:
      'Open "Compare sheet revisions…" from ⌘K and pick the old and new revision of a sheet (they must be the same sheet size). The overlay shows red for removed linework, blue for added, and fades unchanged content, with 50/100/200% zoom. "Carry takeoffs to new rev" copies every measurement — including cutouts and arcs — from the old sheet to the new one and flags any takeoff sitting on a changed area for review; each carried measurement can be undone individually.',
  },
  {
    id: 'edit-vertices-arcs',
    question: 'How do I edit the vertices or add a curve to a measurement?',
    answer:
      'Right-click a measurement and choose "Edit vertices." Square handles move corners, and dragging a round mid-segment handle off the line bows that segment into a circular arc — drag it back onto the line to straighten it again. Quantities recompute when you release the handle, and Escape cancels a drag or exits edit mode. Count conditions cannot be vertex-edited, and edit mode only starts from the context menu so a takeoff can\'t be reshaped by accident.',
  },
  {
    id: 'moving-markups',
    question: 'How do I move a measurement or annotation?',
    answer:
      'Select the markup(s), then right-click → Move or press M to arm the move, and drag to reposition. Escape, pressing M again, or changing the selection disarms it. This applies to both measurements and annotations — annotations also have their own right-click menu with Move and Delete.',
  },
  {
    id: 'deep-hyperlinks',
    question: 'Can a hyperlink open a sheet already zoomed to the right spot?',
    answer:
      'Yes. When creating or editing a link, use "Create & set view…" or "Update & set view…" (or right-click an existing link → "Set target view…"), then navigate to the target page, position the view, and click "Save target view." Clicking the link afterward lands on that exact spot and zoom with a highlight pulse. Auto-hyperlink can set these automatically when it matches a detail callout to the detail title on the target sheet.',
  },
  {
    id: 'condition-templates',
    question: 'How do I reuse conditions across projects, and can I share them with my team?',
    answer:
      'Open Templates from the Conditions tab. Save the current project\'s conditions as a named template, then apply that template to seed a new project — rows with a name that already exists are skipped. Costs, waste factors, units, colors, and sub-quantities carry over, but auto-count search images do not. Templates are saved to your account, so they follow you to any device (templates from an older version import automatically the first time). Turn on "Shared" to publish a template to everyone on your team; shared templates show a Shared badge and are read-only to other users, while you (or an admin) stay in control of edits.',
  },
  {
    id: 'ai-chat-assistant',
    question: 'How does the AI Chat assistant use my project?',
    answer:
      'AI Chat reads your project as it answers: conditions, takeoff totals, and the text of your uploaded sheets. For each question it automatically pulls the most relevant sheets — mention a sheet number like A-101 and it focuses there. Pick a mode at the top (General, or the Division 7 waterproofing estimator with its built-in reference). Answers come back formatted with tables for quantity breakdowns and cite the sheet and page. Use Stop to end a long answer, Copy to grab a reply, and the suggested-question chips on a fresh chat to get started. There is a daily message limit per user (admins are exempt).',
  },
  {
    id: 'pdf-export-options',
    question: 'What options do I have when exporting a PDF report?',
    answer:
      '"Export PDF Report…" opens an options dialog first: choose what measurement labels show on sheets (quantity, condition name, or none), whether each page gets a legend, what the legend includes (name and quantity, or name only), and where the legend sits using an 8-position grid (corners and edge midpoints) so it stays clear of the titleblock. Your choices are saved per project, and emailed reports reuse the same saved options.',
  },
  {
    id: 'auto-scale-detection',
    question: 'Does calibration detect the scale automatically?',
    answer:
      'The Calibrate dialog scans the sheet for printed scale notations (like 1/4" = 1\'-0", 1"=20\', or 1:100) and checks the sheet\'s physical size against standard plot sizes, warning if it looks like a half-size or fit-to-page reprint. Picking a detected scale never applies it directly — you still click both ends of a printed dimension and confirm the value matches before it takes effect.',
  },
  ],
};

const DASHBOARD_FAQ = DEFAULT_HELP_FAQ_CONFIG.dashboard;
const WORKSPACE_FAQ = DEFAULT_HELP_FAQ_CONFIG.workspace;

const DASHBOARD_GUIDES: HelpGuideLink[] = [
  {
    id: 'whats-new',
    label: "What's new",
    href: '/help/whats-new',
    description: 'Every update, newest first',
  },
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
    id: 'whats-new',
    label: "What's new",
    href: '/help/whats-new',
    description: 'Every update, newest first',
  },
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

export const HELP_GUIDE_SLUGS = ['whats-new', 'workspace', 'shortcuts'] as const;
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
    slug: 'whats-new',
    title: "What's new",
    description: 'Every update to Meridian Takeoff, newest first.',
    highlights: [
      'Latest: templates sync, AI chat, dialog fixes',
      'The full 6-phase initial beta build',
      'Updated alongside every release',
    ],
  },
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
    return 'Draw on the plan for the selected condition. Escape or Cancel removes the last point; double-tap or Finish completes multi-point shapes. Escape with no points in progress exits draw mode and returns to selection mode.';
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
  'whats-new': "What's new",
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
