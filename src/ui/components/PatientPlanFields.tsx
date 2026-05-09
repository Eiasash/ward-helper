import { useEffect, useState } from 'react';
import { getPatient, putPatient } from '@/storage/indexed';

interface Props { patientId: string; }

export function PatientPlanFields({ patientId }: Props) {
  const [longTerm, setLongTerm] = useState('');
  const [today, setToday] = useState('');

  useEffect(() => {
    let cancelled = false;
    void getPatient(patientId).then(p => {
      if (cancelled) return;
      setLongTerm(p?.planLongTerm ?? '');
      setToday(p?.planToday ?? '');
    });
    return () => { cancelled = true; };
  }, [patientId]);

  async function save(field: 'planLongTerm' | 'planToday', value: string) {
    const p = await getPatient(patientId);
    if (!p) return;
    await putPatient({ ...p, [field]: value, updatedAt: Date.now() });
  }

  return (
    <div className="patient-plan-fields" dir="auto" style={{ marginTop: 8 }}>
      <label style={{ display: 'block', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>תכנית ארוכת-טווח</span>
        <textarea
          value={longTerm}
          onChange={e => setLongTerm(e.target.value)}
          onBlur={() => void save('planLongTerm', longTerm)}
          rows={3}
          style={{ width: '100%', marginTop: 4 }}
        />
      </label>
      <label style={{ display: 'block' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>תכנית להיום</span>
        <textarea
          value={today}
          onChange={e => setToday(e.target.value)}
          onBlur={() => void save('planToday', today)}
          rows={3}
          style={{ width: '100%', marginTop: 4 }}
        />
      </label>
    </div>
  );
}
