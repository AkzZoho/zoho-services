/**
 * Toast — lightweight notification system.
 *
 * Usage:
 *   const { showToast } = useToast();
 *   showToast('Redirecting to home…', 'warn');
 *
 * Tones: 'info' | 'success' | 'warn' | 'error'
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import Icon from './Icons.jsx';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToastContext = createContext({ showToast: () => {} });

let _uid = 0;
const uid = () => ++_uid;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  /**
   * showToast(message, tone?, duration?)
   * @param {string} message
   * @param {'info'|'success'|'warn'|'error'} [tone='info']
   * @param {number} [duration=3500] ms
   */
  const showToast = useCallback((message, tone = 'info', duration = 3500) => {
    const id = uid();
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Portal-like fixed overlay */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 pointer-events-none"
      >
        {toasts.map((t) => (
          <ToastItem
            key={t.id}
            message={t.message}
            tone={t.tone}
            onDismiss={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Individual toast
// ---------------------------------------------------------------------------

const TONE_STYLES = {
  info: 'bg-slate-800 text-white dark:bg-slate-700',
  success: 'bg-emerald-700 text-white dark:bg-emerald-600',
  warn: 'bg-amber-600 text-white dark:bg-amber-500',
  error: 'bg-red-700 text-white dark:bg-red-600',
};

const TONE_ICON = {
  info: null,
  success: Icon.Check,
  warn: Icon.Warning,
  error: Icon.X,
};

function ToastItem({ message, tone, onDismiss }) {
  const mounted = useRef(false);
  const [visible, setVisible] = useState(false);

  // Animate in on mount
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      // tiny delay so CSS transition fires
      const t = setTimeout(() => setVisible(true), 10);
      return () => clearTimeout(t);
    }
  }, []);

  const Ico = TONE_ICON[tone];

  return (
    <div
      role="status"
      className={[
        'pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg',
        'text-sm font-medium max-w-sm',
        'transition-all duration-300',
        TONE_STYLES[tone] ?? TONE_STYLES.info,
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
      ].join(' ')}
    >
      {Ico && <Ico size={16} className="shrink-0" />}
      <span className="flex-1">{message}</span>
      <button
        onClick={onDismiss}
        className="shrink-0 opacity-70 hover:opacity-100 transition"
        aria-label="Dismiss"
      >
        <Icon.X size={14} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useToast() {
  return useContext(ToastContext);
}
