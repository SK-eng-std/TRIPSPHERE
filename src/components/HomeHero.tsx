import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { addDays, formatDate, formatINR, todayIso } from '../lib/geo';
import type { Destination, ItineraryItem, Place, Plan, Trip } from '../lib/types';
import { INTERESTS, INTEREST_LABELS, itemType } from '../lib/trip';
import MapView, { type MapMarker } from './MapView';
import Logo from './Logo';

interface Preview {
  destination: Destination | null;
  title: string;
  items: ItineraryItem[];
  images: Record<string, string>;
  slugs: Record<string, string>;
  startDate: string;
  endDate: string;
  travellers: number;
  budget: number;
  interests: string[];
  mode: string;
  personal: boolean;
  loading: boolean;
  error: string | null;
  tripId?: number;
}

const EMPTY_PREVIEW: Preview = {
  destination: null,
  title: '',
  items: [],
  images: {},
  slugs: {},
  startDate: addDays(todayIso(), 14),
  endDate: addDays(todayIso(), 18),
  travellers: 2,
  budget: 0,
  interests: [],
  mode: 'smart-engine',
  personal: false,
  loading: true,
  error: null,
};

const SLOTS = [
  { key: 'morning', label: 'Morning' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'evening', label: 'Evening' },
];

async function mediaFor(destination: Destination) {
  const images: Record<string, string> = {};
  const slugs: Record<string, string> = {};
  try {
    const detail = await api<{ attractions: Place[]; hotels: Place[]; restaurants: Place[] }>(
      `/destinations/${destination.slug}`,
    );
    for (const place of [...detail.attractions, ...detail.hotels, ...detail.restaurants]) {
      const key = `${place.type}:${place.id}`;
      images[key] = place.image;
      slugs[key] = place.slug;
    }
  } catch {
    /* imagery is decorative — the plan still renders without it */
  }
  return { images, slugs };
}

function typeOf(item: ItineraryItem): string {
  return itemType(item);
}

function imageFor(item: ItineraryItem, preview: Preview): string {
  const type = typeOf(item);
  const id = item.placeId ?? item.place_id;
  return preview.images[`${type}:${id}`] || preview.destination?.image || '/images/hero.jpg';
}

function hrefFor(item: ItineraryItem, preview: Preview): string | undefined {
  const type = typeOf(item);
  const id = item.placeId ?? item.place_id;
  const slug = preview.slugs[`${type}:${id}`];
  if (!slug) return undefined;
  if (type === 'hotel') return `/hotels/${slug}`;
  if (type === 'restaurant') return `/restaurants/${slug}`;
  if (type === 'attraction') return `/attractions/${slug}`;
  return undefined;
}

function markerKind(item: ItineraryItem): MapMarker['kind'] {
  const type = typeOf(item);
  if (type === 'hotel' || type === 'restaurant') return type;
  if (type === 'attraction') return 'attraction';
  return 'stop';
}

function slotKey(item: ItineraryItem): string {
  const slot = String(item.slot || 'afternoon').toLowerCase();
  if (slot === 'night') return 'evening';
  return SLOTS.some((s) => s.key === slot) ? slot : 'afternoon';
}

function budgetBand(total: number, travellers: number, days: number): string {
  const perPersonDay = total / Math.max(1, travellers) / Math.max(1, days);
  if (perPersonDay <= 3000) return 'Budget';
  if (perPersonDay <= 7500) return 'Moderate';
  return 'Premium';
}

