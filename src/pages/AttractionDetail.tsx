import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { formatINR } from '../lib/geo';
import { useAuth } from '../lib/auth';
import type { Destination, Place, Trip } from '../lib/types';
import MapView from '../components/MapView';
import { Alert, Empty, Loading, Rating, SaveButton } from '../components/UI';

interface Payload {
  place: Place;
  destination: Destination | null;
}

export default function AttractionDetail() {
  const { slug = '' } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [food, setFood] = useState<Place[]>([]);
  const [stays, setStays] = useState<Place[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripId, setTripId] = useState('');
  const [day, setDay] = useState(1);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api<Payload>(`/places/attraction/${slug}`)
      .then((payload) => {
        setData(payload);
        return Promise.all([
          api<{ places: Place[] }>(`/places${qs({ type: 'restaurant', destination: payload.place.destination.slug, limit: 2 })}`),
          api<{ places: Place[] }>(`/places${qs({ type: 'hotel', destination: payload.place.destination.slug, limit: 2 })}`),
        ]);
      })
      .then(([restaurants, hotels]) => {
        setFood(restaurants?.places ?? []);
        setStays(hotels?.places ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Attraction not found'));
  }, [slug]);

  useEffect(() => {
    if (!user) return;
    api<{ trips: Trip[] }>('/trips')
      .then((result) => {
        setTrips(result.trips);
        if (result.trips[0]) setTripId(String(result.trips[0].id));
      })
      .catch(() => undefined);
  }, [user]);

  async function addToTrip() {
    if (!data || !tripId) return;
    setAdding(true);
    setAdded(null);
    try {
      await api(`/trips/${tripId}/items`, {
        method: 'POST',
        body: {
          placeType: 'attraction',
          placeId: data.place.id,
          day,
          slot: 'afternoon',
          time: '15:00',
        },
      });
      setAdded(`Added to your day ${day} plan.`);
    } catch (err) {
      setAdded(err instanceof Error ? err.message : 'Could not add this attraction');
    } finally {
      setAdding(false);
    }
  }

  if (error) return <div className="wrap" style={{ paddingTop: 60 }}><Empty title="Attraction not found">{error}</Empty></div>;
  if (!data) return <div className="wrap"><Loading label="Opening attraction" /></div>;

  const { place } = data;
  const hours = String(place.extra.opening_hours ?? 'Hours vary');
  const visit = Number(place.extra.avg_visit_minutes ?? 90);
  const tips = String(place.extra.tips ?? '');
  const destinationSlug = place.destination.slug;

  return (
    <div className="wrap">
      <div className="breadcrumb" style={{ paddingTop: 22 }}>
        <Link to="/attractions">Attractions</Link>
        <span>/</span>
        <Link to={`/explore/${destinationSlug}`}>{place.destination.name}</Link>
        <span>/</span>
        <span>{place.name}</span>
      </div>

      <div className="split">
        <div>
          <div style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <img src={place.image} alt={place.name} style={{ width: '100%', height: 420, objectFit: 'cover' }} />
          </div>

          <div style={{ marginTop: 22 }}>
            <div className="row row-wrap" style={{ gap: 8, marginBottom: 12 }}>
              <span className="tag tag-clay">{place.tags[0]}</span>
              {place.isHidden && <span className="tag tag-gold">Hidden gem</span>}
              {Number(place.extra.unesco) === 1 && <span className="tag tag-gold">UNESCO</span>}
              <span className="tag">{place.destination.name}</span>
              {place.distanceKm !== null && <span className="tag">{place.distanceKm} km away · ~{place.travelMinutes} min</span>}
            </div>
            <h1 style={{ fontSize: 'clamp(30px, 4vw, 46px)', fontWeight: 400 }}>{place.name}</h1>
            <div className="row row-wrap" style={{ gap: 16, marginTop: 10 }}>
              <Rating value={place.rating} reviews={place.reviews} />
              <span className="muted" style={{ fontSize: 12.5 }}>{hours}</span>
              <span className="muted" style={{ fontSize: 12.5 }}>{place.price > 0 ? `${formatINR(place.price)} entry` : 'Free entry'}</span>
            </div>

            <div className="hr" />
            <p style={{ fontSize: 14.5, lineHeight: 1.8, color: 'var(--ink-2)' }}>{place.description}</p>

            <div className="stat-grid" style={{ marginTop: 24 }}>
              <div className="stat"><b>{formatINR(place.price)}</b><span>Entry fee</span></div>
              <div className="stat"><b>{visit} min</b><span>Suggested visit</span></div>
              <div className="stat"><b>{hours.split('-')[0]?.trim() ?? '—'}</b><span>Opens</span></div>
              <div className="stat"><b>{place.rating.toFixed(1)}</b><span>Rating</span></div>
            </div>

            {tips && (
              <>
                <div className="divider-label">Visitor notes</div>
                <div className="alert alert-info">{tips}</div>
              </>
            )}

            <section style={{ marginTop: 30 }}>
              <span className="eyebrow">Location</span>
              <div style={{ marginTop: 12 }}>
                <MapView
                  markers={[{ lat: place.lat, lng: place.lng, title: place.name, subtitle: place.tags[0], kind: 'attraction' }]}
                  center={[place.lat, place.lng]}
                  zoom={13}
                  height={340}
                />
              </div>
              <div className="row row-wrap" style={{ marginTop: 12 }}>
                <a
                  className="btn btn-sm btn-ghost"
                  href={`https://www.openstreetmap.org/directions?from=&to=${place.lat}%2C${place.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Get directions ↗
                </a>
                <a
                  className="btn btn-sm btn-ghost"
                  href={`https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Maps ↗
                </a>
              </div>
            </section>

            {food.length > 0 && (
              <section style={{ marginTop: 30 }}>
                <span className="eyebrow">Eat nearby</span>
                <div className="col" style={{ gap: 10, marginTop: 12 }}>
                  {food.map((item) => (
                    <Link key={item.id} to={`/restaurants/${item.slug}`} className="row panel panel-tight" style={{ gap: 12 }}>
                      <img src={item.image} alt="" style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover' }} />
                      <div className="grow">
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</div>
                        <div className="muted" style={{ fontSize: 11 }}>{item.tags.join(', ')} · {formatINR(item.price)} for two</div>
                      </div>
                      <span>→</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {stays.length > 0 && (
              <section style={{ marginTop: 26 }}>
                <span className="eyebrow">Stay nearby</span>
                <div className="col" style={{ gap: 10, marginTop: 12 }}>
                  {stays.map((item) => (
                    <Link key={item.id} to={`/hotels/${item.slug}`} className="row panel panel-tight" style={{ gap: 12 }}>
                      <img src={item.image} alt="" style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover' }} />
                      <div className="grow">
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</div>
                        <div className="muted" style={{ fontSize: 11 }}>{formatINR(item.price)} / night · {item.rating}★</div>
                      </div>
                      <span>→</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

        <div className="side">
          <div className="panel sticky">
            <span className="eyebrow">Add to a trip</span>
            <p className="form-note" style={{ margin: '8px 0 12px' }}>
              Drop this stop into an existing itinerary and it will appear on the map with your other days.
            </p>
            {!user ? (
              <Link to={`/login?next=${encodeURIComponent(`/attractions/${slug}`)}`} className="btn btn-sm btn-block">
                Sign in to add
              </Link>
            ) : trips.length === 0 ? (
              <>
                <p className="form-note">No saved trips yet.</p>
                <Link to={`/plan?destination=${destinationSlug}`} className="btn btn-sm btn-block" style={{ marginTop: 8 }}>
                  Plan a trip first
                </Link>
              </>
            ) : (
              <>
                <div className="field" style={{ marginBottom: 10 }}>
                  <label>Trip</label>
                  <select value={tripId} onChange={(event) => setTripId(event.target.value)}>
                    {trips.map((trip) => (
                      <option key={trip.id} value={trip.id}>{trip.title}</option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 12 }}>
                  <label>Day</label>
                  <select value={day} onChange={(event) => setDay(Number(event.target.value))}>
                    {Array.from({ length: 7 }, (_, index) => index + 1).map((value) => (
                      <option key={value} value={value}>Day {value}</option>
                    ))}
                  </select>
                </div>
                <button type="button" className="btn btn-sm btn-block" onClick={addToTrip} disabled={adding}>
                  {adding ? 'Adding…' : 'Add to itinerary'}
                </button>
                {added && <div className="alert alert-ok" style={{ marginTop: 10 }}>{added}</div>}
                <Link to={`/trips/${tripId}`} className="btn btn-sm btn-ghost btn-block" style={{ marginTop: 8 }}>
                  Open itinerary
                </Link>
              </>
            )}
            <div style={{ marginTop: 14 }}>
              <SaveButton placeType="attraction" placeId={place.id} label="Save attraction" />
            </div>
          </div>

          <div className="panel">
            <span className="eyebrow">Practical</span>
            <div className="col" style={{ gap: 10, marginTop: 12, fontSize: 12 }}>
              <div className="row-between"><span className="muted">Opening hours</span><strong style={{ textAlign: 'right' }}>{hours}</strong></div>
              <div className="row-between"><span className="muted">Entry</span><strong>{place.price > 0 ? formatINR(place.price) : 'Free'}</strong></div>
              <div className="row-between"><span className="muted">Suggested time</span><strong>{visit} minutes</strong></div>
              <div className="row-between"><span className="muted">Destination</span><Link to={`/explore/${destinationSlug}`} className="link">{place.destination.name}</Link></div>
            </div>
            {tips && <p className="form-note" style={{ marginTop: 12 }}>{tips}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
