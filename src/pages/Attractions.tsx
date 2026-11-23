import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { formatINR, useGeo } from '../lib/geo';
import type { Destination, Place } from '../lib/types';
import { PlaceCard } from '../components/Cards';
import MapView from '../components/MapView';
import { Chip, Empty, Loading } from '../components/UI';

const CATEGORIES = ['heritage', 'temple', 'nature', 'waterfall', 'beach', 'hill', 'museum', 'adventure', 'wildlife', 'cultural'];
const RADII = [5, 10, 25, 50];

export default function Attractions() {
  const [params, setParams] = useSearchParams();
  const geo = useGeo();
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [radius, setRadius] = useState<number | null>(null);
  const [hidden, setHidden] = useState(false);
  const [query, setQuery] = useState(params.get('q') ?? '');

  const destinationId = params.get('destination') ?? '';
  const needsLocation = radius !== null && geo.status !== 'ready';

  useEffect(() => {
    api<{ destinations: Destination[] }>('/destinations?limit=60')
      .then((data) => setDestinations(data.destinations))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (needsLocation) return;
    setLoading(true);
    setError(null);
    api<{ places: Place[] }>(
      `/places${qs({
        type: 'attraction',
        destinationId: destinationId || undefined,
        category: category || undefined,
        hidden: hidden ? 1 : undefined,
        q: query || undefined,
        radius: radius ?? undefined,
        lat: geo.lat ?? undefined,
        lng: geo.lng ?? undefined,
        sort: radius !== null ? 'distance' : 'recommended',
        limit: 48,
      })}`,
    )
      .then((data) => setPlaces(data.places))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load attractions'))
      .finally(() => setLoading(false));
  }, [destinationId, category, hidden, query, radius, geo.lat, geo.lng, needsLocation]);

  const markers = useMemo(
    () =>
      places.map((place) => ({
        lat: place.lat,
        lng: place.lng,
        title: place.name,
        subtitle: `${place.tags[0]} · ${place.price > 0 ? formatINR(place.price) : 'Free'}`,
        href: `/attractions/${place.slug}`,
        kind: 'attraction' as const,
      })),
    [places],
  );

  return (
    <div className="wrap">
      <header className="page-head">
        <span className="eyebrow">Attractions</span>
        <h1>Everything within reach.</h1>
        <p>
          Monuments, waterfalls, beaches, museums and the quieter places in between. Filter by distance from where you
          are, then add anything worth seeing straight into an itinerary.
        </p>
      </header>

      <div className="toolbar">
        <div className="field grow" style={{ maxWidth: 280 }}>
          <label>Search</label>
          <input value={query} placeholder="Temple, fort, waterfall…" onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="field" style={{ maxWidth: 240 }}>
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
        <div className="spacer" />
        <Chip active={hidden} onClick={() => setHidden((v) => !v)}>Hidden gems</Chip>
      </div>

      <div className="row row-wrap" style={{ marginBottom: 10, gap: 8 }}>
        <span className="eyebrow" style={{ alignSelf: 'center' }}>Distance</span>
        <Chip active={radius === null} onClick={() => setRadius(null)}>Any distance</Chip>
        {RADII.map((value) => (
          <Chip
            key={value}
            active={radius === value}
            onClick={() => {
              setRadius(value);
              if (geo.status !== 'ready') geo.request();
            }}
          >
            Within {value} km
          </Chip>
        ))}
      </div>

      <div className="chip-row" style={{ marginBottom: 22 }}>
        <Chip active={!category} onClick={() => setCategory('')}>All types</Chip>
        {CATEGORIES.map((item) => (
          <Chip key={item} active={category === item} onClick={() => setCategory(category === item ? '' : item)}>
            {item}
          </Chip>
        ))}
      </div>

      {geo.error && <div className="alert alert-info" style={{ marginBottom: 16 }}>{geo.error}</div>}
      {needsLocation && (
        <div className="alert alert-info" style={{ marginBottom: 16 }}>
          Allow location access to filter by distance, or choose another distance option.
        </div>
      )}
      {loading && <Loading label="Mapping attractions" />}
      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
      {!loading && places.length === 0 && (
        <Empty title="Nothing in that radius yet">
          Widen the distance, change the category, or search a destination instead.
        </Empty>
      )}

      {!loading && places.length > 0 && (
        <>
          <div className="row-between" style={{ marginBottom: 14 }}>
            <span className="muted" style={{ fontSize: 12 }}>{places.length} attractions{radius ? ` within ${radius} km` : ''}</span>
            <Link to="/plan" className="link" style={{ fontSize: 12 }}>Add these to a trip →</Link>
          </div>
          <div className="dest-grid">
            {places.map((place) => (
              <PlaceCard key={place.id} place={place} />
            ))}
          </div>
          <section style={{ marginTop: 32 }}>
            <MapView markers={markers} height={440} />
            <div className="map-legend">
              <span><i style={{ background: 'var(--clay)' }} />Attractions</span>
              <span>Distances are road estimates</span>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
