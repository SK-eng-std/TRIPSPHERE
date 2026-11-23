import { Link } from 'react-router-dom';
import type { Destination, Place } from '../lib/types';
import { formatINR } from '../lib/geo';
import { Rating } from './UI';

export function DestinationCard({ destination, reason }: { destination: Destination; reason?: string }) {
  const badge = destination.unesco ? 'UNESCO' : destination.is_hidden ? 'Hidden gem' : destination.region;
  return (
    <Link to={`/explore/${destination.slug}`} className="dest-card">
      <div className="dest-media">
        <img src={destination.image} alt={destination.name} loading="lazy" />
        <span className="float-tag">{badge}</span>
        {destination.from_price !== null && <span className="float-price">from {formatINR(destination.from_price)}</span>}
      </div>
      <div className="dest-body">
        <div className="dest-meta">
          <span>{destination.state}</span>
          <span>·</span>
          <span>{destination.ideal_days} days</span>
          {destination.distanceKm !== null && (
            <>
              <span>·</span>
              <span>{destination.distanceKm} km away</span>
            </>
          )}
        </div>
        <h3 className="dest-title">{destination.name}</h3>
        <p className="dest-summary">{destination.summary}</p>
        <div className="dest-foot">
          <span>{reason || `${destination.attraction_count} attractions · ${destination.hotel_count} stays`}</span>
          <span className="link">Explore →</span>
        </div>
      </div>
    </Link>
  );
}

const detailPath = (place: Place) =>
  place.type === 'hotel' ? `/hotels/${place.slug}` : place.type === 'restaurant' ? `/restaurants/${place.slug}` : `/attractions/${place.slug}`;

export function PlaceCard({ place }: { place: Place }) {
  return (
    <Link to={detailPath(place)} className="place-card">
      <div className="dest-media">
        <img src={place.image} alt={place.name} loading="lazy" />
        {place.type === 'attraction' && place.isHidden && <span className="float-tag">Hidden gem</span>}
        {place.type === 'hotel' && place.extra.check_in_time && (
          <span className="float-tag">Check-in {String(place.extra.check_in_time)}</span>
        )}
      </div>
      <div className="place-body">
        <div className="dest-meta">
          <span>{place.destination.name}</span>
          <span>·</span>
          <span>{place.type === 'hotel' ? String(place.kind) : place.type === 'restaurant' ? place.tags.slice(0, 2).join(', ') : place.tags[0]}</span>
        </div>
        <h3 className="place-title">{place.name}</h3>
        <p className="dest-summary">{place.summary}</p>
        <div className="dest-foot">
          <Rating value={place.rating} reviews={place.reviews} />
          <span style={{ fontWeight: 600 }}>
            {place.price > 0 ? `${formatINR(place.price)} ${place.priceUnit}` : 'Free entry'}
          </span>
        </div>
      </div>
    </Link>
  );
}

export function PlaceRow({ place }: { place: Place }) {
  return (
    <Link to={detailPath(place)} className="place-row">
      <img src={place.image} alt={place.name} loading="lazy" />
      <div className="place-row-body">
        <div className="dest-meta" style={{ marginBottom: 4 }}>
          <span>{place.destination.name}</span>
          {place.distanceKm !== null && (
            <>
              <span>·</span>
              <span>{place.distanceKm} km</span>
            </>
          )}
          {place.travelMinutes !== null && (
            <>
              <span>·</span>
              <span>~{place.travelMinutes} min</span>
            </>
          )}
        </div>
        <h3 className="place-title">{place.name}</h3>
        <p className="dest-summary" style={{ marginTop: 4 }}>
          {place.summary}
        </p>
        <div className="row row-wrap" style={{ marginTop: 8, gap: 6 }}>
          {place.tags.slice(0, 3).map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      </div>
      <div className="place-row-price">
        <Rating value={place.rating} reviews={place.reviews} />
        <strong style={{ fontSize: 14 }}>{place.price > 0 ? formatINR(place.price) : 'Free'}</strong>
        <span className="muted" style={{ fontSize: 10.5 }}>
          {place.priceUnit}
        </span>
      </div>
    </Link>
  );
}
