/**
 * LandingPage — root / route.
 *
 * Behaviour by role:
 *   Admin   → sees ALL tools (regardless of visibility settings) + an
 *             "Admin panel" button and a private badge on hidden tools.
 *   Public  → sees only tools the admin has marked as Public.
 *             If no tools are public → empty state with contact message.
 *
 * Tool registry lives here (same list mirrored in AdminPanel.jsx).
 * When a new tool is added, update both files.
 */

import { Link } from 'react-router-dom';
import Icon from '../components/Icons.jsx';
import { useAdminAuth } from '../auth/useAdminAuth.js';
import { useToolVisibility } from '../auth/useToolVisibility.js';

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

const ALL_TOOLS = [
  {
    id: 'ds-analyser',
    to: '/ds-analyser',
    title: 'Creator DS Analyser',
    tagline: 'Inspect a Zoho Creator .ds export.',
    description:
      'Upload a Creator application bundle to instantly explore its structural breakdown, full data schema and a deterministic performance audit — all in one place.',
    Ico: Icon.Analyse,
    accent: 'from-brand-500/15 to-brand-500/5',
    badge: 'Stable',
    badgeTone:
      'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  },
  {
    id: 'tech-scope',
    to: '/tech-scope',
    title: 'Technical Scope Creator',
    tagline: 'Upload a BRD, get a packed PDF.',
    description:
      'Upload a requirement / BRD (PDF, DOCX, MD or TXT) and walk through 5 reviewable steps — Application Flow, Data Model, Modules & Roles, APIs, NFRs — adjusting each via plain-English prompts. Exports a packed PDF with embedded flowchart. Fully offline, no API keys.',
    Ico: Icon.Plan,
    accent: 'from-amber-500/15 to-amber-500/5',
    badge: 'Beta',
    badgeTone:
      'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LandingPage() {
  const { isAdmin } = useAdminAuth();
  const { visibility, loading } = useToolVisibility();

  // Admins see all tools; public users see only public ones
  const visibleTools = isAdmin
    ? ALL_TOOLS
    : ALL_TOOLS.filter((t) => visibility[t.id] === true);

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
      {/* Hero */}
      <section className="text-center space-y-3 max-w-3xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-semibold text-slate-900 dark:text-slate-100">
          Welcome to{' '}
          <span className="text-brand-600 dark:text-brand-400">Zoho Services Tools</span>
        </h2>
        <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
          A growing collection of internal utilities for the Zoho Services team — pick a tool
          below to get started.
        </p>
      </section>

      {/* Admin control bar */}
      {isAdmin && <AdminBar />}

      {/* Tool cards */}
      {loading && !isAdmin ? (
        /* Skeleton while loading visibility for public users */
        <div className="grid md:grid-cols-2 gap-5">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="card p-6 h-52 animate-pulse bg-slate-100 dark:bg-slate-800/50"
            />
          ))}
        </div>
      ) : visibleTools.length > 0 ? (
        <section className="grid md:grid-cols-2 gap-5">
          {visibleTools.map((t) => (
            <ToolCard
              key={t.id}
              {...t}
              isPrivate={isAdmin && !visibility[t.id]}
            />
          ))}
        </section>
      ) : (
        <EmptyState />
      )}

      {/* Footer hint */}
      <p className="text-center text-xs text-slate-400 dark:text-slate-500">
        {isAdmin
          ? 'You are viewing this page as Admin — all tools are shown regardless of visibility.'
          : "More tools will appear here as they're added."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin bar — shown only to admins at the top of the tool grid
// ---------------------------------------------------------------------------

function AdminBar() {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-brand-200 dark:border-brand-900 bg-brand-50 dark:bg-brand-900/20 px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-brand-700 dark:text-brand-300">
        <Icon.ShieldCheck size={16} />
        <span className="font-medium">Admin mode</span>
        <span className="text-brand-500 dark:text-brand-400 hidden sm:inline">
          — all tools visible. Use the admin panel to control public access.
        </span>
      </div>
      <Link to="/admin" className="btn-primary py-1.5 text-xs">
        <Icon.Eye size={14} />
        Manage visibility
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state — shown to public users when no tools are published
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-4 text-center">
      <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
        <Icon.Lock size={24} className="text-slate-400 dark:text-slate-500" />
      </div>
      <div className="space-y-1.5 max-w-xs">
        <h3 className="text-base font-semibold text-slate-700 dark:text-slate-300">
          No tools available
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No tools have been published yet. Please contact your administrator.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool card
// ---------------------------------------------------------------------------

function ToolCard({ to, title, tagline, description, Ico, accent, badge, badgeTone, isPrivate }) {
  return (
    <Link
      to={to}
      className="group card p-6 relative overflow-hidden hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700 transition focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 focus:ring-offset-slate-50 dark:focus:ring-offset-slate-950"
    >
      {/* Soft gradient wash for visual distinction */}
      <div
        className={`absolute inset-0 bg-gradient-to-br ${accent} opacity-60 pointer-events-none`}
        aria-hidden="true"
      />

      <div className="relative space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="w-11 h-11 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-brand-600 dark:text-brand-400 shadow-sm">
            {Ico ? <Ico size={22} /> : null}
          </div>
          <div className="flex items-center gap-2">
            {/* Private badge — only visible to admins for hidden tools */}
            {isPrivate && (
              <span className="chip bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 text-xs font-medium">
                <Icon.Lock size={11} />
                Private
              </span>
            )}
            <span className={`chip ${badgeTone} font-medium`}>{badge}</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {title}
          </h3>
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
            {tagline}
          </p>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          {description}
        </p>

        <div className="flex items-center gap-1.5 text-sm font-medium text-brand-700 dark:text-brand-300 group-hover:gap-2.5 transition-all">
          Open tool <Icon.ArrowRight size={14} />
        </div>
      </div>
    </Link>
  );
}
