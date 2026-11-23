import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { dateRange, formatDate, formatINR } from '../lib/geo';
import { useAuth } from '../lib/auth';
import type { PassportEntry, Photo, Trip } from '../lib/types';
import AuthGuard from '../components/AuthGuard';
import { Empty, Loading, Stat } from '../components/UI';

interface DashboardPayload {
  trips: { upcoming: Trip[]; past: Trip[]; all: Trip[] };
  photos: Photo[];
  passport: { entries: number; destinations: number; unesco: number };
}

interface PassportPayload {
  entries: PassportEntry[];
}

type Event = {
  key: string;
  date: string;
  kind: 'trip' | 'stamp' | 'photo';
  title: string;
  subtitle: string;
  href?: string;
  image?: string;
};

export default function History() {
  const { user } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [stamps, setStamps] = useState<PassportEntry[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [stats, setStats] = useState({ destinations: 0, entries: 0, unesco: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    Promise.all([
      api<DashboardPayload>('/dashboard'),
      api<PassportPayload>('/passport'),
    ])
      .then(([dashboard, passport]) => {
        setTrips(dashboard.trips.all ?? []);
        setPhotos(dashboard.photos ?? []);
        setStats(dashboard.passport ?? { destinations: 0, entries: 0, unesco: 0 });
        setStamps(passport.entries ?? []);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [user]);

  const events = useMemo(() => {
    const list: Event[] = [];
    for (const trip of trips) {
      const date = trip.end_date || trip.start_date || '';
      if (!date) continue;
      list.push({
        key: `trip-${trip.id}`,
        date,
        kind: 'trip',
        title: trip.title,
        subtitle: `${dateRange(trip.start_date, trip.end_date)} · ${trip.travellers} travellers · ${formatINR(trip.budget)}`,
        href: `/trips/${trip.id}`,
        image: trip.destination_image ?? trip.destination?.image,
      });
    }
    for (const stamp of stamps) {
      list.push({
        key: `stamp-${stamp.id}`,
        date: stamp.visited_on,
        kind: 'stamp',
        title: stamp.destination_name,
        subtitle: stamp.notes || `${stamp.state} · passport stamp`,
        href: `/explore/${stamp.destination_slug}`,
        image: stamp.image,
      });
    }
    for (const photo of photos) {
      list.push({
        key: `photo-${photo.id}`,
        date: photo.created_at.slice(0, 10),
        kind: 'photo',
        title: photo.caption || 'Travel memory',
        subtitle: photo.destination_name ?? 'Photo',
        image: photo.url,
      });
    }
    return list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [trips, stamps, photos]);

  const yearGroups = useMemo(() => {
    const groups = new Map<string, Event[]>();
    for (const event of events) {
      const year = event.date.slice(0, 4) || 'Undated';
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year)!.push(event);
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [events]);

  return (
    <AuthGuard title="Your travel history is personal">
      <div className="wrap">
        <header className="page-head">
          <span className="eyebrow">History</span>
          <h1>The trip so far.</h1>
          <p>Every saved itinerary, passport stamp and photograph in one chronological record.</p>
        </header>

        {loading && <Loading label="Reading your travel history" />}

        {!loading && (
          <>
            <div className="stat-grid" style={{ marginBottom: 30 }}>
              <Stat label="Destinations" value={stats.destinations} />
              <Stat label="Passport stamps" value={stats.entries} />
              <Stat label="UNESCO sites" value={stats.unesco} />
              <Stat label="Trips" value={trips.length} />
              <Stat label="Photos" value={photos.length} />
            </div>

            {events.length === 0 ? (
              <Empty title="Your timeline starts with a trip">
                <p style={{ marginBottom: 16 }}>Plan something, save it, and add a passport stamp when you return.</p>
                <Link to="/plan" className="btn btn-sm">Plan a trip</Link>
              </Empty>
            ) : (
              <div className="split">
                <div>
                  {yearGroups.map(([year, list]) => (
                    <section key={year} style={{ marginBottom: 34 }}>
                      <h2 style={{ fontSize: 30, marginBottom: 18 }}>{year}</h2>
                      <div className="timeline">
                        {list.map((event) => (
                          <div className="tl-item" key={event.key}>
                            <div className="tl-date">
                              {formatDate(event.date, { day: 'numeric', month: 'long' })} · {event.kind}
                            </div>
                            <div className="row" style={{ gap: 12, marginTop: 4, alignItems: 'flex-start' }}>
                              {event.image && (
                                <img
                                  src={event.image}
                                  alt=""
                                  style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }}
                                />
                              )}
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 14 }}>
                                  {event.href ? <Link to={event.href}>{event.title}</Link> : event.title}
                                </div>
                                <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>{event.subtitle}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>

                <div className="side">
                  <div className="panel">
                    <span className="eyebrow">Travel memories</span>
                    {photos.length === 0 ? (
                      <p className="form-note" style={{ marginTop: 8 }}>
                        No photos yet. <Link to="/profile?tab=photos" className="link">Upload from your dashboard</Link>.
                      </p>
                    ) : (
                      <div className="grid grid-2" style={{ gap: 8, marginTop: 12 }}>
                        {photos.map((photo) => (
                          <img
                            key={photo.id}
                            src={photo.url}
                            alt={photo.caption ?? ''}
                            style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10 }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="panel">
                    <span className="eyebrow">Keep going</span>
                    <p className="form-note" style={{ marginTop: 8 }}>
                      Share a trip with a friend, or open the passport to see which badge is closest.
                    </p>
                    <div className="col" style={{ gap: 8, marginTop: 12 }}>
                      <Link to="/passport" className="btn btn-sm btn-ghost btn-block">Open passport</Link>
                      <Link to="/trips" className="btn btn-sm btn-ghost btn-block">All trips</Link>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AuthGuard>
  );
}
