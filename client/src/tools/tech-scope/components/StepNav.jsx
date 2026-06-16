import Icon from '../../../components/Icons.jsx';
import { STEPS } from '../lib/scope.js';

/**
 * StepNav — vertical-on-mobile / horizontal-on-desktop progress indicator.
 * Allows jumping back to any prior step; future steps are reachable only by
 * clicking "Next" so users see the cumulative drafts in order.
 */
export default function StepNav({ currentStepId, completed, onJump }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {STEPS.map((s, idx) => {
        const isCurrent = s.id === currentStepId;
        const isDone = completed[s.id];
        const isReachable = isDone || isCurrent || (idx > 0 && completed[STEPS[idx - 1].id]);

        return (
          <li key={s.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => isReachable && onJump(s.id)}
              disabled={!isReachable}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs transition
                ${isCurrent
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300 dark:border-brand-700 font-semibold'
                  : isDone
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800'
                  : 'border-slate-200 bg-white text-slate-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-400'}
                ${!isReachable ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-sm'}`}
              title={`${s.title} — ${s.subtitle}`}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                ${isCurrent ? 'bg-brand-600 text-white' : isDone ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                {isDone && !isCurrent ? <Icon.Check size={10} /> : s.n}
              </span>
              <span className="hidden sm:inline">{s.title}</span>
            </button>
            {idx < STEPS.length - 1 && (
              <span className="text-slate-300 dark:text-slate-600">›</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
