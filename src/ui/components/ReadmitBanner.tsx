import type React from 'react';

const bannerStyle: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--warn, #f0bc6a)',
  padding: 12,
  margin: '8px 0',
  borderRadius: 8,
};

interface Props {
  name: string;
  gapDays: number;
  onAccept: () => void;
  onDecline: () => void;
}

export function ReadmitBanner({ name, gapDays, onAccept, onDecline }: Props) {
  return (
    <div style={bannerStyle} dir="auto">
      <p>
        TZ זוהה — מטופל {name} שוחרר לפני {gapDays} ימים. לחזרה לאשפוז?
      </p>
      <button onClick={onAccept} style={{ marginInlineEnd: 8 }}>
        כן, חזרה לאשפוז
      </button>
      <button onClick={onDecline}>לא, חולה חדש</button>
    </div>
  );
}
