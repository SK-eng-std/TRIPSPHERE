import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useGeo, formatINR } from '../lib/geo';
import type { MiniPlan } from '../lib/types';
import MapView from './MapView';
import { INTEREST_LABELS } from '../lib/trip';
import { Chip, Loading } from './UI';

export default function TimeExplorer({ destinationId }: { destinationId?: number }) {
  const geo = useGeo();
  const [hours, setHours] = useState(3);
  const [interests, setInterests] = useState<string[]>([]);
  const [plan, setPlan] = useState<MiniPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<MiniPlan>('/ai/mini-plan', {
        method: 'POST',
        body: {
          hours,
          interests,
          lat: geo.lat ?? undefined,
          lng: geo.lng ?? undefined,
          destinationId,
        },
      });
      setPlan(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build a mini plan');
    } finally {
      setBusy(false);
    }
  }

  const toggleInterest = (interest: string) =>
    setInterests((prev) => (prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]));

  return (
    <div className="panel">
      <div className="row-between" style={{ marginBottom: 14 }}>
        <div>
          <span className="eyebrow">Time-based exploration</span>
          <h3 style={{ fontSize: 25, marginTop: 6 }}>I only have a few hours</h3>
        </div>
      </div>
      <p className="form-note" style={{ marginBottom: 16 }}>
        Tell us your window and we will build a realistic route from your current location, using travel time, opening
        hours and distance.
      </p>

      <div className="chip-row" style={{ marginBottom: 12 }}>
        {[1, 2, 3, 6].map((value) => (
          <Chip key={value} active={hours === value} onClick={() => setHours(value)}>
            {value} hour{value > 1 ? 's' : ''}
          </Chip>
        ))}
      </div>

      <div className="chip-row" style={{ marginBottom: 16 }}>
        {['heritage', 'nature', 'adventure', 'food', 'beach', 'photography'].map((interest) => (
          <Chip key={interest} active={interests.includes(interest)} onClick={() => toggleInterest(interest)}>
            {INTEREST_LABELS[interest] ?? interest}
          </Chip>
        ))}
      </div>

      <div className="row row-wrap" style={{ marginBottom: 12 }}>
        <button type="button" className="btn btn-sm" onClick={generate} disabled={busy}>
          {busy ? <span className="spinner light" /> : 'Build my mini plan'}
        </button>
        {geo.status !== 'ready' && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={geo.request}>
            Use my location
          </button>
        )}
        {geo.status === 'ready' && (
          <span className="tag tag-sage">Location ready · place-based estimates</span>
        )}
      </div>

      {geo.error && <div className="alert alert-info" style={{ marginBottom: 12 }}>{geo.error}</div>}
      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
      {busy && <Loading label="Building a route around your time" />}

      {plan && !busy && (
        <>
          {plan.stops.length === 0 ? (
            <div className="empty" style={{ padding: 22 }}>
              {plan.note}
            </div>
          ) : (
            <>
              <div className="timeline" style={{ marginTop: 18 }}>
                {plan.stops.map((stop) => (
                  <div className="tl-item" key={`${stop.type}-${stop.id}`}>
                    <div className="tl-date">
                      {stop.arriveAt} – {stop.leaveAt} · {stop.distanceKm} km
                    </div>
                    <div style={{ fontWeight: 600, marginTop: 2 }}>{stop.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{stop.summary}</div>
                    <div style={{ marginTop: 4, fontSize: 11 }}>
                      {stop.type === 'restaurant' ? (
                        <span className="tag tag-gold">Meal stop</span>
                      ) : (
                        <span className="tag">{stop.entryFee > 0 ? `${formatINR(stop.entryFee)} entry` : 'Free entry'}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <MapView
                markers={plan.stops.map((stop) => ({
                  lat: stop.lat,
                  lng: stop.lng,
                  title: stop.name,
                  subtitle: `${stop.arriveAt} – ${stop.leaveAt}`,
                  kind: stop.type === 'restaurant' ? 'restaurant' : 'stop',
                }))}
                path={plan.stops}
                height={220}
              />
              <p className="form-note" style={{ marginTop: 10 }}>
                {plan.note} Total distance about {plan.totalKm} km.
              </p>
            </>
          )}
          <Link to="/plan" className="btn btn-sm btn-ghost" style={{ marginTop: 12 }}>
            Extend this into a full trip
          </Link>
        </>
      )}
    </div>
  );
}
