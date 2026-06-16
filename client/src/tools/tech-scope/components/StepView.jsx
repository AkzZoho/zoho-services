import FormsView from './FormsView.jsx';
import DetailsView from './DetailsView.jsx';

/**
 * StepView — renders a structured, scannable detail view for the active step.
 *
 * Replaces the legacy "raw markdown <pre>" preview with typed, list/table
 * components — one per scope section (forms, reports, pages, workflows,
 * lookups, roles, profiles, blueprints, batch workflows, functions,
 * connections, schedules, public APIs, NFRs, assumptions, out-of-scope).
 *
 * Diagrams are intentionally omitted here:
 *   • Application Flow Diagram — removed per user request.
 *   • ER Diagram — removed in favour of the textual lookup/creation-order
 *     panels rendered by `FormsView`.
 *
 * Markdown is still produced by `template.js` and used for the .md download
 * and the PDF export — only the on-screen preview changed.
 */
export default function StepView({ stepId, scope }) {
  if (stepId === 'step2') {
    return <FormsView scope={scope} />;
  }
  return <DetailsView stepId={stepId} scope={scope} />;
}
