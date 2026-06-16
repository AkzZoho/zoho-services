/**
 * Custom SVG icon set for the Creator DS Analyser.
 * All icons accept the same props as a standard <svg>, plus `size` (default 20).
 * They inherit colour via `currentColor`, so Tailwind text-* utilities just work
 * — e.g. `<Icon.Upload className="text-brand-600" />`.
 */

function base({ size = 20, className = '', ...rest }) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
    ...rest,
  };
}

/* ---------- Brand / logo ---------- */
export function LogoMark({ size = 28, className = '', ...rest }) {
  // Stylised "DS" inside a rounded square — our own mark, no default emoji.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      {...rest}
    >
      <rect x="1.5" y="1.5" width="29" height="29" rx="7" className="fill-brand-600" />
      <path
        d="M8.5 10.5h4.8c2.7 0 4.7 2 4.7 5.5s-2 5.5-4.7 5.5H8.5v-11Z"
        stroke="white"
        strokeWidth="2"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M23.5 12.2c-.5-1.1-1.7-1.8-3-1.8-1.7 0-3 1-3 2.5 0 3 6.2 1.5 6.2 4.8 0 1.7-1.5 2.9-3.5 2.9-1.7 0-3.1-.8-3.7-2"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/* ---------- UI icons ---------- */
export function Upload(p) {
  return (
    <svg {...base(p)}>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M5 20h14" />
    </svg>
  );
}

export function FileDoc(p) {
  return (
    <svg {...base(p)}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </svg>
  );
}

export function FileCode(p) {
  return (
    <svg {...base(p)}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
      <path d="m10 13-2 2 2 2" />
      <path d="m14 13 2 2-2 2" />
    </svg>
  );
}

export function Analyse(p) {
  return (
    <svg {...base(p)}>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-3.5-3.5" />
      <path d="M8 11h6" />
      <path d="M11 8v6" />
    </svg>
  );
}

export function Plan(p) {
  return (
    <svg {...base(p)}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 9h16" />
      <path d="m8 14 2 2 4-4" />
    </svg>
  );
}

export function PmUser(p) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
      <path d="M16 3.5a2.5 2.5 0 0 1 0 5" />
    </svg>
  );
}

export function DevCode(p) {
  return (
    <svg {...base(p)}>
      <path d="m8 8-4 4 4 4" />
      <path d="m16 8 4 4-4 4" />
      <path d="m14 5-4 14" />
    </svg>
  );
}

export function Sun(p) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2" />
      <path d="M12 19v2" />
      <path d="M5 12H3" />
      <path d="M21 12h-2" />
      <path d="m6 6-1.5-1.5" />
      <path d="m19.5 19.5-1.5-1.5" />
      <path d="m6 18-1.5 1.5" />
      <path d="m19.5 4.5-1.5 1.5" />
    </svg>
  );
}

export function Moon(p) {
  return (
    <svg {...base(p)}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </svg>
  );
}

export function Plus(p) {
  return (
    <svg {...base(p)}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function Edit(p) {
  return (
    <svg {...base(p)}>
      <path d="M4 20h4l10-10-4-4L4 16v4Z" />
      <path d="m14 6 4 4" />
    </svg>
  );
}

export function Trash(p) {
  return (
    <svg {...base(p)}>
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}

export function Save(p) {
  return (
    <svg {...base(p)}>
      <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" />
      <path d="M7 4v5h9V4" />
      <path d="M7 14h10v7H7z" />
    </svg>
  );
}

export function Warning(p) {
  return (
    <svg {...base(p)}>
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 10v5" />
      <circle cx="12" cy="18" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function Check(p) {
  return (
    <svg {...base(p)}>
      <path d="m5 12 4 4 10-10" />
    </svg>
  );
}

export function Help(p) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 1-1 1.7V14" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function Folder(p) {
  return (
    <svg {...base(p)}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

export function Download(p) {
  return (
    <svg {...base(p)}>
      <path d="M12 4v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

export function X(p) {
  return (
    <svg {...base(p)}>
      <path d="m6 6 12 12" />
      <path d="m6 18 12-12" />
    </svg>
  );
}

export function Code(p) {
  return (
    <svg {...base(p)}>
      <path d="m8 9-4 3 4 3" />
      <path d="m16 9 4 3-4 3" />
      <path d="m14 6-4 12" />
    </svg>
  );
}

export function Copy(p) {
  return (
    <svg {...base(p)}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

export function Spinner({ size = 20, className = '', ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`animate-spin ${className}`}
      fill="none"
      {...rest}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ---------- Auth / admin ---------- */
export function Lock(p) {
  return (
    <svg {...base(p)}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function ShieldCheck(p) {
  return (
    <svg {...base(p)}>
      <path d="M12 3 4 7v5c0 4.4 3.4 8.5 8 9.5 4.6-1 8-5.1 8-9.5V7l-8-4Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function Eye(p) {
  return (
    <svg {...base(p)}>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOff(p) {
  return (
    <svg {...base(p)}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

export function LogOut(p) {
  return (
    <svg {...base(p)}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

/* ---------- Navigation ---------- */
export function ArrowLeft(p) {
  return (
    <svg {...base(p)}>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

export function ArrowRight(p) {
  return (
    <svg {...base(p)}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

/* Convenience default export — `import Icon from './Icons'; <Icon.Upload />` */
const Icon = {
  LogoMark,
  Upload,
  FileDoc,
  FileCode,
  Analyse,
  Plan,
  PmUser,
  DevCode,
  Sun,
  Moon,
  Plus,
  Edit,
  Trash,
  Save,
  Warning,
  Check,
  Help,
  Folder,
  Download,
  X,
  Code,
  Copy,
  Spinner,
  // Auth / admin
  Lock,
  ShieldCheck,
  Eye,
  EyeOff,
  LogOut,
  // Navigation
  ArrowLeft,
  ArrowRight,
};
export default Icon;
