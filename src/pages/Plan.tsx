import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { addDays, formatINR, todayIso } from '../lib/geo';
import { useAuth } from '../lib/auth';
import type { Destination, Plan as PlanType } from '../lib/types';
import { INTERESTS, INTEREST_LABELS, PACE_OPTIONS, TRANSPORT_OPTIONS, groupByDay, itemType } from '../lib/trip';
import DestinationPicker from '../components/DestinationPicker';
import MapView from '../components/MapView';
import { Alert, Chip, Loading } from '../components/UI';

interface FormState {
  destinationId: number | '';
  origin: string;
  startDate: string;
  endDate: string;
  travellers: number;
  budget: number;
  transport: string;
  interests: string[];
  pace: string;
}

export default function Plan() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, preferences } = useAuth();
  const [form, setForm] = useState<FormState>({
    destinationId: '',
    origin: '',
    startDate: todayIso(),
    endDate: addDays(todayIso(), 2),
    travellers: 2,
    budget: 25000,
    transport: 'car',
    interests: [],
    pace: 'balanced',
  });
  const [plan, setPlan] = useState<PlanType | null>(null);
  const [destinationList, setDestinationList] = useState<Destination[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<{ mode: string; label: string } | null>(null);

  useEffect(() => {
    api<{ destinations: Destination[] }>('/destinations?limit=60')
      .then((data) => setDestinationList(data.destinations))
      .catch(() => undefined);
    api<{ mode: string; label: string }>('/ai/status')
      .then(setAiStatus)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const slug = params.get('destination');
    const days = Number(params.get('days') ?? 0);
    if (slug && destinationList.length) {
      const found = destinationList.find((d) => d.slug === slug);
      if (found) {
        setForm((prev) => ({
          ...prev,
          destinationId: found.id,
          budget: Math.max(prev.budget, found.avg_daily_budget * Math.max(2, days || found.ideal_days)),
        }));
      }
    }
    if (days > 0) {
      setForm((prev) => ({ ...prev, endDate: addDays(prev.startDate, Math.max(0, days - 1)) }));
    }
    const interestParam = params.get('interests');
    if (interestParam) {
      const selected = interestParam
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter((value) => INTERESTS.includes(value));
      if (selected.length) setForm((prev) => ({ ...prev, interests: selected }));
    }
  }, [params, destinationList]);

  useEffect(() => {
    if (!preferences) return;
    setForm((prev) => ({
      ...prev,
      interests: prev.interests.length ? prev.interests : preferences.interests ?? [],
      transport: preferences.transport ?? prev.transport,
      pace: preferences.pace ?? prev.pace,
      budget:
        preferences.budget_level === 'budget' ? 15000 : preferences.budget_level === 'luxury' ? 70000 : prev.budget,
    }));
  }, [preferences]);

  const destination = useMemo(
    () => destinationList.find((d) => d.id === Number(form.destinationId)) ?? null,
    [destinationList, form.destinationId],
  );

  const days = useMemo(() => {
    const diff = (Date.parse(form.endDate) - Date.parse(form.startDate)) / 86_400_000;
    return Number.isFinite(diff) ? Math.max(1, Math.round(diff) + 1) : 1;
  }, [form.startDate, form.endDate]);

  const grouped = useMemo(() => (plan ? groupByDay(plan.items) : []), [plan]);

  function toggleInterest(interest: string) {
    setForm((prev) => ({
      ...prev,
      interests: prev.interests.includes(interest)
        ? prev.interests.filter((i) => i !== interest)
        : [...prev.interests, interest],
    }));
  }

  async function generate() {
    if (!form.destinationId) {
      setError('Choose a destination to plan around.');
      return;
    }
    setBusy(true);
    setError(null);
    setPlan(null);
    try {
      const response = await api<{ plan: PlanType; destination: Destination }>('/trips/generate', {
        method: 'POST',
        body: form,
      });
      setPlan(response.plan);
      window.setTimeout(() => document.getElementById('plan-result')?.scrollIntoView({ behavior: 'smooth' }), 80);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate a plan');
    } finally {
      setBusy(false);
    }
  }

  async function saveTrip() {
    if (!plan) return;
    if (!user) {
      navigate(`/login?next=${encodeURIComponent('/plan')}`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await api<{ trip: { id: number } }>('/trips', {
        method: 'POST',
        body: {
          ...form,
          title: plan.title,
          summary: plan.summary,
          mode: plan.mode,
          items: plan.items,
        },
      });
      navigate(`/trips/${response.trip.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the trip');
    } finally {
      setSaving(false);
    }
  }

  const overBudget = plan ? plan.totalCost > form.budget : false;

  return (
    <div className="wrap">
      <header className="page-head">
        <span className="eyebrow">AI trip planner</span>
        <h1>Tell us the shape of the trip.</h1>
        <p>
          Dates, travellers, budget and interests go in; a day-by-day plan comes out, with morning, afternoon and evening
          stops, travel time, meals and a stay recommendation.
        </p>
      </header>

      <div className="split">
        <div>
          <div className="panel">
            <div className="row-between" style={{ marginBottom: 18 }}>
              <h2 style={{ fontSize: 25 }}>Trip brief</h2>
              <span className="tag tag-sage">{aiStatus ? aiStatus.mode === 'openai' ? 'Live AI' : 'Smart engine' : 'AI ready'}</span>
            </div>

            <div className="form-grid">
              <DestinationPicker
                value={form.destinationId}
                onChange={(id) => setForm((prev) => ({ ...prev, destinationId: id }))}
              />
              <div className="field">
                <label>Starting from</label>
                <input
                  value={form.origin}
                  placeholder="Bengaluru"
                  onChange={(event) => setForm((prev) => ({ ...prev, origin: event.target.value }))}
                />
              </div>
              <div className="field">
                <label>Start date</label>
                <input
                  type="date"
                  value={form.startDate}
                  min={todayIso()}
                  onChange={(event) => {
                    const startDate = event.target.value;
                    setForm((prev) => ({
                      ...prev,
                      startDate,
                      endDate: prev.endDate <= startDate ? addDays(startDate, 2) : prev.endDate,
                    }));
                  }}
                />
              </div>
              <div className="field">
                <label>End date</label>
                <input
                  type="date"
                  value={form.endDate}
                  min={form.startDate}
                  onChange={(event) => setForm((prev) => ({ ...prev, endDate: event.target.value }))}
                />
              </div>
              <div className="field">
                <label>Travellers</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={form.travellers}
                  onChange={(event) => setForm((prev) => ({ ...prev, travellers: Number(event.target.value) || 1 }))}
                />
              </div>
              <div className="field">
                <label>Total budget (₹)</label>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={form.budget}
                  onChange={(event) => setForm((prev) => ({ ...prev, budget: Number(event.target.value) || 0 }))}
                />
                <span className="hint">
                  {destination ? `Typical spend here is about ${formatINR(destination.avg_daily_budget)} per day.` : 'Includes stay, food and local travel.'}
                </span>
              </div>
              <div className="field">
                <label>Transport</label>
                <select
                  value={form.transport}
                  onChange={(event) => setForm((prev) => ({ ...prev, transport: event.target.value }))}
                >
                  {TRANSPORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Pace</label>
                <select value={form.pace} onChange={(event) => setForm((prev) => ({ ...prev, pace: event.target.value }))}>
                  {PACE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="span-2">
                <label className="field" style={{ gap: 8 }}>
                  <span style={{ fontSize: 9.5, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>
                    Interests
                  </span>
                </label>
                <div className="chip-row">
                  {INTERESTS.map((interest) => (
                    <Chip key={interest} active={form.interests.includes(interest)} onClick={() => toggleInterest(interest)}>
                      {INTEREST_LABELS[interest] ?? interest}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>

            {error && <div style={{ marginTop: 16 }}><Alert tone="error">{error}</Alert></div>}

            <div className="row row-wrap" style={{ marginTop: 20 }}>
              <button type="button" className="btn" onClick={generate} disabled={busy}>
                {busy ? 'Building your days…' : plan ? 'Regenerate plan' : 'Generate itinerary'}
              </button>
              <span className="muted" style={{ fontSize: 11.5 }}>
                {days} day{days > 1 ? 's' : ''} · {form.travellers} traveller{form.travellers > 1 ? 's' : ''}
              </span>
            </div>

            {aiStatus && (
              <p className="form-note" style={{ marginTop: 12 }}>
                {aiStatus.label}. Itineraries use our destination inventory; times and costs are estimates.
              </p>
            )}
          </div>

          {busy && (
            <div className="panel" style={{ marginTop: 18 }}>
              <Loading label="Matching attractions, meals and travel time" />
              <div className="skeleton" style={{ minHeight: 120 }} />
            </div>
          )}

          {plan && (
            <section id="plan-result" style={{ marginTop: 22 }}>
              <div className="panel" style={{ marginBottom: 18 }}>
                <div className="row-between" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <span className="eyebrow">{plan.mode === 'openai' ? 'Generated with live AI' : 'Built-in travel engine'}</span>
                    <h2 style={{ fontSize: 30, margin: '8px 0 8px' }}>{plan.title}</h2>
                    <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.7, maxWidth: 620 }}>{plan.summary}</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="big-total" style={{ fontSize: 34 }}>{formatINR(plan.totalCost)}</div>
                    <div className="muted" style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase' }}>Estimated total</div>
                  </div>
                </div>
                <div className="row row-wrap" style={{ marginTop: 18 }}>
                  <button type="button" className="btn btn-accent btn-sm" onClick={saveTrip} disabled={saving}>
                    {saving ? 'Saving…' : user ? 'Save this trip' : 'Sign in to save'}
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={generate} disabled={busy}>
                    Try another version
                  </button>
                  <Link to="/budget" className="btn btn-sm btn-ghost">
                    Check the budget
                  </Link>
                  {destination && (
                    <Link to={`/nearby?destination=${destination.slug}`} className="btn btn-sm btn-ghost">
                      Nearby stays &amp; tables
                    </Link>
                  )}
                  {overBudget && <span className="tag tag-clay">Above your stated budget</span>}
                </div>
              </div>

              <div className="split">
                <div>
                  {grouped.map((group) => (
                    <div className="day-block" key={group.day}>
                      <div className="day-head">
                        <h3>Day {group.day}</h3>
                        <span className="muted" style={{ fontSize: 11 }}>
                          {group.items.length} stops
                        </span>
                      </div>
                      {group.items.map((item, index) => (
                        <div className="item-row" key={`${group.day}-${index}-${item.title}`}>
                          <div className="item-time">{item.time}</div>
                          <div className={`item-dot ${itemType(item)}`} />
                          <div>
                            <div className="item-title">
                              {item.title}
                              <span className="slot-label">{item.slot}</span>
                            </div>
                            {item.notes && <div className="item-notes">{item.notes}</div>}
                          </div>
                          <div style={{ fontSize: 12, textAlign: 'right' }}>
                            {item.cost > 0 ? formatINR(item.cost) : '—'}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="side">
                  <MapView
                    markers={plan.items
                      .filter((item) => typeof item.lat === 'number' && typeof item.lng === 'number')
                      .map((item) => ({
                        lat: Number(item.lat),
                        lng: Number(item.lng),
                        title: item.title,
                        subtitle: `Day ${item.day} · ${item.time}`,
                        kind: itemType(item) as 'attraction' | 'hotel' | 'restaurant',
                      }))}
                    path={plan.items
                      .filter((item) => typeof item.lat === 'number' && typeof item.lng === 'number')
                      .map((item) => ({ lat: Number(item.lat), lng: Number(item.lng) }))}
                    height={420}
                  />
                  <div className="panel">
                    <span className="eyebrow">Budget check</span>
                    <div className="row-between" style={{ marginTop: 10, fontSize: 12.5 }}>
                      <span>Your budget</span>
                      <strong>{formatINR(form.budget)}</strong>
                    </div>
                    <div className="bar" style={{ margin: '10px 0' }}>
                      <i
                        style={{
                          width: `${Math.min(100, form.budget ? (plan.totalCost / form.budget) * 100 : 0)}%`,
                          background: overBudget ? 'var(--clay)' : 'var(--sage)',
                        }}
                      />
                    </div>
                    <div className="row-between" style={{ fontSize: 12.5 }}>
                      <span>Estimated cost</span>
                      <strong>{formatINR(plan.totalCost)}</strong>
                    </div>
                    <div className="row-between" style={{ fontSize: 12.5, marginTop: 6 }}>
                      <span>Per person</span>
                      <strong>{formatINR(plan.totalCost / form.travellers)}</strong>
                    </div>
                  </div>
                  <div className="notice">
                    Costs exclude travel to the destination unless shown as a transport stop. Opening hours and road
                    conditions can change a day; confirm before you set out.
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>

        <div className="side">
          <div className="panel sticky">
            <span className="eyebrow">How the planner works</span>
            <div className="col" style={{ gap: 14, marginTop: 14 }}>
              {[
                ['Destination inventory', 'Attractions, restaurants and stays are scored against your interests and the season.'],
                ['Real geography', 'Each stop is ordered by road distance, and travel time is added to the day.'],
                ['Your pace', 'Slow trips get one anchor a day; packed trips get three.'],
                ['Budget aware', 'Hotel and meal choices follow the budget you set.'],
              ].map(([title, copy]) => (
                <div key={title}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{title}</div>
                  <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>{copy}</div>
                </div>
              ))}
            </div>
            <div className="divider-label">After saving</div>
            <p className="form-note">
              Edit any stop, move it to another day, add a hotel or restaurant, then share the whole trip with a link.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
