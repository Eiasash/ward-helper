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
  formatBatteryPct,
  formatRelative,
} from '../hooks/useGlanceable';

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
        {patientName ? (
          <span className="header-strip-name" title={patientName} dir="auto">
            {truncate(patientName, NAME_MAX_CHARS)}
          </span>
        ) : (
          <span className="header-strip-name muted">בלי מטופל פעיל</span>
        )}
      </div>

      <div className="header-strip-section header-strip-sync">
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
