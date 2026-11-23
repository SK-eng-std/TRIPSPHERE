import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate, todayIso } from '../lib/geo';
import { useAuth } from '../lib/auth';
import type { Badge, Destination, PassportEntry } from '../lib/types';
import AuthGuard from '../components/AuthGuard';
import DestinationPicker from '../components/DestinationPicker';
import { Alert, Empty, Loading, Stat } from '../components/UI';

interface PassportPayload {
  entries: PassportEntry[];
  stats: { destinations: number; entries: number; unesco: number; hidden: number; trips: number; photos: number; stamps: number };
  badges: Badge[];
}

export default function Passport() {
  const { user } = useAuth();
  const [data, setData] = useState<PassportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState<number | ''>('');
  const [visitedOn, setVisitedOn] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [rating, setRating] = useState(5);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const payload = await api<PassportPayload>('/passport');
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your passport');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    void load();
  }, [user]);

  async function addStamp() {
    if (!destinationId) {
      setError('Choose the destination you visited.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api('/passport', {
        method: 'POST',
        body: { destinationId, visitedOn, notes, rating },
      });
      setNotes('');
      setDestinationId('');
      setNotice('Passport stamp added.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the stamp');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="wrap"><Loading label="Opening your passport" /></div>;

  return (
    <AuthGuard title="Your travel passport is waiting">
      <div className="wrap">
        <header className="page-head">
          <span className="eyebrow">Digital travel passport</span>
          <h1>Stamps, not souvenirs.</h1>
          <p>
            A record of every destination, monument and hidden corner you have reached. Add a stamp after each trip and
            watch the badges accumulate.
          </p>
        </header>

        {notice && <div style={{ marginBottom: 16 }}><Alert tone="ok">{notice}</Alert></div>}
        {error && <div style={{ marginBottom: 16 }}><Alert tone="error">{error}</Alert></div>}

        <div className="passport-cover">
          <div className="row-between row-wrap" style={{ alignItems: 'flex-start', gap: 20 }}>
            <div>
              <span className="eyebrow gold" style={{ color: 'var(--gold)' }}>Republic of everywhere</span>
              <h2 style={{ marginTop: 10 }}>Travel Passport</h2>
              <p style={{ color: 'rgba(247,241,230,.65)', fontSize: 12, marginTop: 6, letterSpacing: '.14em', textTransform: 'uppercase' }}>
                {user?.name} · issued by TRIPSPHERE
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'var(--serif)', fontSize: 46, lineHeight: 1 }}>{data?.stats.stamps ?? 0}</div>
              <div style={{ fontSize: 9.5, letterSpacing: '.18em', textTransform: 'uppercase', color: 'rgba(247,241,230,.55)' }}>Stamps collected</div>
            </div>
          </div>
          <div className="row row-wrap" style={{ gap: 26, marginTop: 26 }}>
            {[
              ['Destinations', data?.stats.destinations ?? 0],
              ['UNESCO sites', data?.stats.unesco ?? 0],
              ['Hidden gems', data?.stats.hidden ?? 0],
              ['Trips planned', data?.stats.trips ?? 0],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <div style={{ fontFamily: 'var(--serif)', fontSize: 24 }}>{value}</div>
                <div style={{ fontSize: 9, letterSpacing: '.16em', textTransform: 'uppercase', color: 'rgba(247,241,230,.55)' }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="stat-grid" style={{ marginTop: 20 }}>
          <Stat label="Total entries" value={data?.stats.entries ?? 0} />
          <Stat label="Badges earned" value={data?.badges.filter((badge) => badge.earned).length ?? 0} />
          <Stat label="Photos kept" value={data?.stats.photos ?? 0} />
          <Stat label="Trips shared" value={data?.stats.trips ?? 0} />
        </div>

        <div className="split" style={{ marginTop: 30 }}>
          <div>
            <div className="row-between" style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 28 }}>Your stamps</h2>
              <Link to="/history" className="link" style={{ fontSize: 12 }}>See full timeline →</Link>
            </div>
            {(data?.entries ?? []).length === 0 ? (
              <Empty title="The first page is blank">
                Add the last place you travelled to and the passport begins.
              </Empty>
            ) : (
              <div className="stamp-grid">
                {(data?.entries ?? []).map((entry) => (
                  <div className="stamp" key={entry.id}>
                    <div>
                      <small>{entry.state}</small>
                      <b style={{ display: 'block', marginTop: 4 }}>{entry.destination_name}</b>
                    </div>
                    <div className="row-between" style={{ marginTop: 8 }}>
                      <small>{formatDate(entry.visited_on, { day: 'numeric', month: 'short', year: 'numeric' })}</small>
                      <button
                        type="button"
                        className="link"
                        style={{ background: 'none', border: 0, fontSize: 10 }}
                        onClick={async () => {
                          await api(`/passport/${entry.id}`, { method: 'DELETE' });
                          await load();
                        }}
                      >
                        remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <h2 style={{ fontSize: 28, margin: '34px 0 16px' }}>Badges</h2>
            <div className="grid grid-2">
              {(data?.badges ?? []).map((badge) => (
                <div
                  className="panel panel-tight"
                  key={badge.id}
                  style={{ opacity: badge.earned ? 1 : 0.62, borderColor: badge.earned ? 'var(--gold)' : 'var(--line)' }}
                >
                  <div className="row-between">
                    <span className="eyebrow">{badge.earned ? 'Earned' : 'In progress'}</span>
                    <span className="tag">{badge.progress}%</span>
                  </div>
                  <div style={{ fontFamily: 'var(--serif)', fontSize: 19, margin: '6px 0 4px' }}>{badge.label}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>{badge.description}</div>
                  <div className="bar" style={{ marginTop: 10 }}>
                    <i style={{ width: `${badge.progress}%`, background: badge.earned ? 'var(--gold)' : 'var(--clay)' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="side">
            <div className="panel sticky">
              <span className="eyebrow">Add a stamp</span>
              <h3 style={{ fontSize: 22, margin: '8px 0 14px' }}>Where did you go?</h3>
              <DestinationPicker value={destinationId} onChange={setDestinationId} label="Destination visited" />
              <div className="form-grid" style={{ marginTop: 12, gap: 10 }}>
                <div className="field">
                  <label>Date</label>
                  <input type="date" value={visitedOn} max={todayIso()} onChange={(event) => setVisitedOn(event.target.value)} />
                </div>
                <div className="field">
                  <label>Rating</label>
                  <select value={rating} onChange={(event) => setRating(Number(event.target.value))}>
                    {[5, 4, 3, 2, 1].map((value) => (
                      <option key={value} value={value}>{value} ★</option>
                    ))}
                  </select>
                </div>
                <div className="field span-2">
                  <label>A memory to keep</label>
                  <textarea rows={3} value={notes} placeholder="What stayed with you?" onChange={(event) => setNotes(event.target.value)} />
                </div>
              </div>
              <button type="button" className="btn btn-block" style={{ marginTop: 14 }} onClick={addStamp} disabled={saving}>
                {saving ? 'Stamping…' : 'Add passport stamp'}
              </button>
              <p className="form-note" style={{ marginTop: 10 }}>
                Stamps feed your Travel DNA: interests from visited destinations shape future recommendations.
              </p>
            </div>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
