import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { formatINR, useGeo } from '../lib/geo';
import type { Destination, Guide, Place } from '../lib/types';
import { PlaceCard, PlaceRow } from '../components/Cards';
import MapView from '../components/MapView';
import { Empty, Loading, SaveButton, Tabs } from '../components/UI';

interface Payload {
  destination: Destination;
  attractions: Place[];
  hotels: Place[];
  restaurants: Place[];
  guides: Guide[];
}

type Tab = 'overview' | 'attractions' | 'hotels' | 'restaurants' | 'map';

export default function DestinationDetail() {
  const { slug = '' } = useParams();
  const [data, setData] = useState<Payload | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState<string | null>(null);
  const geo = useGeo();

  useEffect(() => {
    setData(null);
    setError(null);
    api<Payload>(`/destinations/${slug}${qs({ lat: geo.lat ?? undefined, lng: geo.lng ?? undefined })}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Destination not found'));
  }, [slug, geo.lat, geo.lng]);

  if (error) {
    return (
      <div className="wrap" style={{ paddingTop: 60 }}>
        <Empty title="We could not open that destination">{error}</Empty>
      </div>
    );
  }
  if (!data) return <div className="wrap"><Loading label="Opening destination" /></div>;

  const { destination, attractions, hotels, restaurants, guides } = data;
  const markers = [
    ...attractions.map((place) => ({ lat: place.lat, lng: place.lng, title: place.name, subtitle: place.tags[0], kind: 'attraction' as const, href: `/attractions/${place.slug}` })),
    ...hotels.map((place) => ({ lat: place.lat, lng: place.lng, title: place.name, subtitle: `${formatINR(place.price)} / night`, kind: 'hotel' as const, href: `/hotels/${place.slug}` })),
    ...restaurants.map((place) => ({ lat: place.lat, lng: place.lng, title: place.name, subtitle: place.tags.slice(0, 2).join(', '), kind: 'restaurant' as const, href: `/restaurants/${place.slug}` })),
  ];

  return (
    <div className="wrap">
      <div className="breadcrumb" style={{ paddingTop: 22 }}>
        <Link to="/explore">Explore</Link>
        <span>/</span>
        <span>{destination.state}</span>
        <span>/</span>
        <span>{destination.name}</span>
      </div>

      <div style={{ position: 'relative', borderRadius: 'var(--radius-xl)', overflow: 'hidden', minHeight: 380, display: 'flex', alignItems: 'flex-end' }}>
        <img src={destination.image} alt={destination.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(9,20,16,.15) 20%, rgba(9,20,16,.82) 100%)' }} />
        <div style={{ position: 'relative', padding: 'clamp(22px, 4vw, 48px)', color: 'var(--sand)', width: '100%' }}>
          <div className="row row-wrap" style={{ gap: 8, marginBottom: 12 }}>
            {destination.unesco && <span className="tag tag-gold">UNESCO World Heritage</span>}
            {destination.is_hidden && <span className="tag tag-clay">Hidden gem</span>}
            <span className="tag">{destination.region} India</span>
          </div>
          <h1 style={{ fontSize: 'clamp(38px, 6vw, 74px)', fontWeight: 400, letterSpacing: '-0.03em' }}>{destination.name}</h1>
          <p style={{ maxWidth: 560, marginTop: 8, fontSize: 14.5, color: 'rgba(247,241,230,.82)', lineHeight: 1.7 }}>{destination.tagline}</p>
          <div className="row row-wrap" style={{ gap: 10, marginTop: 20 }}>
            <Link
              to={`/plan?destination=${destination.slug}&days=${destination.ideal_days}`}
              className="btn btn-accent btn-sm"
            >
              Plan this trip
            </Link>
            <SaveButton placeType="destination" placeId={destination.id} label="Save destination" />
          </div>
        </div>
      </div>

      <div className="stat-grid" style={{ marginTop: 18 }}>
        <div className="stat"><b>{destination.ideal_days}</b><span>Ideal days</span></div>
        <div className="stat"><b>{formatINR(destination.avg_daily_budget)}</b><span>Daily budget</span></div>
        <div className="stat"><b>{destination.best_season}</b><span>Best season</span></div>
        <div className="stat"><b>{destination.attraction_count}</b><span>Attractions</span></div>
        <div className="stat"><b>{destination.distanceKm !== null ? `${destination.distanceKm} km` : '—'}</b><span>From you</span></div>
      </div>

      <div style={{ marginTop: 30 }}>
        <Tabs<Tab>
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'attractions', label: `Attractions (${attractions.length})` },
            { id: 'hotels', label: `Hotels (${hotels.length})` },
            { id: 'restaurants', label: `Restaurants (${restaurants.length})` },
            { id: 'map', label: 'Map' },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === 'overview' && (
          <div className="split">
            <div>
              <div className="rte" style={{ maxWidth: 700 }}>
                <p>{destination.description}</p>
                <p>{destination.summary}</p>
              </div>
              <div className="row row-wrap" style={{ gap: 6, marginTop: 8 }}>
                {destination.interests.map((interest) => (
                  <Link key={interest} to={`/explore?interest=${interest}`} className="tag tag-sage">
                    {interest}
                  </Link>
                ))}
              </div>

              {guides.length > 0 && (
                <section style={{ marginTop: 38 }}>
                  <span className="eyebrow">Field notes</span>
                  <h3 style={{ fontSize: 26, margin: '8px 0 16px' }}>Read before you go</h3>
                  <div className="col" style={{ gap: 12 }}>
                    {guides.map((guide) => (
                      <Link key={guide.slug} to={`/guides/${guide.slug}`} className="row panel panel-tight" style={{ gap: 14 }}>
                        <img src={guide.image} alt="" style={{ width: 74, height: 74, objectFit: 'cover', borderRadius: 10 }} />
                        <div className="grow">
                          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{guide.title}</div>
                          <div className="muted" style={{ fontSize: 11.5 }}>{guide.read_minutes} min read · {guide.category}</div>
                        </div>
                        <span>→</span>
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </div>

            <div className="side">
              <div className="panel">
                <span className="eyebrow">Good to know</span>
                <div className="col" style={{ gap: 12, marginTop: 12 }}>
                  <div className="row-between"><span className="muted" style={{ fontSize: 12 }}>State</span><strong style={{ fontSize: 12.5 }}>{destination.state}</strong></div>
                  <div className="row-between"><span className="muted" style={{ fontSize: 12 }}>Best season</span><strong style={{ fontSize: 12.5 }}>{destination.best_season}</strong></div>
                  <div className="row-between"><span className="muted" style={{ fontSize: 12 }}>Suggested stay</span><strong style={{ fontSize: 12.5 }}>{destination.ideal_days} days</strong></div>
                  <div className="row-between"><span className="muted" style={{ fontSize: 12 }}>Average daily spend</span><strong style={{ fontSize: 12.5 }}>{formatINR(destination.avg_daily_budget)}</strong></div>
                  <div className="row-between"><span className="muted" style={{ fontSize: 12 }}>Stays from</span><strong style={{ fontSize: 12.5 }}>{destination.from_price ? formatINR(destination.from_price) : '—'}</strong></div>
                </div>
                <Link to={`/budget?destination=${destination.id}`} className="btn btn-sm btn-ghost btn-block" style={{ marginTop: 16 }}>
                  Estimate this trip
                </Link>
              </div>

              <div className="panel">
                <span className="eyebrow">Nearby stays</span>
                <div className="col" style={{ gap: 12, marginTop: 12 }}>
                  {hotels.slice(0, 3).map((hotel) => (
                    <Link key={hotel.id} to={`/hotels/${hotel.slug}`} className="row" style={{ gap: 10 }}>
                      <img src={hotel.image} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hotel.name}</div>
                        <div className="muted" style={{ fontSize: 10.5 }}>{formatINR(hotel.price)} / night · {hotel.rating}★</div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'attractions' && (
          <div className="dest-grid">
            {attractions.map((place) => (
              <PlaceCard key={place.id} place={place} />
            ))}
          </div>
        )}

        {tab === 'hotels' && (
          <div className="place-list">
            {hotels.map((place) => (
              <PlaceRow key={place.id} place={place} />
            ))}
          </div>
        )}

        {tab === 'restaurants' && (
          <div className="place-list">
            {restaurants.map((place) => (
              <PlaceRow key={place.id} place={place} />
            ))}
          </div>
        )}

        {tab === 'map' && (
          <div>
            <MapView markers={markers} center={[destination.lat, destination.lng]} zoom={12} height={480} />
            <div className="map-legend">
              <span><i style={{ background: 'var(--clay)' }} />Attractions</span>
              <span><i style={{ background: 'var(--gold)' }} />Hotels</span>
              <span><i style={{ background: 'var(--sage)' }} />Restaurants</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
