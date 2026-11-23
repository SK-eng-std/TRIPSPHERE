import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { dateRange, formatINR } from '../lib/geo';
import { useAuth } from '../lib/auth';
import type { Place, Trip } from '../lib/types';
import { groupByDay, itemDuration, itemType, tripDays } from '../lib/trip';
import MapView from '../components/MapView';
import { Alert, Chip, Empty, Loading } from '../components/UI';

interface BudgetPayload {
  estimate: {
    total: number;
    perPerson: number;
    daily: number;
    nights: number;
    breakdown: { key: string; label: string; amount: number; note: string }[];
  } | null;
  bookedBudget: number;
  itineraryCost: number;
}

export default function TripDetail({ shared = false }: { shared?: boolean }) {
  const { id = '', token = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [budget, setBudget] = useState<BudgetPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'itinerary' | 'map' | 'add'>('itinerary');
  const [addType, setAddType] = useState<'attraction' | 'restaurant' | 'hotel'>('attraction');
  const [addQuery, setAddQuery] = useState('');
  const [addDay, setAddDay] = useState(1);
  const [candidates, setCandidates] = useState<Place[]>([]);
  const [candidatesBusy, setCandidatesBusy] = useState(false);
  const [addBusy, setAddBusy] = useState<number | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ trip: Trip }>(
        shared ? `/trips/share/${token}` : `/trips/${id}`,
      );
      setTrip(data.trip);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open this trip');
    } finally {
      setLoading(false);
    }
  }, [shared, token, id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!trip || shared) return;
    api<BudgetPayload>(`/trips/${trip.id}/budget`)
      .then(setBudget)
      .catch(() => undefined);
  }, [trip, shared]);

  useEffect(() => {
    if (!trip || shared || tab !== 'add') return;
    setCandidatesBusy(true);
    const timer = setTimeout(() => {
      api<{ places: Place[] }>(
        `/places${qs({
          type: addType,
          destination: trip.destination?.slug,
          q: addQuery || undefined,
          limit: 9,
        })}`,
      )
        .then((data) => setCandidates(data.places))
        .catch(() => setCandidates([]))
        .finally(() => setCandidatesBusy(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [trip, shared, tab, addType, addQuery]);

  const grouped = useMemo(() => (trip ? groupByDay(trip.items ?? []) : []), [trip]);
  const days = useMemo(() => (trip ? tripDays(trip.items ?? []) : 1), [trip]);
  const markers = useMemo(
    () =>
      (trip?.items ?? [])
        .filter((item) => typeof item.lat === 'number' && typeof item.lng === 'number')
        .map((item) => ({
          lat: Number(item.lat),
          lng: Number(item.lng),
          title: item.title,
          subtitle: `Day ${item.day} · ${item.time}`,
          kind: itemType(item) as 'attraction' | 'hotel' | 'restaurant',
        })),
    [trip],
  );

  async function mutate(fn: () => Promise<unknown>) {
    try {
      await fn();
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'That change could not be saved');
    }
  }

  async function addPlace(place: Place) {
    if (!trip) return;
    setAddBusy(place.id);
    try {
      await api(`/trips/${trip.id}/items`, {
        method: 'POST',
        body: { placeType: addType, placeId: place.id, day: addDay, slot: 'afternoon', time: '15:00' },
      });
      setNotice(`${place.name} added to day ${addDay}.`);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not add that place');
    } finally {
      setAddBusy(null);
    }
  }

  async function share() {
    if (!trip) return;
    try {
      const response = await api<{ path: string }>(`/trips/${trip.id}/share`, { method: 'POST' });
      const url = `${window.location.origin}${response.path}`;
      setShareLink(url);
      try {
        await navigator.clipboard.writeText(url);
        setNotice('Share link copied to your clipboard.');
      } catch {
        setNotice('Share link ready — copy it below.');
      }
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not create a share link');
    }
  }

  if (loading) return <div className="wrap"><Loading label="Opening your itinerary" /></div>;
  if (error || !trip) {
    return (
      <div className="wrap" style={{ paddingTop: 60 }}>
        <Empty title="This trip is not available">{error ?? 'The link may have expired.'}</Empty>
        <div className="row" style={{ justifyContent: 'center', marginTop: 18 }}>
          <Link to="/trips" className="btn btn-sm btn-ghost">Back to my trips</Link>
          <Link to="/plan" className="btn btn-sm">Plan a new trip</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="breadcrumb" style={{ paddingTop: 22 }}>
        <Link to={shared ? '/' : '/trips'}>{shared ? 'Shared trip' : 'My trips'}</Link>
        <span>/</span>
        <span>{trip.title}</span>
      </div>

      <header className="row-between" style={{ alignItems: 'flex-start', gap: 22, flexWrap: 'wrap', marginBottom: 22 }}>
        <div>
          <div className="row row-wrap" style={{ gap: 8, marginBottom: 10 }}>
            <span className="tag tag-sage">{trip.status}</span>
            <span className="tag">{trip.ai_mode === 'openai' ? 'Live AI plan' : 'Smart engine plan'}</span>
            {shared && <span className="tag tag-gold">Shared by {trip.ownerName ?? 'a traveller'}</span>}
          </div>
          <h1 style={{ fontSize: 'clamp(32px, 5vw, 54px)', fontWeight: 400 }}>{trip.title}</h1>
          <p className="muted" style={{ marginTop: 8, fontSize: 13.5 }}>
            {dateRange(trip.start_date, trip.end_date)} · {trip.travellers} traveller{trip.travellers > 1 ? 's' : ''} ·{' '}
            {trip.destination?.name ?? 'Multi-stop'} · {days} day{days > 1 ? 's' : ''}
          </p>
        </div>
        <div className="row row-wrap">
          {!shared && (
            <>
              <button type="button" className="btn btn-sm" onClick={share}>
                Share trip
              </button>
              <Link to={`/budget?itinerary=${trip.id}`} className="btn btn-sm btn-ghost">
                Budget
              </Link>
              <select
                value={trip.status}
                className="btn btn-sm btn-ghost"
                style={{ paddingRight: 12 }}
                onChange={(event) =>
                  mutate(() =>
                    api(`/trips/${trip.id}`, { method: 'PATCH', body: { status: event.target.value } }),
                  )
                }
              >
                <option value="planned">Planned</option>
                <option value="ongoing">Travelling now</option>
                <option value="completed">Completed</option>
              </select>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={async () => {
                  if (!window.confirm('Delete this trip? This cannot be undone.')) return;
                  try {
                    await api(`/trips/${trip.id}`, { method: 'DELETE' });
                    navigate('/trips');
                  } catch (err) {
                    setNotice(err instanceof Error ? err.message : 'Could not delete the trip');
                  }
                }}
              >
                Delete
              </button>
            </>
          )}
          {shared && (
            <Link to="/plan" className="btn btn-sm">
              Plan your own trip
            </Link>
          )}
        </div>
      </header>

      {shareLink && (
        <div className="alert alert-ok" style={{ marginBottom: 16 }}>
          <div className="row-between" style={{ gap: 10 }}>
            <span style={{ wordBreak: 'break-all' }}>{shareLink}</span>
            <Link to={shareLink.replace(window.location.origin, '')} className="link">
              Open
            </Link>
          </div>
        </div>
      )}
      {notice && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="info">{notice}</Alert>
        </div>
      )}
      {trip.summary && <p className="muted" style={{ maxWidth: 760, marginBottom: 22, fontSize: 13.5, lineHeight: 1.75 }}>{trip.summary}</p>}

      <div className="split">
        <div>
          {!shared && (
            <div className="tabs">
              {([
                ['itinerary', 'Itinerary'],
                ['map', 'Map'],
                ['add', 'Add places'],
              ] as const).map(([key, label]) => (
                <button key={key} type="button" className={`tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {(tab === 'itinerary' || shared) && grouped.map((group) => (
            <div className="day-block" key={group.day}>
              <div className="day-head">
                <h3>Day {group.day}</h3>
                <span className="muted" style={{ fontSize: 11 }}>{group.items.length} stops</span>
              </div>
              {group.items.map((item) => (
                <div className="item-row" key={item.id ?? `${item.title}-${item.time}`}>
                  {!shared ? (
                    <input
                      type="time"
                      value={String(item.time).slice(0, 5)}
                      style={{ width: 78, border: '1px solid var(--line)', borderRadius: 6, padding: '3px 4px', fontSize: 11, background: 'var(--paper)' }}
                      onChange={(event) =>
                        mutate(() =>
                          api(`/trips/${trip.id}/items/${item.id}`, {
                            method: 'PATCH',
                            body: { time: event.target.value },
                          }),
                        )
                      }
                    />
                  ) : (
                    <div className="item-time">{item.time}</div>
                  )}
                  <div className={`item-dot ${itemType(item)}`} />
                  <div>
                    <div className="item-title">
                      {item.title}
                      <span className="slot-label">{item.slot}</span>
                    </div>
                    {item.notes && <div className="item-notes">{item.notes}</div>}
                    {!shared && (
                      <div className="row" style={{ gap: 8, marginTop: 8 }}>
                        <select
                          value={item.day}
                          aria-label="Move to day"
                          style={{ fontSize: 10.5, padding: '3px 6px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)' }}
                          onChange={(event) =>
                            mutate(() =>
                              api(`/trips/${trip.id}/items/${item.id}`, {
                                method: 'PATCH',
                                body: { day: Number(event.target.value) },
                              }),
                            )
                          }
                        >
                          {Array.from({ length: Math.max(days, 1) }, (_, index) => index + 1).map((day) => (
                            <option key={day} value={day}>Day {day}</option>
                          ))}
                        </select>
                        <span className="muted" style={{ fontSize: 10.5 }}>{itemDuration(item)} min</span>
                        {typeof item.place_id === 'number' && item.place_id > 0 && (
                          <span className="tag" style={{ fontSize: 9 }}>{itemType(item)}</span>
                        )}
                      </div>
                    )}
                  </div>
                  {!shared && (
                    <div className="item-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Move earlier"
                        onClick={() =>
                          mutate(() =>
                            api(`/trips/${trip.id}/items/${item.id}/move`, { method: 'POST', body: { direction: 'up' } }),
                          )
                        }
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Move later"
                        onClick={() =>
                          mutate(() =>
                            api(`/trips/${trip.id}/items/${item.id}/move`, { method: 'POST', body: { direction: 'down' } }),
                          )
                        }
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="icon-btn danger"
                        aria-label="Remove stop"
                        onClick={() =>
                          mutate(() => api(`/trips/${trip.id}/items/${item.id}`, { method: 'DELETE' }))
                        }
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}

          {tab === 'map' && !shared && (
            <>
              <MapView markers={markers} path={markers.map((m) => ({ lat: m.lat, lng: m.lng }))} height={520} />
              <div className="map-legend">
                <span><i style={{ background: 'var(--clay)' }} />Attractions</span>
                <span><i style={{ background: 'var(--gold)' }} />Restaurants</span>
                <span><i style={{ background: 'var(--sage)' }} />Stay</span>
                <span className="muted">Route lines are direct, not turn-by-turn.</span>
              </div>
            </>
          )}

          {tab === 'add' && !shared && (
            <div>
              <div className="row row-wrap" style={{ marginBottom: 14 }}>
                <Chip active={addType === 'attraction'} onClick={() => setAddType('attraction')}>Attractions</Chip>
                <Chip active={addType === 'restaurant'} onClick={() => setAddType('restaurant')}>Restaurants</Chip>
                <Chip active={addType === 'hotel'} onClick={() => setAddType('hotel')}>Hotels</Chip>
                <div className="spacer" />
                <div className="row" style={{ gap: 6 }}>
                  <span className="muted" style={{ fontSize: 11 }}>Add to</span>
                  <select
                    value={addDay}
                    onChange={(event) => setAddDay(Number(event.target.value))}
                    style={{ fontSize: 11.5, padding: '5px 8px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)' }}
                  >
                    {Array.from({ length: days }, (_, index) => index + 1).map((day) => (
                      <option key={day} value={day}>Day {day}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field" style={{ marginBottom: 16 }}>
                <label>Search nearby</label>
                <input
                  value={addQuery}
                  placeholder={`Find ${addType}s in ${trip.destination?.name ?? 'this destination'}`}
                  onChange={(event) => setAddQuery(event.target.value)}
                />
              </div>
              {candidatesBusy && <Loading label="Searching places" />}
              <div className="place-list">
                {candidates.map((place) => (
                  <div key={place.id} className="place-row" style={{ gridTemplateColumns: '92px 1fr auto' }}>
                    <img src={place.image} alt="" style={{ height: '100%', minHeight: 96 }} />
                    <div className="place-row-body" style={{ padding: '12px 0' }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{place.name}</div>
                      <div className="muted" style={{ fontSize: 11.5 }}>{place.summary}</div>
                      <div className="row" style={{ gap: 6, marginTop: 6 }}>
                        <span className="tag">{place.rating}★</span>
                        <span className="tag">{place.price > 0 ? formatINR(place.price) : 'Free entry'}</span>
                      </div>
                    </div>
                    <div style={{ padding: '0 16px' }}>
                      <button type="button" className="btn btn-sm" onClick={() => addPlace(place)} disabled={addBusy === place.id}>
                        {addBusy === place.id ? 'Adding…' : 'Add'}
                      </button>
                    </div>
                  </div>
                ))}
                {!candidatesBusy && candidates.length === 0 && <Empty title="Nothing found">Try a different search.</Empty>}
              </div>
            </div>
          )}
        </div>

        <div className="side">
          {markers.length > 0 && tab !== 'map' && (
            <MapView markers={markers} path={markers.map((m) => ({ lat: m.lat, lng: m.lng }))} height={300} />
          )}
          <div className="panel">
            <span className="eyebrow">Trip cost</span>
            {budget?.estimate ? (
              <>
                <div className="big-total" style={{ margin: '10px 0 4px' }}>{formatINR(budget.estimate.total)}</div>
                <div className="muted" style={{ fontSize: 11.5 }}>
                  About {formatINR(budget.estimate.perPerson)} per person · {budget.estimate.nights} nights
                </div>
                <div className="hr" />
                <div className="col" style={{ gap: 9 }}>
                  {budget.estimate.breakdown.map((row) => (
                    <div key={row.key} className="row-between" style={{ fontSize: 12 }}>
                      <span className="muted">{row.label}</span>
                      <strong>{formatINR(row.amount)}</strong>
                    </div>
                  ))}
                </div>
                <div className="notice" style={{ marginTop: 14 }}>
                  Estimate excludes travel to the destination and uses the rate for your chosen transport. Your stated
                  trip budget is {formatINR(trip.budget)}.
                </div>
              </>
            ) : (
              <Loading label="Calculating" />
            )}
          </div>

          {!shared && (
            <div className="panel">
              <span className="eyebrow">Quick actions</span>
              <div className="col" style={{ gap: 8, marginTop: 12 }}>
                <Link to={`/hotels${trip.destination ? `?destination=${trip.destination.id}` : ''}`} className="btn btn-sm btn-ghost btn-block">
                  Find a stay in {trip.destination?.name ?? 'this area'}
                </Link>
                <Link to={`/restaurants${trip.destination ? `?destination=${trip.destination.id}` : ''}`} className="btn btn-sm btn-ghost btn-block">
                  Find a table
                </Link>
                <Link to="/passport" className="btn btn-sm btn-ghost btn-block">
                  Add a passport stamp
                </Link>
              </div>
            </div>
          )}

          {!user && shared && (
            <div className="panel">
              <span className="eyebrow">This is a shared itinerary</span>
              <p className="form-note" style={{ marginTop: 8 }}>
                Sign in to save your own version, add bookings and track it on your dashboard.
              </p>
              <Link to="/register" className="btn btn-sm btn-block" style={{ marginTop: 12 }}>
                Create an account
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
