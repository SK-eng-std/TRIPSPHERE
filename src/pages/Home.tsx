import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useGeo } from '../lib/geo';
import type { Destination, Guide, Place } from '../lib/types';
import HomeHero from '../components/HomeHero';
import { DestinationCard, PlaceRow } from '../components/Cards';
import TimeExplorer from '../components/TimeExplorer';
import { SectionHead } from '../components/UI';

export default function Home() {
  const geo = useGeo();
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [hidden, setHidden] = useState<Destination[]>([]);
  const [recommended, setRecommended] = useState<Destination[]>([]);
  const [hotels, setHotels] = useState<Place[]>([]);
  const [restaurants, setRestaurants] = useState<Place[]>([]);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [loading, setLoading] = useState(true);
  const [nearby, setNearby] = useState<Place[] | null>(null);
  const [nearbyBusy, setNearbyBusy] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      api<{ destinations: Destination[] }>('/destinations?limit=6'),
      api<{ destinations: Destination[] }>('/destinations?hidden=1&limit=3'),
      api<{ recommendations: Destination[] }>('/recommendations').catch(() => ({ recommendations: [] })),
      api<{ places: Place[] }>('/places?type=hotel&sort=rating&limit=4').catch(() => ({ places: [] })),
      api<{ places: Place[] }>('/places?type=restaurant&sort=rating&limit=4').catch(() => ({ places: [] })),
      api<{ guides: Guide[] }>('/guides').catch(() => ({ guides: [] })),
    ])
      .then(([dest, gems, recos, hotelData, restaurantData, guideData]) => {
        if (!active) return;
        setDestinations(dest.destinations);
        setHidden(gems.destinations);
        setRecommended(recos.recommendations.slice(0, 3));
        setHotels(hotelData.places.slice(0, 4));
        setRestaurants(restaurantData.places.slice(0, 4));
        setGuides(guideData.guides.slice(0, 3));
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (geo.lat === null || geo.lng === null) return;
    let active = true;
    setNearbyBusy(true);
    api<{ attractions: Place[] }>(`/nearby?lat=${geo.lat}&lng=${geo.lng}&radius=40`)
      .then((data) => {
        if (active) setNearby(data.attractions.slice(0, 4));
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setNearbyBusy(false);
      });
    return () => {
      active = false;
    };
  }, [geo.lat, geo.lng]);

  return (
    <>
      <HomeHero />

      <div className="wrap">
        <section className="section">
          <SectionHead
            eyebrow="Curated destinations"
            title="Where will you go next?"
            desc="Hand-picked corners of India, from World Heritage monuments to quiet hill towns nobody has spoiled yet."
            action={
              <Link to="/explore" className="btn btn-sm btn-ghost">
                Explore all →
              </Link>
            }
          />
          <div className="dest-grid">
            {loading
              ? Array.from({ length: 6 }).map((_, index) => (
                  <div className="skeleton" key={index} style={{ height: 310, borderRadius: 20 }} />
                ))
              : destinations.map((destination) => (
                  <DestinationCard key={destination.id} destination={destination} />
                ))}
          </div>
        </section>

        <section className="section">
          <div className="split">
            <div className="panel">
              <div className="row-between" style={{ alignItems: 'flex-start', marginBottom: 14 }}>
                <div>
                  <span className="eyebrow">Around me</span>
                  <h2 style={{ fontSize: 23, marginTop: 7 }}>Places within reach</h2>
                </div>
                {geo.status !== 'ready' && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={geo.request} disabled={geo.status === 'loading'}>
                    {geo.status === 'loading' ? 'Locating…' : 'Use my location'}
                  </button>
                )}
                {geo.status === 'ready' && <span className="tag tag-sage">Location on</span>}
              </div>

              {geo.error && <div className="alert alert-info" style={{ marginBottom: 12 }}>{geo.error}</div>}

              {geo.status === 'ready' ? (
                nearbyBusy ? (
                  <div className="loading-block" style={{ padding: '28px 0' }}>
                    <span className="spinner" /> Finding what is close by…
                  </div>
                ) : nearby && nearby.length ? (
                  <>
                    <div className="place-list">
                      {nearby.map((place) => (
                        <PlaceRow key={`${place.type}-${place.slug}`} place={place} />
                      ))}
                    </div>
                    <Link to="/attractions" className="link" style={{ display: 'inline-block', marginTop: 12, fontSize: 12 }}>
                      See everything nearby →
                    </Link>
                  </>
                ) : (
                  <p className="muted" style={{ fontSize: 12.5 }}>
                    Nothing mapped within 40 km yet. Try a city stay or explore by destination instead.
                  </p>
                )
              ) : (
                <div className="empty" style={{ padding: '26px 18px' }}>
                  <b>Share your location</b>
                  <p>We will surface monuments, parks, stays and tables within a short drive — nothing is stored on our servers.</p>
                  <button type="button" className="btn btn-sm" style={{ marginTop: 12 }} onClick={geo.request}>
                    Enable location
                  </button>
                </div>
              )}
            </div>

            <TimeExplorer destinationId={destinations[0]?.id} />
          </div>
        </section>

        <section className="section">
          <SectionHead
            eyebrow="Stays & tables"
            title="Sleep well, eat better."
            desc="Sample inventory with transparent pricing. Availability is always checked with the property before you commit."
            action={
              <div className="row">
                <Link to="/hotels" className="btn btn-sm btn-ghost">
                  All hotels
                </Link>
                <Link to="/restaurants" className="btn btn-sm btn-ghost">
                  All restaurants
                </Link>
              </div>
            }
          />
          <div className="grid grid-2">
            <div className="panel">
              <div className="row-between" style={{ marginBottom: 10 }}>
                <h3 style={{ fontSize: 17 }}>Top-rated stays</h3>
                <Link to="/hotels" className="link" style={{ fontSize: 11.5 }}>
                  Browse →
                </Link>
              </div>
              <div className="place-list">
                {hotels.map((place) => (
                  <PlaceRow key={place.slug} place={place} />
                ))}
              </div>
            </div>
            <div className="panel">
              <div className="row-between" style={{ marginBottom: 10 }}>
                <h3 style={{ fontSize: 17 }}>Tables worth booking</h3>
                <Link to="/restaurants" className="link" style={{ fontSize: 11.5 }}>
                  Browse →
                </Link>
              </div>
              <div className="place-list">
                {restaurants.map((place) => (
                  <PlaceRow key={place.slug} place={place} />
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="section">
          <SectionHead
            eyebrow="Off the map"
            title="Hidden gems, kept quiet."
            desc="Places our editors would rather not broadcast — low footfall, high reward."
            action={
              <Link to="/explore?hidden=1" className="btn btn-sm btn-ghost">
                All hidden gems →
              </Link>
            }
          />
          <div className="dest-grid">
            {hidden.map((destination) => (
              <DestinationCard key={destination.id} destination={destination} />
            ))}
          </div>
        </section>

        {recommended.length > 0 && (
          <section className="section">
            <SectionHead
              eyebrow="Travel DNA"
              title="Picked for the way you travel."
              desc="Recommendations weigh your interests, budget level and passport history — not just popularity."
              action={
                <Link to="/profile?tab=preferences" className="btn btn-sm btn-ghost">
                  Tune my preferences →
                </Link>
              }
            />
            <div className="dest-grid">
              {recommended.map((destination) => (
                <DestinationCard key={destination.id} destination={destination} reason={destination.reason} />
              ))}
            </div>
          </section>
        )}

        <section className="section">
          <SectionHead
            eyebrow="Field guides"
            title="Read before you go."
            desc="Practical, opinionated notes on routes, seasons, food and the things guidebooks skip."
            action={
              <Link to="/guides" className="btn btn-sm btn-ghost">
                All guides →
              </Link>
            }
          />
          <div className="dest-grid">
            {guides.map((guide) => (
              <Link to={`/guides/${guide.slug}`} className="dest-card" key={guide.slug}>
                <div className="dest-media">
                  <img src={guide.image} alt={guide.title} loading="lazy" />
                  <span className="float-tag">{guide.category}</span>
                </div>
                <div className="dest-body">
                  <div className="dest-meta">
                    <span>{guide.read_minutes} min read</span>
                    {guide.destination_name && (
                      <>
                        <span>·</span>
                        <span>{guide.destination_name}</span>
                      </>
                    )}
                  </div>
                  <h3 className="dest-title">{guide.title}</h3>
                  <p className="dest-summary">{guide.excerpt}</p>
                  <div className="dest-foot">
                    <span>{guide.author}</span>
                    <span className="link">Read →</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="section">
          <div className="cta-band">
            <div>
              <span className="eyebrow" style={{ color: 'rgba(255,255,255,.68)' }}>
                Ready when you are
              </span>
              <h2>Your next journey starts with a sentence.</h2>
              <p>
                Tell Trippy where you are headed, how long you have and what you love. TRIPSPHERE drafts the route, the
                stays, the tables and the budget — you keep the memories.
              </p>
            </div>
            <div className="row row-wrap">
              <Link to="/plan" className="btn btn-light btn-lg">
                Plan my journey →
              </Link>
              <Link to="/register" className="btn btn-accent btn-lg">
                Create account
              </Link>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
