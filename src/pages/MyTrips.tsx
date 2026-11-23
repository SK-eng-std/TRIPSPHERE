import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { dateRange, formatINR, todayIso } from '../lib/geo';
import type { Trip } from '../lib/types';
import AuthGuard from '../components/AuthGuard';
import { Empty, Loading, Tabs } from '../components/UI';

type Filter = 'upcoming' | 'past' | 'all';

export default function MyTrips() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('upcoming');

  useEffect(() => {
    api<{ trips: Trip[] }>('/trips')
      .then((data) => setTrips(data.trips))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const today = todayIso();
  const filtered = trips.filter((trip) => {
    if (filter === 'all') return true;
    const isPast = (trip.end_date && trip.end_date < today) || trip.status === 'completed';
    return filter === 'past' ? isPast : !isPast;
  });

  return (
    <AuthGuard title="Your trips live here">
      <div className="wrap">
        <header className="page-head">
          <span className="eyebrow">My trips</span>
          <h1>Every plan in one place.</h1>
          <p>Saved itineraries, with dates, travellers, budget and a full day-by-day editor.</p>
        </header>

        <div className="row-between" style={{ marginBottom: 18 }}>
          <Tabs<Filter>
            tabs={[
              { id: 'upcoming', label: `Upcoming (${trips.filter((t) => !((t.end_date && t.end_date < today) || t.status === 'completed')).length})` },
              { id: 'past', label: 'Previous' },
              { id: 'all', label: 'All' },
            ]}
            value={filter}
            onChange={setFilter}
          />
          <Link to="/plan" className="btn btn-sm">New trip</Link>
        </div>

        {loading && <Loading label="Gathering your trips" />}
        {!loading && filtered.length === 0 && (
          <Empty title="No trips here yet">
            <p style={{ marginBottom: 16 }}>Start with a destination and a date range — the planner does the rest.</p>
            <Link to="/plan" className="btn btn-sm">Plan my first trip</Link>
          </Empty>
        )}

        <div className="grid grid-2">
          {filtered.map((trip) => (
            <div className="place-card" key={trip.id}>
              <Link to={`/trips/${trip.id}`} className="dest-media" style={{ aspectRatio: '16 / 8' }}>
                <img src={trip.destination_image ?? trip.destination?.image ?? '/images/hero.jpg'} alt="" />
                <span className="float-tag">{trip.status}</span>
              </Link>
              <div className="place-body">
                <div className="dest-meta">
                  <span>{trip.destination_name ?? trip.destination?.name ?? 'Multi-stop'}</span>
                  <span>·</span>
                  <span>{trip.item_count ?? trip.items?.length ?? 0} stops</span>
                </div>
                <Link to={`/trips/${trip.id}`}>
                  <h3 className="place-title">{trip.title}</h3>
                </Link>
                <p className="dest-summary">{dateRange(trip.start_date, trip.end_date)}</p>
                <div className="dest-foot">
                  <span>{trip.travellers} traveller{trip.travellers > 1 ? 's' : ''}</span>
                  <span style={{ fontWeight: 600 }}>{formatINR(trip.budget)}</span>
                </div>
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <Link to={`/trips/${trip.id}`} className="btn btn-sm">Open</Link>
                  <Link to={`/budget?itinerary=${trip.id}`} className="btn btn-sm btn-ghost">Budget</Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AuthGuard>
  );
}
