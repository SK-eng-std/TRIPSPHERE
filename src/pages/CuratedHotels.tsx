import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { formatINR, useGeo } from '../lib/geo';
import type { Destination, Place } from '../lib/types';
import { PlaceRow } from '../components/Cards';
import MapView from '../components/MapView';
import { Chip, Empty, Loading } from '../components/UI';

const PRICE_BANDS = [
  { label: 'Any price', min: 0, max: 0 },
  { label: 'Under ₹2,500', min: 0, max: 2500 },
  { label: '₹2,500 – ₹5,000', min: 2500, max: 5000 },
  { label: '₹5,000 +', min: 5000, max: 0 },
];

const AMENITIES = ['Pool', 'Breakfast included', 'Free Wi-Fi', 'Spa', 'Beach access', 'Air conditioning', 'Parking', 'Restaurant'];

export default function Hotels() {
  const [params, setParams] = useSearchParams();
  const geo = useGeo();
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [priceBand, setPriceBand] = useState(0);
  const [rating, setRating] = useState('');
  const [amenity, setAmenity] = useState('');
  const [sort, setSort] = useState('recommended');
  const [view, setView] = useState<'list' | 'map'>('list');

  const destinationId = params.get('destination') ?? '';

  useEffect(() => {
    api<{ destinations: Destination[] }>('/destinations?limit=60')
      .then((data) => setDestinations(data.destinations))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const band = PRICE_BANDS[priceBand];
    api<{ places: Place[] }>(
      `/places${qs({
        type: 'hotel',
        destinationId: destinationId || undefined,
        minPrice: band.min || undefined,
        maxPrice: band.max || undefined,
        minRating: rating || undefined,
        amenity: amenity || undefined,
        sort,
        lat: geo.lat ?? undefined,
        lng: geo.lng ?? undefined,
        limit: 40,
      })}`,
    )
      .then((data) => setPlaces(data.places))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load hotels'))
      .finally(() => setLoading(false));
  }, [destinationId, priceBand, rating, amenity, sort, geo.lat, geo.lng]);

  const markers = useMemo(
    () =>
      places.map((place) => ({
        lat: place.lat,
        lng: place.lng,
        title: place.name,
        subtitle: `${formatINR(place.price)} / night · ${place.rating}★`,
        href: `/hotels/${place.slug}`,
        kind: 'hotel' as const,
      })),
    [places],
  );

  return (
    <div className="wrap">
      <header className="page-head">
        <span className="eyebrow">Curated sample inventory</span>
        <h1>Our hand-picked stays.</h1>
        <p>
          The editorial inventory the trip planner uses — homestays, heritage houses and small resorts with
          request-based booking. Rates are illustrative, not live availability.
        </p>
        <p style={{ marginTop: 10 }}>
          <Link to="/hotels" className="link">
            ← See live hotels near any location
          </Link>
        </p>
      </header>

      <div className="toolbar">
        <div className="field grow" style={{ maxWidth: 300 }}>
          <label>Destination</label>
          <select
            value={destinationId}
            onChange={(event) => {
              const next = new URLSearchParams(params);
              if (event.target.value) next.set('destination', event.target.value);
              else next.delete('destination');
              setParams(next, { replace: true });
            }}
          >
            <option value="">All destinations</option>
            {destinations.map((destination) => (
              <option key={destination.id} value={destination.id}>
                {destination.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Price per night</label>
          <select value={priceBand} onChange={(event) => setPriceBand(Number(event.target.value))}>
            {PRICE_BANDS.map((band, index) => (
              <option key={band.label} value={index}>
                {band.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Rating</label>
          <select value={rating} onChange={(event) => setRating(event.target.value)}>
            <option value="">Any rating</option>
            <option value="4.2">4.2 and above</option>
            <option value="4.5">4.5 and above</option>
          </select>
        </div>
        <div className="field">
          <label>Sort</label>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="recommended">Recommended</option>
            <option value="price">Lowest price</option>
            <option value="rating">Highest rated</option>
            <option value="distance">Closest to me</option>
          </select>
        </div>
        <div className="spacer" />
        <div className="segmented">
          <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>List</button>
          <button type="button" className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}>Map</button>
        </div>
      </div>

      <div className="chip-row" style={{ marginBottom: 20 }}>
        {AMENITIES.map((item) => (
          <Chip key={item} active={amenity === item} onClick={() => setAmenity(amenity === item ? '' : item)}>
            {item}
          </Chip>
        ))}
      </div>

      {geo.status !== 'ready' && (
        <div className="row" style={{ marginBottom: 16 }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={geo.request} disabled={geo.status === 'loading'}>
            {geo.status === 'loading' ? 'Locating…' : 'Search near my location'}
          </button>
          {geo.error && <span className="muted" style={{ fontSize: 11.5 }}>{geo.error}</span>}
        </div>
      )}

      {loading && <Loading label="Finding stays" />}
      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!loading && places.length === 0 && (
        <Empty title="No stays match these filters">
          Try a wider price range or a different destination.
        </Empty>
      )}

      {!loading && places.length > 0 && (
        <div className="split">
          <div>
            <div className="row-between" style={{ marginBottom: 12 }}>
              <span className="muted" style={{ fontSize: 12 }}>{places.length} stays</span>
              <span className="muted" style={{ fontSize: 11 }}>Sample inventory · request mode</span>
            </div>
            <div className="place-list">
              {places.map((place) => (
                <PlaceRow key={place.id} place={place} />
              ))}
            </div>
            <p className="form-note" style={{ marginTop: 18 }}>
              Demo mode is active for bookings: a request is logged to your account, no payment is taken and no room is
              held. Use the property's live booking link to confirm.
            </p>
          </div>
          <div className="side">
            <div className="sticky">
              <MapView markers={markers} height={view === 'map' ? 560 : 400} />
              <div className="map-legend">
                <span><i style={{ background: 'var(--gold)' }} />Hotels</span>
                <span>Click a pin for details</span>
              </div>
              <div className="panel" style={{ marginTop: 16 }}>
                <span className="eyebrow">Booking partners</span>
                <p className="form-note" style={{ marginTop: 8 }}>
                  Live availability is handled by external partners. Each hotel page links to a real search so you can
                  compare current rates.
                </p>
                <Link to="/plan" className="btn btn-sm btn-ghost btn-block" style={{ marginTop: 12 }}>
                  Add a stay to an itinerary
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
