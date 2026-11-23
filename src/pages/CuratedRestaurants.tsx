import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { formatINR, useGeo } from '../lib/geo';
import type { Destination, Place } from '../lib/types';
import { PlaceRow } from '../components/Cards';
import MapView from '../components/MapView';
import { Chip, Empty, Loading } from '../components/UI';

const CUISINES = ['South Indian', 'Kerala', 'Seafood', 'Rajasthani', 'Goan', 'Tibetan', 'Cafe', 'Continental', 'Kodava', 'Mughlai'];
const BANDS = [
  { label: 'Any budget', min: 0, max: 0 },
  { label: 'Under ₹700 for two', min: 0, max: 700 },
  { label: '₹700 – ₹1,500', min: 700, max: 1500 },
  { label: '₹1,500 +', min: 1500, max: 0 },
];

export default function Restaurants() {
  const [params, setParams] = useSearchParams();
  const geo = useGeo();
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cuisine, setCuisine] = useState('');
  const [band, setBand] = useState(0);
  const [rating, setRating] = useState('');
  const [sort, setSort] = useState('recommended');

  const destinationId = params.get('destination') ?? '';

  useEffect(() => {
    api<{ destinations: Destination[] }>('/destinations?limit=60')
      .then((data) => setDestinations(data.destinations))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const price = BANDS[band];
    api<{ places: Place[] }>(
      `/places${qs({
        type: 'restaurant',
        destinationId: destinationId || undefined,
        cuisine: cuisine || undefined,
        minPrice: price.min || undefined,
        maxPrice: price.max || undefined,
        minRating: rating || undefined,
        sort,
        lat: geo.lat ?? undefined,
        lng: geo.lng ?? undefined,
        limit: 40,
      })}`,
    )
      .then((data) => setPlaces(data.places))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load restaurants'))
      .finally(() => setLoading(false));
  }, [destinationId, cuisine, band, rating, sort, geo.lat, geo.lng]);

  const markers = useMemo(
    () =>
      places.map((place) => ({
        lat: place.lat,
        lng: place.lng,
        title: place.name,
        subtitle: `${place.tags.slice(0, 2).join(', ')} · ${formatINR(place.price)} for two`,
        href: `/restaurants/${place.slug}`,
        kind: 'restaurant' as const,
      })),
    [places],
  );

  return (
    <div className="wrap">
      <header className="page-head">
        <span className="eyebrow">Curated sample inventory</span>
        <h1>Eat where the trip is.</h1>
        <p>
          From toddy-shop fish curry to courtyard Portuguese dinners. These are editorial samples used by the planner;
          table requests are logged to your account, never confirmed automatically.
        </p>
        <p style={{ marginTop: 10 }}>
          <Link to="/restaurants" className="link">
            ← See live restaurants near any location
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
              <option key={destination.id} value={destination.id}>{destination.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Budget for two</label>
          <select value={band} onChange={(event) => setBand(Number(event.target.value))}>
            {BANDS.map((option, index) => (
              <option key={option.label} value={index}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Rating</label>
          <select value={rating} onChange={(event) => setRating(event.target.value)}>
            <option value="">Any rating</option>
            <option value="4.2">4.2 and above</option>
            <option value="4.4">4.4 and above</option>
          </select>
        </div>
        <div className="field">
          <label>Sort</label>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="recommended">Recommended</option>
            <option value="rating">Highest rated</option>
            <option value="price">Lowest price</option>
            <option value="distance">Closest to me</option>
          </select>
        </div>
        <div className="spacer" />
        <button type="button" className="btn btn-sm btn-ghost" onClick={geo.request}>
          {geo.status === 'loading' ? 'Locating…' : 'Near me'}
        </button>
      </div>

      <div className="chip-row" style={{ marginBottom: 20 }}>
        {CUISINES.map((item) => (
          <Chip key={item} active={cuisine === item} onClick={() => setCuisine(cuisine === item ? '' : item)}>
            {item}
          </Chip>
        ))}
      </div>

      {loading && <Loading label="Finding tables" />}
      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!loading && places.length === 0 && <Empty title="No restaurants match those filters">Try another cuisine or budget.</Empty>}

      {!loading && places.length > 0 && (
        <div className="split">
          <div>
            <div className="row-between" style={{ marginBottom: 12 }}>
              <span className="muted" style={{ fontSize: 12 }}>{places.length} places to eat</span>
              <span className="muted" style={{ fontSize: 11 }}>Sample inventory · request mode</span>
            </div>
            <div className="place-list">
              {places.map((place) => (
                <PlaceRow key={place.id} place={place} />
              ))}
            </div>
          </div>
          <div className="side">
            <div className="sticky">
              <MapView markers={markers} height={440} />
              <div className="map-legend">
                <span><i style={{ background: 'var(--sage)' }} />Restaurants</span>
                <span>Click a pin for details</span>
              </div>
              <div className="panel" style={{ marginTop: 16 }}>
                <span className="eyebrow">Reservations</span>
                <p className="form-note" style={{ marginTop: 8 }}>
                  Table requests are logged against your account and show up in the dashboard. A venue confirmation is
                  never simulated — use the external booking link for a live table.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
