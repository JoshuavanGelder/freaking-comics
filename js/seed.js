// Startdata: wat er in plan-en-beslissingen.md staat over je leesstapel.
// Wordt alleen geladen bij de allereerste start (of via Instellingen).
import { addSeries, addVolume, parseIssues, setReadStatus, emptyState } from './model.js';

export function seedState() {
  let state = emptyState();
  const t = (d) => new Date(d).toISOString();

  // --- The Flash (New 52): Vol. 1–5 gelezen, volgende is Vol. 6.
  let r = addSeries(
    state,
    { title: 'The Flash', publisher: 'DC', line: 'New 52', years: '2011–2016', color: 'red' },
    t('2026-09-01T12:00:00Z'),
  );
  state = r.state;
  const flash = r.id;
  const flashVols = [
    'Move Forward',
    'Rogues Revolution',
    'Gorilla Warfare',
    'Reverse',
    'History Lessons',
    'Out of Time',
    'Savage World',
    'Zoom',
    'Full Stop',
  ];
  flashVols.forEach((title, i) => {
    const n = i + 1;
    const res = addVolume(
      state,
      { seriesId: flash, title, number: String(n), position: n, format: 'trade' },
      t(`2026-09-01T12:0${Math.min(i, 9)}:00Z`),
    );
    state = res.state;
    if (n <= 5) state = setReadStatus(state, res.id, 'read', t(`2026-09-${String(10 + n * 3).padStart(2, '0')}T20:00:00Z`));
  });

  // --- Ultimate Comics: Divided We Fall (hardcover) en Ultimate Comics Iron Man.
  r = addSeries(
    state,
    { title: 'Ultimate Comics', publisher: 'Marvel', line: 'Ultimate', years: '2011–2014', color: 'ink' },
    t('2026-09-02T12:00:00Z'),
  );
  state = r.state;
  const ult = r.id;

  let res = addVolume(
    state,
    {
      seriesId: ult,
      title: 'Divided We Fall, United We Stand',
      number: '',
      position: 1,
      format: 'hardcover',
      ownership: 'owned',
      issues: parseIssues(
        'Ultimate Comics Ultimates #13–18\nUltimate Comics X-Men #13–18\nUltimate Comics Spider-Man #13–18',
        'Ultimate Comics',
      ).issues,
      note: 'De drie series staan na elkaar in het boek, niet door elkaar.',
    },
    t('2026-09-02T12:01:00Z'),
  );
  state = setReadStatus(res.state, res.id, 'reading', t('2026-09-20T20:00:00Z'));

  res = addVolume(
    state,
    {
      seriesId: ult,
      title: 'Ultimate Comics Iron Man',
      number: '',
      position: 2,
      format: 'trade',
      note: 'Buiten de volgorde gelezen. Aangenomen: de versie uit 2012–2013 (nog open: of het de versie uit 2005 van Orson Scott Card is).',
    },
    t('2026-09-02T12:02:00Z'),
  );
  state = setReadStatus(res.state, res.id, 'read', t('2026-08-15T20:00:00Z'));
  // Divided We Fall is het boek waar je nu in zit; dat bepaalt de volgorde op Home.
  state = {
    ...state,
    series: state.series.map((s) => (s.id === ult ? { ...s, lastActivityAt: t('2026-09-20T20:00:00Z') } : s)),
  };

  return state;
}
