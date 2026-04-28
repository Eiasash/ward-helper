/**
 * Fixed-top glanceable header strip — 44px tall, RTL-aware.
 *
 * Surfaces the four signals a doctor checks mid-round:
 *   - Online / offline (network status icon)
 *   - Battery (level + charging state)
 *   - Last sync (relative timestamp)
 *   - Current patient name (truncated)
 *
 * Light/dark theme aware via CSS custom properties. No PHI beyond the
 * name string the user is already operating on. Strict 44px height so
 * `main.shell` padding-top compensates without layout shift.
 */
import {
  useBattery,
  useOnline,
  useLastSync,
  useCurrentPatientName,
  useActiveNoteType,
  usePendingSyncCount,
  formatBatteryPct,
  formatRelative,
} from '../hooks/useGlanceable';
import { colorForNoteType } from '@/notes/noteTypeColors';
import type { NoteType } from '@/storage/indexed';

const KNOWN_NOTE_TYPES: readonly NoteType[] = [
  'admission', 'discharge', 'consult', 'case', 'soap', 'census',
];

function isNoteType(s: string | null): s is NoteType {
  return !!s && (KNOWN_NOTE_TYPES as readonly string[]).includes(s);
}

const NAME_MAX_CHARS = 18;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

export function HeaderStrip() {
  const online = useOnline();
  const battery = useBattery();
  const lastSync = useLastSync();
  const patientName = useCurrentPatientName();
  const activeNoteType = useActiveNoteType();
  const pendingSync = usePendingSyncCount();
  const tone = isNoteType(activeNoteType) ? colorForNoteType(activeNoteType) : null;

  const batteryLow = battery.level !== null && battery.level < 0.2 && !battery.charging;

  return (
    <header
      className="header-strip"
      role="status"
      aria-label="מצב מערכת"
      // Inline `dir` keeps the strip RTL even if a parent flips it. Hebrew
      // microcopy reads right-to-left; icon glyphs are direction-neutral.
      dir="rtl"
    >
      <div className="header-strip-section header-strip-status">
        <span
          className={online ? 'header-strip-pill online' : 'header-strip-pill offline'}
          title={online ? 'מקוון' : 'לא מקוון'}
          aria-label={online ? 'מקוון' : 'לא מקוון'}
        >
          {online ? '●' : '○'}
        </span>
        <span
          className={batteryLow ? 'header-strip-pill battery low' : 'header-strip-pill battery'}
          title={`סוללה: ${formatBatteryPct(battery.level)}${battery.charging ? ' (טעינה)' : ''}`}
          aria-label={`סוללה ${formatBatteryPct(battery.level)}`}
        >
          {battery.charging ? '⚡' : '🔋'} {formatBatteryPct(battery.level)}
        </span>
      </div>

      <div className="header-strip-section header-strip-patient">
        {tone && (
          <span
            className="header-strip-type-badge"
            style={{ background: tone.soft, color: tone.fg, border: `1px solid ${tone.color}` }}
            aria-label={`סוג רשומה: ${activeNoteType}`}
          >
            {tone.badge}
          </span>
        )}
        {patientName ? (
          <span className="header-strip-name" title={patientName} dir="auto">
            {truncate(patientName, NAME_MAX_CHARS)}
          </span>
        ) : (
          <span className="header-strip-name muted">בלי מטופל פעיל</span>
        )}
      </div>

      <div className="header-strip-section header-strip-sync">
        {pendingSync > 0 && (
          <span
            className="header-strip-pill queue"
            title={`${pendingSync} רשומות לא הועתקו לצ׳מיליון`}
            aria-label={`${pendingSync} ממתינות`}
          >
            ⌛ {pendingSync}
          </span>
        )}
        <span
          className="header-strip-pill sync"
          title={
            lastSync
              ? `סינכרון אחרון: ${new Date(lastSync).toLocaleString('he-IL')}`
              : 'לא היה סינכרון'
          }
          aria-label="זמן סינכרון אחרון"
        >
          ☁ {formatRelative(lastSync)}
        </span>
      </div>
    </header>
  );
}
