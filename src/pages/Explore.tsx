import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useGeo } from '../lib/geo';
import type { Destination } from '../lib/types';
import { DestinationCard } from '../components/Cards';
import { Chip, Empty, Loading, SectionHead } from '../components/UI';

const REGIONS = ['North', 'South', 'West', 'East', 'Islands'];
const INTERESTS = ['heritage', 'nature', 'adventure', 'beach', 'food', 'relaxation', 'wildlife', 'photography'];

export default function Explore() {
  const [params, setParams] = useSearchParams();
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const geo = useGeo();

  const q = params.get('q') ?? '';
  const region = params.get('region') ?? '';
  const interest = params.get('interest') ?? '';
  const hidden = params.get('hidden') === '1';
  const sort = params.get('sort') ?? 'popularity';

  useEffect(() => {
    setLoading(true);
    setError(null);
    api<{ destinations: Destination[] }>(
      `/destinations${qs({
        q,
        region,
        interest,
        hidden: hidden ? 1 : undefined,
        limit: 60,
        lat: geo.lat ?? undefined,
        lng: geo.lng ?? undefined,
      })}`,
    )
      .then((data) => setDestinations(data.destinations))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load destinations'))
      .finally(() => setLoading(false));
  }, [q, region, interest, hidden, geo.lat, geo.lng]);

  function update(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  const sorted = [...destinations].sort((a, b) => {
    if (sort === 'distance') return (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9);
    if (sort === 'budget') return a.avg_daily_budget - b.avg_daily_budget;
    if (sort === 'days') return b.ideal_days - a.ideal_days;
    return b.popularity - a.popularity;
  });

  return (
    <div className="wrap">
      <header className="page-head">
        <span className="eyebrow">Explore</span>
        <h1>Find the India you want to see.</h1>
        <p>
          Twenty-one destinations across the country, from the boulder fields of Hampi to the backwaters of Kerala. Filter
          by region, interest and budget, or sort by what is closest to you right now.
        </p>
      </header>

      <div className="toolbar">
        <div className="field grow" style={{ maxWidth: 320 }}>
          <label>Search</label>
          <input
            value={q}
            placeholder="Destination, state or keyword"
            onChange={(event) => update('q', event.target.value || null)}
          />
        </div>
        <div className="field">
          <label>Interest</label>
          <select value={interest} onChange={(event) => update('interest', event.target.value || null)}>
            <option value="">Any interest</option>
            {INTERESTS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Sort</label>
          <select value={sort} onChange={(event) => update('sort', event.target.value)}>
            <option value="popularity">Most popular</option>
            <option value="distance">Closest to me</option>
            <option value="budget">Lowest daily budget</option>
            <option value="days">Longest escape</option>
          </select>
        </div>
        <div className="spacer" />
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => {
            if (geo.status === 'ready') update('sort', 'distance');
            else geo.request();
          }}
        >
          {geo.status === 'loading' ? 'Locating…' : geo.status === 'ready' ? 'Using my location' : 'Use my location'}
        </button>
      </div>

      <div className="chip-row" style={{ marginBottom: 14 }}>
        <Chip active={!region} onClick={() => update('region', null)}>
          All regions
        </Chip>
        {REGIONS.map((item) => (
          <Chip key={item} active={region === item} onClick={() => update('region', item)}>
            {item}
          </Chip>
        ))}
        <span style={{ width: 1, background: 'var(--line)', margin: '0 6px' }} />
        <Chip active={hidden} onClick={() => update('hidden', hidden ? null : '1')}>
          Hidden gems only
        </Chip>
      </div>

      {geo.error && <div className="alert alert-info" style={{ marginBottom: 16 }}>{geo.error}</div>}

      <div className="row-between" style={{ marginBottom: 18 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {loading ? 'Searching…' : `${sorted.length} destination${sorted.length === 1 ? '' : 's'}`}
          {region ? ` in ${region} India` : ''}
        </span>
        {(q || region || interest || hidden) && (
          <button type="button" className="link" style={{ background: 'none', border: 0 }} onClick={() => setParams(new URLSearchParams())}>
            Clear filters
          </button>
        )}
      </div>

      {loading && <Loading label="Gathering destinations" />}
      {error && <div className="alert alert-error">{error}</div>}
      {!loading && !error && sorted.length === 0 && (
        <Empty title="No destinations match that yet">
          Try a broader interest or clear the region filter.
        </Empty>
      )}

      <div className="dest-grid" style={{ paddingBottom: 20 }}>
        {sorted.map((destination) => (
          <DestinationCard key={destination.id} destination={destination} />
        ))}
      </div>

      <section className="section">
        <SectionHead
          eyebrow="Not sure yet?"
          title="Let the planner decide"
          desc="Give the AI planner a date range and a budget; it will pick a destination and build the days around your interests."
          action={
            <a href="/plan" className="btn btn-sm">
              Open the planner
            </a>
          }
        />
      </section>
    </div>
  );
}