export default function HomeHero() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<Preview>(EMPTY_PREVIEW);
  const [pool, setPool] = useState<Destination[]>([]);
  const [day, setDay] = useState(1);
  const [query, setQuery] = useState('');
  const [interest, setInterest] = useState('');
  const started = useRef(false);

  const showDestination = useCallback(async (destination: Destination) => {
    const startDate = addDays(todayIso(), 14);
    const budget = Math.max(12000, destination.avg_daily_budget * 5 * 2);
    setPreview((prev) => ({
      ...prev,
      destination,
      personal: false,
      loading: true,
      error: null,
    }));
    try {
      const [generated, media] = await Promise.all([
        api<{ plan: Plan }>('/trips/generate', {
          method: 'POST',
          body: {
            destinationId: destination.id,
            startDate,
            endDate: addDays(startDate, 4),
            travellers: 2,
            budget,
            transport: 'car',
            interests: destination.interests.slice(0, 3),
            pace: 'balanced',
          },
        }),
        mediaFor(destination),
      ]);
      const planDays = Math.max(
        1,
        generated.plan.days || 1,
        ...generated.plan.items.map((item) => Number(item.day) || 1),
      );
      setPreview({
        destination,
        title: generated.plan.title,
        items: generated.plan.items,
        images: media.images,
        slugs: media.slugs,
        startDate,
        endDate: addDays(startDate, planDays - 1),
        travellers: 2,
        budget,
        interests: destination.interests.slice(0, 3),
        mode: generated.plan.mode,
        personal: false,
        loading: false,
        error: null,
      });
      setDay(1);
    } catch (error) {
      setPreview((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Could not build a preview itinerary.',
      }));
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;

    (async () => {
      try {
        const [list, recos] = await Promise.all([
          api<{ destinations: Destination[] }>('/destinations?limit=60'),
          api<{ recommendations: Destination[] }>('/recommendations').catch(() => ({ recommendations: [] })),
        ]);
        if (cancelled) return;
        setPool(list.destinations);

        if (user) {
          const trips = await api<{ trips: Trip[] }>('/trips').catch(() => ({ trips: [] as Trip[] }));
          const next =
            trips.trips.find((trip) => trip.status === 'planned') ??
            trips.trips.find((trip) => trip.status === 'ongoing') ??
            trips.trips[0];
          if (next) {
            const detail = await api<{ trip: Trip }>(`/trips/${next.id}`).catch(() => null);
            const trip = detail?.trip;
            if (!cancelled && trip && trip.items?.length) {
              const destination =
                trip.destination ?? list.destinations.find((item) => item.id === trip.destination_id) ?? null;
              const media = destination ? await mediaFor(destination) : { images: {}, slugs: {} };
              if (cancelled) return;
              setPreview({
                destination,
                title: trip.title,
                items: trip.items,
                images: media.images,
                slugs: media.slugs,
                startDate: trip.start_date ?? EMPTY_PREVIEW.startDate,
                endDate: trip.end_date ?? EMPTY_PREVIEW.endDate,
                travellers: trip.travellers ?? 2,
                budget: trip.budget ?? 0,
                interests: trip.interests ?? [],
                mode: trip.ai_mode,
                personal: true,
                loading: false,
                error: null,
                tripId: trip.id,
              });
              setDay(Math.min(...trip.items.map((item) => Number(item.day) || 1)));
              return;
            }
          }
        }

        const seed = Math.floor(Date.now() / 86_400_000);
        const shortlist = recos.recommendations?.length ? recos.recommendations : list.destinations;
        const pick = shortlist[seed % Math.max(1, shortlist.length)];
        if (pick) await showDestination(pick);
        else setPreview((prev) => ({ ...prev, loading: false, error: 'No destinations are available yet.' }));
      } catch (error) {
        if (!cancelled) {
          setPreview((prev) => ({
            ...prev,
            loading: false,
            error: error instanceof Error ? error.message : 'Could not load the itinerary preview.',
          }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const days = useMemo(
    () => Array.from(new Set(preview.items.map((item) => Number(item.day) || 1))).sort((a, b) => a - b),
    [preview.items],
  );

  useEffect(() => {
    if (days.length && !days.includes(day)) setDay(days[0]);
  }, [days, day]);

  const dayItems = useMemo(
    () =>
      preview.items
        .filter((item) => (Number(item.day) || 1) === day)
        .sort((a, b) => {
          const orderA = a.sort_order ?? 0;
          const orderB = b.sort_order ?? 0;
          if (orderA !== orderB) return orderA - orderB;
          return String(a.time).localeCompare(String(b.time));
        }),
    [preview.items, day],
  );

  const markers = useMemo<MapMarker[]>(
    () =>
      dayItems
        .filter((item) => item.lat !== null && item.lng !== null)
        .map((item, index) => ({
          lat: Number(item.lat),
          lng: Number(item.lng),
          title: item.title,
          subtitle: `${item.time}${item.cost ? ` · ${formatINR(item.cost)}` : ''}`,
          image: imageFor(item, preview),
          href: hrefFor(item, preview),
          index: index + 1,
          kind: markerKind(item),
        })),
    [dayItems, preview],
  );

  const path = useMemo(() => markers.map((marker) => ({ lat: marker.lat, lng: marker.lng })), [markers]);

  const currentDestination = preview.destination;
  const destinationLabel = [currentDestination?.name, currentDestination?.state].filter(Boolean).join(', ');
  const planLink = preview.personal && preview.tripId ? `/trips/${preview.tripId}` : currentDestination ? `/plan?destination=${currentDestination.slug}&days=${Math.max(1, days.length)}` : '/plan';

  function shuffle() {
    if (!pool.length) return;
    const index = pool.findIndex((item) => item.id === currentDestination?.id);
    const next = pool[(index + 1 + pool.length) % pool.length];
    if (next && next.id !== currentDestination?.id) void showDestination(next);
  }

  function search(event: React.FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (interest) params.set('interest', interest);
    navigate(`/explore${params.toString() ? `?${params}` : ''}`);
  }

  return (
    <div className="hero-shell">
      <div className="wrap">
        <div className="hero-grid">
          <section className="hero-left">
            <span className="hero-badge">
              <i>✦</i> AI travel planner
            </span>
            <h1 className="hero-title">
              Your perfect journey,
              <br />
              <span className="grad">planned in seconds.</span>
            </h1>
            <p className="hero-lede">
              Tell TRIPSPHERE where you want to go and discover personalised travel itineraries, nearby attractions,
              hotels, restaurants, and unforgettable experiences — all in one place.
            </p>

            <div className="feature-grid">
              <div className="feature">
                <span className="feature-icon" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
                  <SparkIcon />
                </span>
                <b>AI-Powered Itineraries</b>
              </div>
              <div className="feature">
                <span className="feature-icon" style={{ background: 'var(--purple-soft)', color: 'var(--purple)' }}>
                  <CalendarIcon />
                </span>
                <b>Day-by-Day Travel Plans</b>
              </div>
              <div className="feature">
                <span className="feature-icon" style={{ background: 'var(--cyan-soft)', color: 'var(--cyan)' }}>
                  <RouteIcon />
                </span>
                <b>Smart Places &amp; Routes</b>
              </div>
              <div className="feature">
                <span className="feature-icon" style={{ background: 'var(--orange-soft)', color: 'var(--orange)' }}>
                  <BedIcon />
                </span>
                <b>Hotels &amp; Restaurant Discovery</b>
              </div>
            </div>

            <div className="hero-cta">
              <Link to="/plan" className="btn btn-accent btn-lg">
                Plan My Journey
                <span aria-hidden="true">→</span>
              </Link>
              <span className="hero-note">
                <CheckIcon /> Free to plan · Save and share in seconds
              </span>
            </div>

            <svg className="flight-deco" viewBox="0 0 240 120" fill="none" aria-hidden="true">
              <path d="M4 100C40 100 52 40 102 40s66 42 130 6" stroke="#C9D5F8" strokeWidth="1.6" className="dash" />
              <circle cx="4" cy="100" r="3.5" fill="#7657E8" />
              <circle cx="102" cy="40" r="2.5" fill="#315BEB" opacity="0.7" />
              <g className="plane" transform="translate(198 38) rotate(16)">
                <path d="M0 8.5l23-6.5-8 8 9.5 3.2-3.2 3.2-9-2.2-4.4 6.3-1.8-7.6-6.1-1.2z" fill="#315BEB" />
              </g>
            </svg>
          </section>

          <section className="trip-card" aria-label="Itinerary preview">
            <div className="trip-top">
              <span className="trip-brand">
                <Logo size={24} /> TRIPSPHERE <span className="trip-mini-tag">AI</span>
              </span>
              <span className="trip-avatar">
                <span className="avatar">{user ? user.name.slice(0, 1).toUpperCase() : 'G'}</span>
                {user ? user.name.split(' ')[0] : 'Guest preview'}
              </span>
            </div>

            {preview.loading && !currentDestination ? (
              <div className="trip-loading">
                <div className="tl-row" style={{ height: 184, borderRadius: 18 }} />
                <div className="tl-row" />
                <div className="tl-row" />
                <div className="tl-row" />
                <div className="tl-status">
                  <span className="spinner" /> Crafting a personalised itinerary…
                </div>
              </div>
            ) : (
              <>
                <div className="trip-photo">
                  <img src={currentDestination?.image ?? '/images/hero.jpg'} alt={currentDestination?.name ?? ''} />
                  <div className="trip-photo-overlay">
                    <span className="trip-kicker">
                      {preview.personal ? 'Your next trip' : 'Sample itinerary'} ·{' '}
                      {formatDate(preview.startDate)} – {formatDate(preview.endDate)}
                    </span>
                    <h3>{currentDestination?.name ?? 'Somewhere extraordinary'}</h3>
                    <span className="trip-place">
                      {preview.title || destinationLabel || 'Tell us where you want to go'}
                    </span>
                    <div className="trip-pills">
                      {destinationLabel && <span className="trip-pill">Destination: {destinationLabel}</span>}
                      <span className="trip-pill">Duration: {Math.max(1, days.length)} days</span>
                      <span className="trip-pill">Travellers: {preview.travellers}</span>
                      <span className="trip-pill">
                        Budget: {budgetBand(preview.budget, preview.travellers, Math.max(1, days.length))}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="prefs">
                  <span className="prefs-label">Trip preferences</span>
                  {(preview.interests.length
                    ? preview.interests
                    : currentDestination?.interests?.slice(0, 3) ?? []
                  )
                    .slice(0, 4)
                    .map((item) => (
                      <span className="pref-chip" key={item}>
                        {INTEREST_LABELS[item] ?? item}
                      </span>
                    ))}
                  {preview.interests.length === 0 && !currentDestination && <span className="pref-chip">Flexible</span>}
                </div>

                <div className="day-tabs" role="tablist" aria-label="Itinerary days">
                  {days.map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={value === day}
                      className={`day-tab ${value === day ? 'active' : ''}`}
                      onClick={() => setDay(value)}
                    >
                      Day {value}
                    </button>
                  ))}
                  {days.length === 0 && <span className="pref-chip">Day 1</span>}
                </div>

                <div className="trip-scroll" key={`${preview.destination?.id}-${day}`}>
                  {preview.error ? (
                    <div className="alert alert-error" style={{ fontSize: 11 }}>
                      {preview.error}{' '}
                      <button type="button" className="link" style={{ background: 'none', border: 0 }} onClick={shuffle}>
                        Try another
                      </button>
                    </div>
                  ) : dayItems.length === 0 ? (
                    <p className="muted" style={{ fontSize: 11.5 }}>
                      This day is still open. Add stops from the full planner.
                    </p>
                  ) : (
                    SLOTS.map((slot) => {
                      const items = dayItems.filter((item) => slotKey(item) === slot.key);
                      if (!items.length) return null;
                      return (
                        <div className="slot" key={slot.key}>
                          <span className="slot-title">{slot.label}</span>
                          {items.map((item, index) => {
                            const href = hrefFor(item, preview);
                            return (
                              <div className="stop" key={`${item.title}-${index}`}>
                                <img src={imageFor(item, preview)} alt="" loading="lazy" />
                                <div className="stop-body">
                                  <b>{item.title}</b>
                                  <div className="stop-meta">
                                    <span>{item.time}</span>
                                    <span>{item.durationMinutes ?? item.duration_minutes ?? 90} min</span>
                                    {item.cost > 0 && <span>{formatINR(item.cost)}</span>}
                                  </div>
                                </div>
                                <div className="stop-right">
                                  {item.cost > 0 ? <span className="stop-cost">{formatINR(item.cost)}</span> : <span className="stop-cost">Free</span>}
                                  {href ? (
                                    <Link to={href} className="stop-link">
                                      Details →
                                    </Link>
                                  ) : (
                                    <span className="stop-link" style={{ color: 'var(--muted)' }}>
                                      On map
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="trip-foot">
                  <small>
                    <span className="legend-dot" />
                    {preview.mode === 'openai' ? 'OpenAI planner' : 'Built-in travel engine'}
                    {preview.personal ? ' · your trip' : ''}
                  </small>
                  <div className="row" style={{ gap: 10 }}>
                    <button type="button" className="stop-link" style={{ background: 'none', border: 0 }} onClick={shuffle}>
                      Shuffle ↻
                    </button>
                    <Link to={planLink} className="link" style={{ fontSize: 10.5 }}>
                      Open full plan →
                    </Link>
                  </div>
                </div>
              </>
            )}
          </section>

          <section className="map-panel" aria-label="Route map">
            <div className="map-head">
              <b>
                <PinIcon /> Live route map
              </b>
              <span className="map-head-note">
                Day {day} · {markers.length} stops
              </span>
            </div>
            <div className="map-body">
              {markers.length ? (
                <MapView
                  markers={markers}
                  path={path}
                  center={currentDestination ? [currentDestination.lat, currentDestination.lng] : undefined}
                  zoom={12}
                  height="100%"
                />
              ) : (
                <div className="loading-block" style={{ height: '100%' }}>
                  <span className="spinner" /> Mapping the route…
                </div>
              )}
              <div className="promo">
                <span className="promo-icon">
                  <GlobeIcon />
                </span>
                <b>Explore More. Travel Better.</b>
                <p>TRIPSPHERE makes every journey unforgettable.</p>
              </div>
            </div>
            <div className="map-legend">
              <span>
                <i className="legend-dot" /> Attractions
              </span>
              <span>
                <i className="legend-dot purple" /> Stays
              </span>
              <span>
                <i className="legend-dot orange" /> Dining
              </span>
            </div>
          </section>
        </div>

        <form className="search-band" onSubmit={search} role="search">
          <label className="search-field">
            <SearchIcon />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Where do you want to go? Try Hampi, Coorg or Goa"
              aria-label="Search destinations"
            />
          </label>
          <label className="search-field">
            <CompassIcon />
            <select value={interest} onChange={(event) => setInterest(event.target.value)} aria-label="Travel interest">
              <option value="">Any experience</option>
              {INTERESTS.map((value) => (
                <option value={value} key={value}>
                  {INTEREST_LABELS[value] ?? value}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn">
            Find my trip →
          </button>
        </form>
      </div>
    </div>
  );
}

/* ---------------- small icons ---------------- */

function SparkIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l1.9 4.9L19 9.8l-5.1 1.9L12 17l-1.9-5.3L5 9.8l5.1-1.9z" fill="currentColor" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5.5" width="17" height="15" rx="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 3.5v4M16 3.5v4M3.5 10.5h17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function RouteIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="18" cy="18" r="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8.5 6h5a3 3 0 010 6h-3a3 3 0 000 6h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function BedIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 18v-7a2 2 0 012-2h14a2 2 0 012 2v7M3 15h18M3 18v2M21 18v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M7 9V7a2 2 0 012-2h6a2 2 0 012 2v2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function CompassIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M14.8 9.2l-1.5 4.1-4.1 1.5 1.5-4.1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 21s6.5-5.3 6.5-10.2A6.5 6.5 0 005.5 10.8C5.5 15.7 12 21 12 21z" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="10.5" r="2.3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="#fff" strokeWidth="1.5" />
      <ellipse cx="12" cy="12" rx="3.6" ry="8.5" stroke="#fff" strokeWidth="1.2" />
      <path d="M3.5 12h17" stroke="#fff" strokeWidth="1.2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
