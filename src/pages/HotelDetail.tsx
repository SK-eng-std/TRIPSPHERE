import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { addDays, formatINR, hotelSearchUrl, nightsBetween, todayIso } from '../lib/geo';
import { useAuth } from '../lib/auth';
import type { Destination, HotelBooking, Place } from '../lib/types';
import MapView from '../components/MapView';
import { Alert, Empty, Loading, Rating, SaveButton } from '../components/UI';

interface Payload {
  place: Place;
  destination: Destination | null;
}

export default function HotelDetail() {
  const { slug = '' } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nearby, setNearby] = useState<Place[]>([]);
  const [checkIn, setCheckIn] = useState(addDays(todayIso(), 7));
  const [checkOut, setCheckOut] = useState(addDays(todayIso(), 9));
  const [rooms, setRooms] = useState(1);
  const [guests, setGuests] = useState(2);
  const [busy, setBusy] = useState(false);
  const [booking, setBooking] = useState<(HotelBooking & { notice?: string }) | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api<Payload>(`/places/hotel/${slug}`)
      .then((payload) => {
        setData(payload);
        return api<{ places: Place[] }>(
          `/places${qs({ type: 'attraction', destination: payload.place.destination.slug, limit: 3 })}`,
        );
      })
      .then((result) => setNearby(result?.places ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : 'Hotel not found'));
  }, [slug]);

  const nights = useMemo(() => nightsBetween(checkIn, checkOut), [checkIn, checkOut]);
  const total = data ? data.place.price * rooms * nights : 0;

  async function requestStay() {
    if (!data) return;
    if (!user) {
      setFormError('Sign in to log a stay request.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const result = await api<{ booking: HotelBooking; notice: string }>('/bookings/hotels', {
        method: 'POST',
        body: { hotelId: data.place.id, checkIn, checkOut, rooms, guests },
      });
      setBooking({ ...result.booking, notice: result.notice });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not log the request');
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="wrap" style={{ paddingTop: 60 }}>
        <Empty title="Hotel not found">{error}</Empty>
      </div>
    );
  }
  if (!data) return <div className="wrap"><Loading label="Opening hotel" /></div>;

  const { place, destination } = data;
  const address = String(place.extra.address ?? '');
  const amenities = place.tags;

  return (
    <div className="wrap">
      <div className="breadcrumb" style={{ paddingTop: 22 }}>
        <Link to="/hotels">Hotels</Link>
        <span>/</span>
        <Link to={`/explore/${place.destination.slug}`}>{place.destination.name}</Link>
        <span>/</span>
        <span>{place.name}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(0, 1fr)', gap: 14, marginBottom: 26 }}>
        <div style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden', minHeight: 380 }}>
          <img src={place.image} alt={place.name} style={{ width: '100%', height: '100%', objectFit: 'cover', minHeight: 380 }} />
        </div>
        <div className="col" style={{ gap: 14 }}>
          <div style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden', flex: 1, maxHeight: 183 }}>
            <img src={destination?.image ?? place.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          <div style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden', flex: 1, maxHeight: 183 }}>
            <img src="/images/food.jpg" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        </div>
      </div>

      <div className="split">
        <div>
          <div className="row row-wrap" style={{ gap: 8, marginBottom: 12 }}>
            <span className="tag tag-gold">{place.kind}</span>
            <span className="tag">{place.destination.name}</span>
            {place.distanceKm !== null && <span className="tag">{place.distanceKm} km from you</span>}
            <span className="tag tag-clay">Sample inventory</span>
          </div>
          <h1 style={{ fontSize: 'clamp(30px, 4vw, 46px)', fontWeight: 400 }}>{place.name}</h1>
          <div className="row row-wrap" style={{ gap: 14, marginTop: 10 }}>
            <Rating value={place.rating} reviews={place.reviews} />
            {address && <span className="muted" style={{ fontSize: 12.5 }}>{address}</span>}
          </div>

          <div className="hr" />
          <p style={{ fontSize: 14.5, lineHeight: 1.8, color: 'var(--ink-2)' }}>{place.description}</p>

          <div className="divider-label">Facilities</div>
          <div className="row row-wrap" style={{ gap: 8 }}>
            {amenities.map((item) => (
              <span className="tag tag-sage" key={item}>{item}</span>
            ))}
          </div>

          <div className="stat-grid" style={{ marginTop: 26 }}>
            <div className="stat"><b>{String(place.extra.check_in_time ?? '14:00')}</b><span>Check-in</span></div>
            <div className="stat"><b>{String(place.extra.check_out_time ?? '11:00')}</b><span>Check-out</span></div>
            <div className="stat"><b>{String(place.extra.rooms_total ?? '—')}</b><span>Rooms</span></div>
            <div className="stat"><b>{formatINR(place.price)}</b><span>Per night</span></div>
          </div>

          <section style={{ marginTop: 30 }}>
            <span className="eyebrow">Where you will be</span>
            <div style={{ marginTop: 12 }}>
              <MapView
                markers={[
                  { lat: place.lat, lng: place.lng, title: place.name, subtitle: address, kind: 'hotel' },
                  ...nearby.map((item) => ({ lat: item.lat, lng: item.lng, title: item.name, subtitle: item.tags[0], href: `/attractions/${item.slug}`, kind: 'attraction' as const })),
                ]}
                center={[place.lat, place.lng]}
                height={360}
              />
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <a
                className="link"
                style={{ fontSize: 12 }}
                href={`https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lng}#map=15/${place.lat}/${place.lng}`}
                target="_blank"
                rel="noreferrer"
              >
                Open in OpenStreetMap ↗
              </a>
            </div>
          </section>

          {nearby.length > 0 && (
            <section style={{ marginTop: 30 }}>
              <span className="eyebrow">Nearby attractions</span>
              <div className="col" style={{ gap: 10, marginTop: 12 }}>
                {nearby.map((item) => (
                  <Link key={item.id} to={`/attractions/${item.slug}`} className="row panel panel-tight" style={{ gap: 12 }}>
                    <img src={item.image} alt="" style={{ width: 54, height: 54, borderRadius: 8, objectFit: 'cover' }} />
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
            {booking ? (
              <>
                <span className="eyebrow">Request logged</span>
                <h3 style={{ fontSize: 24, margin: '8px 0 10px' }}>Reference {booking.reference}</h3>
                <div className="alert alert-ok" style={{ marginBottom: 12 }}>
                  {booking.notice ?? 'This is a demo request, not a confirmed booking.'}
                </div>
                <div className="col" style={{ gap: 8, fontSize: 12.5 }}>
                  <div className="row-between"><span className="muted">Check-in</span><strong>{booking.check_in}</strong></div>
                  <div className="row-between"><span className="muted">Check-out</span><strong>{booking.check_out}</strong></div>
                  <div className="row-between"><span className="muted">Nights / rooms</span><strong>{booking.nights} / {booking.rooms}</strong></div>
                  <div className="row-between"><span className="muted">Guests</span><strong>{booking.guests}</strong></div>
                  <div className="row-between"><span className="muted">Estimated total</span><strong>{formatINR(booking.total ?? booking.total_amount ?? total)}</strong></div>
                </div>
                <a className="btn btn-sm btn-ghost btn-block" style={{ marginTop: 14 }} href={hotelSearchUrl(place.name, place.destination.name)} target="_blank" rel="noreferrer">
                  Check live rates ↗
                </a>
                <Link to="/profile?tab=bookings" className="btn btn-sm btn-block" style={{ marginTop: 8 }}>
                  View in dashboard
                </Link>
              </>
            ) : (
              <>
                <div className="row-between">
                  <div>
                    <span className="eyebrow">From</span>
                    <div className="big-total" style={{ fontSize: 32 }}>{formatINR(place.price)}</div>
                    <span className="muted" style={{ fontSize: 11 }}>per room, per night</span>
                  </div>
                  <Rating value={place.rating} />
                </div>
                <div className="hr" style={{ margin: '16px 0' }} />
                <div className="form-grid" style={{ gap: 10 }}>
                  <div className="field">
                    <label>Check-in</label>
                    <input type="date" value={checkIn} min={todayIso()} onChange={(event) => {
                      setCheckIn(event.target.value);
                      if (event.target.value >= checkOut) setCheckOut(addDays(event.target.value, 2));
                    }} />
                  </div>
                  <div className="field">
                    <label>Check-out</label>
                    <input type="date" value={checkOut} min={addDays(checkIn, 1)} onChange={(event) => setCheckOut(event.target.value)} />
                  </div>
                  <div className="field">
                    <label>Rooms</label>
                    <input type="number" min={1} max={6} value={rooms} onChange={(event) => setRooms(Math.max(1, Number(event.target.value)))} />
                  </div>
                  <div className="field">
                    <label>Guests</label>
                    <input type="number" min={1} max={12} value={guests} onChange={(event) => setGuests(Math.max(1, Number(event.target.value)))} />
                  </div>
                </div>
                <div className="col" style={{ gap: 5, marginTop: 14, fontSize: 12.5 }}>
                  <div className="row-between"><span className="muted">{formatINR(place.price)} × {rooms} room{rooms > 1 ? 's' : ''} × {nights} night{nights > 1 ? 's' : ''}</span><strong>{formatINR(total)}</strong></div>
                  <div className="row-between"><span className="muted">Taxes and fees</span><span>At property</span></div>
                </div>
                {formError && <div style={{ marginTop: 10 }}><Alert tone="error">{formError}</Alert></div>}
                <button type="button" className="btn btn-block" style={{ marginTop: 14 }} onClick={requestStay} disabled={busy}>
                  {busy ? 'Logging request…' : 'Request this stay'}
                </button>
                <p className="form-note" style={{ marginTop: 10 }}>
                  Demo mode: this logs a request in your dashboard. No payment is taken and no room is held. We will show
                  the live partner link so you can confirm the real booking.
                </p>
                <a className="btn btn-sm btn-ghost btn-block" href={hotelSearchUrl(place.name, place.destination.name)} target="_blank" rel="noreferrer">
                  Check live availability ↗
                </a>
                <div style={{ marginTop: 12 }}>
                  <SaveButton placeType="hotel" placeId={place.id} label="Save hotel" />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
