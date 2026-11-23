import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { formatINR, restaurantSearchUrl, todayIso } from '../lib/geo';
import { useAuth } from '../lib/auth';
import type { Destination, Place, Reservation } from '../lib/types';
import MapView from '../components/MapView';
import { Alert, Empty, Loading, Rating, SaveButton } from '../components/UI';

interface Payload {
  place: Place;
  destination: Destination | null;
}

export default function RestaurantDetail() {
  const { slug = '' } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [nearby, setNearby] = useState<Place[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState('19:30');
  const [guests, setGuests] = useState(2);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reservation, setReservation] = useState<(Reservation & { notice?: string }) | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api<Payload>(`/places/restaurant/${slug}`)
      .then((payload) => {
        setData(payload);
        return api<{ places: Place[] }>(
          `/places${qs({ type: 'attraction', destination: payload.place.destination.slug, limit: 3 })}`,
        );
      })
      .then((result) => setNearby(result?.places ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : 'Restaurant not found'));
  }, [slug]);

  async function requestTable() {
    if (!data) return;
    if (!user) {
      setFormError('Sign in to request a table.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const result = await api<{ reservation: Reservation; notice: string }>('/bookings/restaurants', {
        method: 'POST',
        body: { restaurantId: data.place.id, date, time, guests, note },
      });
      setReservation({ ...result.reservation, notice: result.notice });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not log the reservation');
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return <div className="wrap" style={{ paddingTop: 60 }}><Empty title="Restaurant not found">{error}</Empty></div>;
  }
  if (!data) return <div className="wrap"><Loading label="Opening restaurant" /></div>;

  const { place } = data;
  const hours = String(place.extra.opening_hours ?? '');
  const menu = String(place.extra.menu_summary ?? '');

  return (
    <div className="wrap">
      <div className="breadcrumb" style={{ paddingTop: 22 }}>
        <Link to="/restaurants">Restaurants</Link>
        <span>/</span>
        <Link to={`/explore/${place.destination.slug}`}>{place.destination.name}</Link>
        <span>/</span>
        <span>{place.name}</span>
      </div>

      <div className="split">
        <div>
          <div style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 22 }}>
            <img src={place.image} alt={place.name} style={{ width: '100%', height: 380, objectFit: 'cover' }} />
          </div>

          <div className="row row-wrap" style={{ gap: 8, marginBottom: 12 }}>
            <span className="tag tag-sage">{place.tags.join(' · ')}</span>
            <span className="tag">{place.destination.name}</span>
            {place.distanceKm !== null && <span className="tag">{place.distanceKm} km from you</span>}
            <span className="tag tag-clay">Sample inventory</span>
          </div>
          <h1 style={{ fontSize: 'clamp(30px, 4vw, 46px)', fontWeight: 400 }}>{place.name}</h1>
          <div className="row row-wrap" style={{ gap: 14, marginTop: 10 }}>
            <Rating value={place.rating} reviews={place.reviews} />
            <span className="muted" style={{ fontSize: 12.5 }}>{hours}</span>
            <span className="muted" style={{ fontSize: 12.5 }}>{formatINR(place.price)} for two</span>
          </div>

          <div className="hr" />
          <p style={{ fontSize: 14.5, lineHeight: 1.8, color: 'var(--ink-2)' }}>{place.description}</p>

          {menu && (
            <>
              <div className="divider-label">On the menu</div>
              <p style={{ fontSize: 13.5, lineHeight: 1.8 }}>{menu}</p>
            </>
          )}

          <div className="stat-grid" style={{ marginTop: 26 }}>
            <div className="stat"><b>{String(place.extra.opens_at ?? '')}</b><span>Opens</span></div>
            <div className="stat"><b>{String(place.extra.closes_at ?? '')}</b><span>Closes</span></div>
            <div className="stat"><b>{formatINR(place.price)}</b><span>For two</span></div>
            <div className="stat"><b>{place.rating.toFixed(1)}</b><span>Aggregate rating</span></div>
          </div>

          <section style={{ marginTop: 30 }}>
            <span className="eyebrow">Find it</span>
            <div style={{ marginTop: 12 }}>
              <MapView
                markers={[{ lat: place.lat, lng: place.lng, title: place.name, subtitle: String(place.extra.address ?? ''), kind: 'restaurant' }]}
                center={[place.lat, place.lng]}
                height={320}
              />
            </div>
            <p className="form-note" style={{ marginTop: 10 }}>
              Aggregate ratings come from our sample inventory. Live reviews and menus are available through the external
              listing.
            </p>
          </section>

          {nearby.length > 0 && (
            <section style={{ marginTop: 28 }}>
              <span className="eyebrow">Pair it with</span>
              <div className="col" style={{ gap: 10, marginTop: 12 }}>
                {nearby.map((item) => (
                  <Link key={item.id} to={`/attractions/${item.slug}`} className="row panel panel-tight" style={{ gap: 12 }}>
                    <img src={item.image} alt="" style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover' }} />
                    <div className="grow">
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</div>
                      <div className="muted" style={{ fontSize: 11 }}>{item.rating}★ · {item.price > 0 ? `${formatINR(item.price)} entry` : 'Free entry'}</div>
                    </div>
                    <span>→</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="side">
          <div className="panel sticky">
            {reservation ? (
              <>
                <span className="eyebrow">Request logged</span>
                <h3 style={{ fontSize: 24, margin: '8px 0 10px' }}>Reference {reservation.reference}</h3>
                <div className="alert alert-ok" style={{ marginBottom: 12 }}>
                  {reservation.notice ?? 'This is a demo request, not a confirmed table.'}
                </div>
                <div className="col" style={{ gap: 8, fontSize: 12.5 }}>
                  <div className="row-between"><span className="muted">Date</span><strong>{reservation.date}</strong></div>
                  <div className="row-between"><span className="muted">Time</span><strong>{reservation.time}</strong></div>
                  <div className="row-between"><span className="muted">Guests</span><strong>{reservation.guests}</strong></div>
                </div>
                <a
                  className="btn btn-sm btn-ghost btn-block"
                  style={{ marginTop: 14 }}
                  href={restaurantSearchUrl(place.name, place.destination.name)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Live reservation options ↗
                </a>
                <Link to="/profile?tab=reservations" className="btn btn-sm btn-block" style={{ marginTop: 8 }}>
                  View in dashboard
                </Link>
              </>
            ) : (
              <>
                <span className="eyebrow">Reserve a table</span>
                <h3 style={{ fontSize: 22, margin: '8px 0 14px' }}>Request a table at {place.name}</h3>
                <div className="form-grid" style={{ gap: 10 }}>
                  <div className="field">
                    <label>Date</label>
                    <input type="date" value={date} min={todayIso()} onChange={(event) => setDate(event.target.value)} />
                  </div>
                  <div className="field">
                    <label>Time</label>
                    <input type="time" value={time} min={String(place.extra.opens_at ?? '11:00')} max={String(place.extra.closes_at ?? '23:00')} onChange={(event) => setTime(event.target.value)} />
                  </div>
                  <div className="field">
                    <label>Guests</label>
                    <input type="number" min={1} max={12} value={guests} onChange={(event) => setGuests(Math.max(1, Number(event.target.value)))} />
                  </div>
                  <div className="field">
                    <label>Seating preference</label>
                    <select value={note} onChange={(event) => setNote(event.target.value)}>
                      <option value="">No preference</option>
                      <option value="Window table">Window table</option>
                      <option value="Outdoor / courtyard">Outdoor / courtyard</option>
                      <option value="Quiet corner">Quiet corner</option>
                    </select>
                  </div>
                </div>
                <p className="form-note" style={{ marginTop: 10 }}>
                  Served {hours}. Requests outside these hours will be rejected.
                </p>
                {formError && <div style={{ marginTop: 10 }}><Alert tone="error">{formError}</Alert></div>}
                <button type="button" className="btn btn-block" style={{ marginTop: 12 }} onClick={requestTable} disabled={busy}>
                  {busy ? 'Sending request…' : 'Request table'}
                </button>
                <p className="form-note" style={{ marginTop: 10 }}>
                  Demo mode: the request is saved to your dashboard, but the restaurant has not confirmed. Use the live
                  link for a real reservation.
                </p>
                <a
                  className="btn btn-sm btn-ghost btn-block"
                  href={restaurantSearchUrl(place.name, place.destination.name)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Check live availability ↗
                </a>
                <div style={{ marginTop: 12 }}>
                  <SaveButton placeType="restaurant" placeId={place.id} label="Save restaurant" />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
