import type { ContinuityContext } from '@/notes/continuity';

interface Props {
  ctx: ContinuityContext;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

function fmt(ts: number): string {
  return new Date(ts).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

export function ContinuityBanner({ ctx, enabled, onToggle }: Props) {
  if (!ctx.patient) return null;

  const admissionLine = ctx.admission ? `• קבלה מ-${fmt(ctx.admission.createdAt)}` : null;
  const soapLine =
    ctx.priorSoaps.length > 0 && ctx.mostRecentSoap
      ? `• ${ctx.priorSoaps.length} SOAP קודמים (אחרון: ${fmt(ctx.mostRecentSoap.createdAt)})`
      : null;

  // Stale episode or nothing to pull → hide banner entirely
  if (!admissionLine && !soapLine) return null;

  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--accent)',
        padding: 12,
        borderRadius: 8,
        marginBottom: 16,
      }}
    >
      <div style={{ marginBottom: 6 }}>
        ☷ מטופל <strong>{ctx.patient.name}</strong> (ת.ז. {ctx.patient.teudatZehut})
      </div>
      {admissionLine && <div style={{ color: 'var(--muted)', fontSize: 14 }}>{admissionLine}</div>}
      {soapLine && <div style={{ color: 'var(--muted)', fontSize: 14 }}>{soapLine}</div>}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        השתמש כרקע ל-SOAP של היום
      </label>
    </div>
  );
}
