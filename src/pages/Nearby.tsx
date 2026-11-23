import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, api, qs } from '../lib/api';
import type { Destination, GeoResult, NearbyPlace, NearbyResponse, PlacesProvider } from '../lib/types';
import MapView from '../components/MapView';
import type { MapMarker } from '../components/MapView';
import { Chip } from '../components/UI';

type Focus = 'hotel' | 'restaurant' | 'both';
type SortKey = 'distance' | 'rating' | 'name';

interface Origin {
  lat: number;
  lng: number;
  label: string;
}

interface SectionState {
  loading: boolean;
  error: string | null;
  errorStatus: number | null;
  places: NearbyPlace[];
  notice: string | null;
  fetchedAt: string | null;
}

interface Filters {
  budget: string;
  minRating: number;
  cuisine: string;
  type: string;
  facility: string;
  openNow: boolean;
}

const EMPTY_SECTION: SectionState = { loading: false, error: null, errorStatus: null, places: [], notice: null, fetchedAt: null };
const DEFAULT_FILTERS: Filters = { budget: '', minRating: 0, cuisine: '', type: '', facility: '', openNow: false };
const RADII = [1, 3, 5, 10, 20];
const BUDGETS = [
  { value: 'budget', label: 'Budget' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'premium', label: 'Premium' },
];

function cardId(place: NearbyPlace): string {
  return `nearby-card-${place.id.replace(/[^a-zA-Z0-9]/g, '-')}`;
}

function filterPlaces(places: NearbyPlace[], filters: Filters, kind: Focus, sort: SortKey): NearbyPlace[] {
  const out = places.filter((place) => {
    if (filters.budget && place.priceBand !== filters.budget) return false;
    if (filters.minRating && (place.rating ?? 0) < filters.minRating) return false;
    if (kind === 'hotel') {
      if (filters.type && place.hotelType !== filters.type) return false;
      if (filters.facility && !place.facilities.includes(filters.facility)) return false;
    } else if (kind === 'restaurant') {
      if (filters.openNow && place.openNow !== true) return false;
      if (filters.cuisine) {
        const wanted = filters.cuisine.toLowerCase();
        const matchesCuisine = place.cuisines.some((cuisine) => cuisine.toLowerCase() === wanted);
        const matchesType = (place.hotelType ?? '').toLowerCase() === wanted;
        if (!matchesCuisine && !matchesType) return false;
      }
    }
    return true;
  });

  if (sort === 'rating') return [...out].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.distanceKm - b.distanceKm);
  if (sort === 'name') return [...out].sort((a, b) => a.name.localeCompare(b.name));
  return [...out].sort((a, b) => a.distanceKm - b.distanceKm);
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export default function Nearby({ focus = 'both' }: { focus?: Focus }) {
  const [params, setParams] = useSearchParams();
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [resolvingOrigin, setResolvingOrigin] = useState(true);
  const [radiusKm, setRadiusKm] = useState(5);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeoResult[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<NearbyPlace | null>(null);
  const [provider, setProvider] = useState<PlacesProvider | null>(null);
  const [hotelState, setHotelState] = useState<SectionState>(EMPTY_SECTION);
  const [restaurantState, setRestaurantState] = useState<SectionState>(EMPTY_SECTION);
  const [hotelFilters, setHotelFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [restaurantFilters, setRestaurantFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [hotelSort, setHotelSort] = useState<SortKey>('distance');
  const [restaurantSort, setRestaurantSort] = useState<SortKey>('distance');
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [autoOrigin, setAutoOrigin] = useState(false);
  const initialised = useRef(false);
  const mapPanelRef = useRef<HTMLDivElement | null>(null);

  const showHotels = focus !== 'restaurant';
  const showRestaurants = focus !== 'hotel';

  /* ---------------- provider config ---------------- */

  useEffect(() => {
    api<{ provider: PlacesProvider }>('/nearby/config')
      .then((data) => setProvider(data.provider))
      .catch(() => undefined);
    api<{ destinations: Destination[] }>('/destinations?limit=6')
      .then((data) => setDestinations(data.destinations))
      .catch(() => undefined);
  }, []);

  /* ---------------- origin from URL ---------------- */

  const chooseOrigin = useCallback(
    (next: Origin) => {
      setOrigin(next);
      setSelected(null);
      setAutoOrigin(false);
      setHotelFilters(DEFAULT_FILTERS);
      setRestaurantFilters(DEFAULT_FILTERS);
      setParams(
        (previous) => {
          const updated = new URLSearchParams(previous);
          updated.delete('destination');
          updated.set('lat', next.lat.toFixed(6));
          updated.set('lng', next.lng.toFixed(6));
          updated.set('label', next.label);
          return updated;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;

    const latParam = params.get('lat');
    const lngParam = params.get('lng');
    const lat = latParam ? Number(latParam) : NaN;
    const lng = lngParam ? Number(lngParam) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      const label = params.get('label') || 'Selected location';
      setOrigin({ lat, lng, label });
      setQuery(label === 'Selected location' ? '' : label);
      setResolvingOrigin(false);
      return;
    }

    const slug = params.get('destination');
    if (!slug) {
      // First visit: never leave the page empty. Reuse the visitor's last granted
      // location, otherwise show live results around a real destination and say so.
      let stored: { lat: number; lng: number } | null = null;
      try {
        const raw = sessionStorage.getItem('tripsphere.location');
        if (raw) {
          const parsed = JSON.parse(raw) as { lat?: unknown; lng?: unknown };
          if (typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
            stored = { lat: parsed.lat, lng: parsed.lng };
          }
        }
      } catch {
        /* storage can be unavailable */
      }
      if (stored) {
        setOrigin({ ...stored, label: 'Your last location' });
        setAutoOrigin(true);
        setResolvingOrigin(false);
        return;
      }
      setResolvingOrigin(true);
      api<{ destinations: Destination[] }>('/destinations?limit=1')
        .then((data) => {
          const destination = data.destinations[0];
          if (!destination) return;
          setOrigin({ lat: destination.lat, lng: destination.lng, label: destination.name });
          setQuery(destination.name);
          setAutoOrigin(true);
        })
        .catch(() => undefined)
        .finally(() => setResolvingOrigin(false));
      return;
    }
    setResolvingOrigin(true);
    api<{ destination: Destination }>(`/destinations/${encodeURIComponent(slug)}`)
      .then((data) => {
        const destination = data.destination;
        setOrigin({ lat: destination.lat, lng: destination.lng, label: destination.name });
        setQuery(destination.name);
      })
      .catch(() => setSearchNotice('That destination could not be found. Search for a place instead.'))
      .finally(() => setResolvingOrigin(false));
  }, [params]);

  /* ---------------- debounced destination suggestions ---------------- */

  useEffect(() => {
    const term = query.trim();
    if (!suggestOpen || term.length < 3) {
      setSuggestions([]);
      setSuggestBusy(false);
      return;
    }
    const controller = new AbortController();
    setSuggestBusy(true);
    const timer = setTimeout(() => {
      api<{ results: GeoResult[] }>(`/geo/search?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then((data) => setSuggestions(data.results))
        .catch(() => setSuggestions([]))
        .finally(() => setSuggestBusy(false));
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, suggestOpen]);

  /* ---------------- nearby results ---------------- */

  const loadKind = useCallback(
    async (kind: 'hotel' | 'restaurant', signal?: AbortSignal) => {
      if (!origin) return;
      const setState = kind === 'hotel' ? setHotelState : setRestaurantState;
      setState((previous) => ({ ...previous, loading: true, error: null, errorStatus: null }));
      try {
        const response = await api<NearbyResponse>(
          `/nearby/places${qs({ lat: origin.lat, lng: origin.lng, kind, radius: radiusKm, limit: 60 })}`,
          { signal },
        );
        if (signal?.aborted) return;
        setState({
          loading: false,
          error: null,
          errorStatus: null,
          places: response.places,
          notice: response.notice ?? null,
          fetchedAt: response.fetchedAt,
        });
        setProvider(response.provider);
      } catch (error) {
        if (signal?.aborted) return;
        const status = error instanceof ApiError ? error.status : null;
        setState((previous) => ({
          ...previous,
          loading: false,
          error: error instanceof Error ? error.message : "We couldn't load nearby places right now. Please try again.",
          errorStatus: status,
        }));
      }
    },
    [origin, radiusKm],
  );

  useEffect(() => {
    if (!origin) return;
    const controller = new AbortController();
    if (showHotels) void loadKind('hotel', controller.signal);
    if (showRestaurants) void loadKind('restaurant', controller.signal);
    return () => controller.abort();
  }, [origin?.lat, origin?.lng, radiusKm, showHotels, showRestaurants, loadKind]);

  /* ---------------- actions ---------------- */

  async function runSearch(term?: string) {
    const value = (term ?? query).trim();
    if (!value) {
      setSearchNotice('Enter a city, area or landmark, or use your current location.');
      return;
    }
    setSearchNotice(null);
    setSuggestOpen(false);
    setLocationBusy(true);
    try {
      const data = await api<{ results: GeoResult[] }>(`/geo/search?q=${encodeURIComponent(value)}`);
      if (!data.results.length) {
        setSearchNotice(`No place matches "${value}". Try a city, area or landmark name.`);
        return;
      }
      const best = data.results[0];
      chooseOrigin({ lat: best.lat, lng: best.lng, label: best.name });
      setQuery(best.name);
      setSuggestions(data.results);
    } catch (error) {
      setSearchNotice(error instanceof Error ? error.message : 'Destination search failed. Please try again.');
    } finally {
      setLocationBusy(false);
    }
  }

  function requestCurrentLocation() {
    setSearchNotice(null);
    if (!navigator.geolocation) {
      setSearchNotice('This browser does not support location access. Search for a destination manually.');
      return;
    }
    setLocationBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
        try {
          sessionStorage.setItem('tripsphere.location', JSON.stringify(coords));
        } catch {
          /* storage can be unavailable */
        }
        chooseOrigin({ ...coords, label: 'Your current location' });
        setLocationBusy(false);
        api<{ result: GeoResult | null }>(`/geo/reverse?lat=${coords.lat}&lng=${coords.lng}`)
          .then((data) => {
            if (!data.result) return;
            chooseOrigin({ ...coords, label: `Your location · ${data.result.name}` });
            setQuery(data.result.name);
          })
          .catch(() => undefined);
      },
      (error) => {
        setLocationBusy(false);
        const denied = error.code === 1 || error.code === (error as unknown as { PERMISSION_DENIED?: number }).PERMISSION_DENIED;
        setSearchNotice(
          denied
            ? 'Location access is disabled. Search for a destination manually.'
            : 'We could not detect your location. Search for a destination manually.',
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 },
    );
  }

  function bumpRadius() {
    const next = RADII.find((radius) => radius > radiusKm) ?? 20;
    setRadiusKm(next);
  }

  function highlight(place: NearbyPlace) {
    setSelected(place.id);
    window.setTimeout(() => {
      document.getElementById(cardId(place))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 60);
  }

  function showOnMap(place: NearbyPlace) {
    setSelected(place.id);
    setView('map');
    setDetail(null);
    window.setTimeout(() => mapPanelRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
  }

  /* ---------------- derived lists ---------------- */

  const hotelVisible = useMemo(
    () => (showHotels ? filterPlaces(hotelState.places, hotelFilters, 'hotel', hotelSort) : []),
    [showHotels, hotelState.places, hotelFilters, hotelSort],
  );
  const restaurantVisible = useMemo(
    () => (showRestaurants ? filterPlaces(restaurantState.places, restaurantFilters, 'restaurant', restaurantSort) : []),
    [showRestaurants, restaurantState.places, restaurantFilters, restaurantSort],
  );

  const numberById = useMemo(() => {
    const numbers = new Map<string, number>();
    let next = 1;
    hotelVisible.forEach((place) => numbers.set(place.id, next++));
    restaurantVisible.forEach((place) => numbers.set(place.id, next++));
    return numbers;
  }, [hotelVisible, restaurantVisible]);

  const placeByNumber = useMemo(() => {
    const lookup = new Map<number, NearbyPlace>();
    numberById.forEach((number, id) => {
      const place = hotelVisible.find((item) => item.id === id) ?? restaurantVisible.find((item) => item.id === id);
      if (place) lookup.set(number, place);
    });
    return lookup;
  }, [numberById, hotelVisible, restaurantVisible]);

  const markers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = [];
    const push = (place: NearbyPlace) => {
      const number = numberById.get(place.id);
      if (typeof number !== 'number') return;
      list.push({
        lat: place.lat,
        lng: place.lng,
        title: place.name,
        subtitle: [
          place.kind === 'hotel' ? place.hotelType ?? 'Hotel' : place.cuisines.slice(0, 2).join(', ') || 'Restaurant',
          `${place.distanceKm} km`,
          place.rating !== null ? `${place.rating.toFixed(1)}★` : '',
        ]
          .filter(Boolean)
          .join(' · '),
        address: place.address ?? undefined,
        image: place.photoUrl ?? undefined,
        index: number,
        kind: place.kind,
      });
    };
    hotelVisible.forEach(push);
    restaurantVisible.forEach(push);
    return list;
  }, [hotelVisible, restaurantVisible, numberById]);

  const selectedNumber = selected ? numberById.get(selected) : undefined;
  const activeCount = hotelVisible.length + restaurantVisible.length;
  const anyLoading = hotelState.loading || restaurantState.loading;

  useEffect(() => {
    if (!detail) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetail(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail]);

  const headline =
    focus === 'hotel' ? 'Nearby hotels' : focus === 'restaurant' ? 'Nearby restaurants' : "What's around you.";

  return (
    <div className="wrap nearby-page">
      <header className="page-head">
        <span className="eyebrow">Nearby discovery</span>
        <h1>{headline}</h1>
        <p>
          Real hotels and restaurants around any destination or your current location, with distances, contact details
          and map markers. Results come live from the places provider — nothing here is sample inventory.
        </p>
      </header>

      <section className="nearby-search" aria-label="Search a location">
        <form
          className="nearby-search-row"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void runSearch();
          }}
        >
          <div className="nearby-input-wrap">
            <span className="nearby-input-icon" aria-hidden="true">
              <PinIcon />
            </span>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSuggestOpen(true);
              }}
              onFocus={() => setSuggestOpen(true)}
              onBlur={() => window.setTimeout(() => setSuggestOpen(false), 150)}
              placeholder="Enter a city, destination or use your current location..."
              aria-label="City, destination or landmark"
              autoComplete="off"
            />
            {suggestOpen && (suggestBusy || suggestions.length > 0) && (
              <ul className="nearby-suggest" role="listbox">
                {suggestBusy && suggestions.length === 0 && <li className="nearby-suggest-loading">Searching places…</li>}
                {suggestions.map((result) => (
                  <li key={result.id}>
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        chooseOrigin({ lat: result.lat, lng: result.lng, label: result.name });
                        setQuery(result.name);
                        setSuggestOpen(false);
                      }}
                    >
                      <b>{result.name}</b>
                      <span>{result.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="submit" className="btn nearby-go" disabled={locationBusy}>
            {locationBusy ? 'Searching…' : 'Search'}
          </button>
          <button type="button" className="btn btn-ghost nearby-locate" onClick={requestCurrentLocation} disabled={locationBusy}>
            <CrosshairIcon />
            <span>Use my current location</span>
          </button>
        </form>

        <div className="nearby-controls">
          <div className="nearby-radius">
            <span className="nearby-control-label">Search radius</span>
            {RADII.map((radius) => (
              <Chip key={radius} active={radiusKm === radius} onClick={() => setRadiusKm(radius)}>
                {radius} km
              </Chip>
            ))}
          </div>
          <div className="spacer" />
          {origin && (
            <span className="nearby-origin-label">
              <PinIcon /> {origin.label}
            </span>
          )}
          <div className="segmented" role="group" aria-label="Result view">
            <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
              List
            </button>
            <button type="button" className={view === 'map' ? 'active' : ''} onClick={() => setView('map')}>
              Map
            </button>
          </div>
        </div>

        {searchNotice && (
          <div className="alert alert-info nearby-notice" role="status">
            {searchNotice}
          </div>
        )}

        <p className="nearby-attrib">
          Live place data from{' '}
          <a href={provider?.attributionUrl ?? 'https://www.openstreetmap.org/copyright'} target="_blank" rel="noopener noreferrer">
            {provider?.attribution ?? '© OpenStreetMap contributors'}
          </a>
          {provider?.id === 'osm' && ' · ratings, prices and photos appear only when the map data includes them.'}
          {provider?.id === 'google' && ' · ratings and prices are supplied by Google Places.'}
        </p>
      </section>

      {origin && autoOrigin && (
        <p className="nearby-default-note">
          Showing live results around <b>{origin.label}</b>. Search a destination or use your current location to move
          the search.
        </p>
      )}

      {!origin && !resolvingOrigin && (
        <section className="panel nearby-intro">
          <h2>Start with a location</h2>
          <p className="muted">
            Search for a city, area or landmark above, allow location access, or pick one of these destinations. Hotels
            and restaurants load around that point — no account needed.
          </p>
          <div className="chip-row" style={{ marginTop: 14 }}>
            {destinations.map((destination) => (
              <Chip
                key={destination.id}
                onClick={() => {
                  chooseOrigin({ lat: destination.lat, lng: destination.lng, label: destination.name });
                  setQuery(destination.name);
                }}
              >
                {destination.name}
              </Chip>
            ))}
          </div>
        </section>
      )}

      {(resolvingOrigin || locationBusy) && !origin && <SkeletonGrid label="Finding the best hotels and restaurants near you…" />}

      {origin && view === 'map' && (
        <section className="nearby-map-panel" ref={mapPanelRef} aria-label="Results map">
          <div className="nearby-map-head">
            <div>
              <span className="eyebrow">Map view</span>
              <h2>
                {activeCount} place{activeCount === 1 ? '' : 's'} within {radiusKm} km
              </h2>
            </div>
            <span className="muted" style={{ fontSize: 11.5 }}>
              Click a pin to highlight its card
            </span>
          </div>
          {markers.length === 0 ? (
            <div className="nearby-map-empty">
              {anyLoading ? 'Finding the best hotels and restaurants near you…' : 'No results to plot yet. Widen the radius or try another area.'}
            </div>
          ) : (
            <MapView
              markers={markers}
              activeIndex={selectedNumber}
              onMarkerClick={(index) => {
                const place = placeByNumber.get(index);
                if (place) highlight(place);
              }}
              origin={origin}
              height={500}
              scrollZoom
            />
          )}
          <div className="map-legend">
            <span>
              <i className="legend-pin gold" /> Hotels
            </span>
            <span>
              <i className="legend-pin sage" /> Restaurants
            </span>
            <span>
              <i className="legend-pin origin" /> Search location
            </span>
          </div>
        </section>
      )}

      {origin && showHotels && (
        <Section
          kind="hotel"
          heading="Nearby Hotels"
          state={hotelState}
          visible={hotelVisible}
          filters={hotelFilters}
          setFilters={setHotelFilters}
          sort={hotelSort}
          setSort={setHotelSort}
          radiusKm={radiusKm}
          numberById={numberById}
          selected={selected}
          onHighlight={highlight}
          onDetails={setDetail}
          onRetry={() => void loadKind('hotel')}
          onBumpRadius={bumpRadius}
        />
      )}

      {origin && showRestaurants && (
        <Section
          kind="restaurant"
          heading="Nearby Restaurants"
          state={restaurantState}
          visible={restaurantVisible}
          filters={restaurantFilters}
          setFilters={setRestaurantFilters}
          sort={restaurantSort}
          setSort={setRestaurantSort}
          radiusKm={radiusKm}
          numberById={numberById}
          selected={selected}
          onHighlight={highlight}
          onDetails={setDetail}
          onRetry={() => void loadKind('restaurant')}
          onBumpRadius={bumpRadius}
        />
      )}

      {origin && (
        <p className="nearby-curated">
          Prefer the hand-picked sample inventory with request-based booking?{' '}
          <Link to="/hotels/curated">Browse curated stays</Link>
          {' · '}
          <Link to="/restaurants/curated">Browse curated tables</Link>
        </p>
      )}

      {detail && (
        <DetailModal
          place={detail}
          number={numberById.get(detail.id)}
          onClose={() => setDetail(null)}
          onShowMap={() => showOnMap(detail)}
        />
      )}
    </div>
  );
}

/* ================================================================== */
/* section                                                             */
/* ================================================================== */

function Section({
  kind,
  heading,
  state,
  visible,
  filters,
  setFilters,
  sort,
  setSort,
  radiusKm,
  numberById,
  selected,
  onHighlight,
  onDetails,
  onRetry,
  onBumpRadius,
}: {
  kind: 'hotel' | 'restaurant';
  heading: string;
  state: SectionState;
  visible: NearbyPlace[];
  filters: Filters;
  setFilters: (next: Filters) => void;
  sort: SortKey;
  setSort: (next: SortKey) => void;
  radiusKm: number;
  numberById: Map<string, number>;
  selected: string | null;
  onHighlight: (place: NearbyPlace) => void;
  onDetails: (place: NearbyPlace) => void;
  onRetry: () => void;
  onBumpRadius: () => void;
}) {
  const places = state.places;
  const hasRatings = places.some((place) => place.rating !== null);
  const hasPrices = places.some((place) => place.priceBand !== null);
  const hasHours = places.some((place) => place.openNow !== null);
  const types = uniqueSorted(places.map((place) => place.hotelType ?? ''));
  const cuisines = uniqueSorted(places.flatMap((place) => place.cuisines));
  const facilities = uniqueSorted(places.flatMap((place) => place.facilities)).slice(0, 8);
  const filtersActive =
    Boolean(filters.budget) ||
    Boolean(filters.cuisine) ||
    Boolean(filters.facility) ||
    Boolean(filters.type) ||
    filters.minRating > 0 ||
    filters.openNow;

  return (
    <section className="nearby-section" id={kind === 'hotel' ? 'nearby-hotels' : 'nearby-restaurants'}>
      <div className="nearby-section-head">
        <div>
          <span className="eyebrow">{kind === 'hotel' ? 'Stays' : 'Tables'}</span>
          <h2>{heading}</h2>
          <p className="muted">
            {state.loading
              ? 'Finding the best hotels and restaurants near you…'
              : places.length
                ? `${visible.length} of ${places.length} live result${places.length === 1 ? '' : 's'} within ${radiusKm} km`
                : `No live results within ${radiusKm} km`}
          </p>
        </div>
        <div className="field nearby-sort">
          <label htmlFor={`${kind}-sort`}>Sort</label>
          <select id={`${kind}-sort`} value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
            <option value="distance">Nearest first</option>
            {hasRatings && <option value="rating">Highest rated</option>}
            <option value="name">Name A–Z</option>
          </select>
        </div>
      </div>

      {!state.loading && !state.error && places.length > 0 && (
        <div className="nearby-filters">
          {hasPrices ? (
            <div className="nearby-filter-group">
              <span>Budget</span>
              {BUDGETS.map((budget) => (
                <Chip
                  key={budget.value}
                  active={filters.budget === budget.value}
                  onClick={() => setFilters({ ...filters, budget: filters.budget === budget.value ? '' : budget.value })}
                >
                  {budget.label}
                </Chip>
              ))}
            </div>
          ) : (
            <p className="nearby-filter-empty">Budget filtering needs price data, which this provider does not return.</p>
          )}

          {hasRatings ? (
            <div className="nearby-filter-group">
              <span>Rating</span>
              <select
                aria-label="Minimum rating"
                value={filters.minRating}
                onChange={(event) => setFilters({ ...filters, minRating: Number(event.target.value) })}
              >
                <option value={0}>Any rating</option>
                <option value={4}>4.0 and above</option>
                <option value={4.5}>4.5 and above</option>
              </select>
            </div>
          ) : (
            <p className="nearby-filter-empty">Ratings are not provided for these results.</p>
          )}

          {kind === 'hotel' && types.length > 1 && (
            <div className="nearby-filter-group">
              <span>Hotel type</span>
              <select
                aria-label="Hotel type"
                value={filters.type}
                onChange={(event) => setFilters({ ...filters, type: event.target.value })}
              >
                <option value="">Any type</option>
                {types.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
          )}

          {kind === 'restaurant' &&
            (cuisines.length > 0 ? (
              <div className="nearby-filter-group">
                <span>Cuisine</span>
                <select
                  aria-label="Cuisine"
                  value={filters.cuisine}
                  onChange={(event) => setFilters({ ...filters, cuisine: event.target.value })}
                >
                  <option value="">Any cuisine</option>
                  {cuisines.map((cuisine) => (
                    <option key={cuisine} value={cuisine}>
                      {cuisine}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="nearby-filter-empty">Cuisine filtering needs cuisine data, which these results do not include.</p>
            ))}

          {kind === 'restaurant' && hasHours && (
            <div className="nearby-filter-group">
              <span>Opening</span>
              <Chip active={filters.openNow} onClick={() => setFilters({ ...filters, openNow: !filters.openNow })}>
                Open now
              </Chip>
            </div>
          )}

          {kind === 'hotel' && facilities.length > 0 && (
            <div className="nearby-filter-group nearby-filter-group--wide">
              <span>Facilities</span>
              {facilities.map((facility) => (
                <Chip
                  key={facility}
                  active={filters.facility === facility}
                  onClick={() => setFilters({ ...filters, facility: filters.facility === facility ? '' : facility })}
                >
                  {facility}
                </Chip>
              ))}
            </div>
          )}

          {filtersActive && (
            <button type="button" className="nearby-clear" onClick={() => setFilters(DEFAULT_FILTERS)}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {state.notice && !state.loading && !state.error && <p className="nearby-fallback-note">{state.notice}</p>}

      {state.loading && places.length === 0 && <SkeletonGrid label="Finding the best hotels and restaurants near you…" />}

      {state.error && (
        <div className="nearby-state" role="alert">
          <h3>{state.errorStatus === 501 ? 'Location search requires API configuration.' : "We couldn't load nearby places right now."}</h3>
          <p>{state.error}</p>
          {state.errorStatus === 501 && (
            <p className="form-note">
              Set the <code>GOOGLE_PLACES_API_KEY</code> secret on the Worker, or remove it to use the keyless
              OpenStreetMap provider.
            </p>
          )}
          <div className="row row-wrap">
            <button type="button" className="btn btn-sm" onClick={onRetry}>
              Try again
            </button>
          </div>
        </div>
      )}

      {!state.loading && !state.error && places.length === 0 && (
        <div className="nearby-state">
          <h3>{kind === 'hotel' ? 'No hotels found in this area.' : 'No restaurants found in this area.'}</h3>
          <p>
            {kind === 'hotel'
              ? 'Try increasing your search radius or searching a nearby city.'
              : 'Try another location or a wider search radius.'}
          </p>
          <div className="row row-wrap">
            {radiusKm < 20 && (
              <button type="button" className="btn btn-sm" onClick={onBumpRadius}>
                Increase radius to {RADII.find((radius) => radius > radiusKm) ?? 20} km
              </button>
            )}
            <button type="button" className="btn btn-sm btn-ghost" onClick={onRetry}>
              Refresh
            </button>
          </div>
        </div>
      )}

      {!state.loading && !state.error && places.length > 0 && visible.length === 0 && (
        <div className="nearby-state">
          <h3>No {kind === 'hotel' ? 'hotels' : 'restaurants'} match these filters.</h3>
          <p>Clear a filter or widen the radius to see more of the area.</p>
          <button type="button" className="btn btn-sm" onClick={() => setFilters(DEFAULT_FILTERS)}>
            Clear filters
          </button>
        </div>
      )}

      {!state.error && visible.length > 0 && (
        <div className="nearby-grid">
          {visible.map((place) => (
            <NearbyCard
              key={place.id}
              place={place}
              number={numberById.get(place.id) ?? 0}
              active={selected === place.id}
              onHighlight={onHighlight}
              onDetails={onDetails}
            />
          ))}
        </div>
      )}

      {!state.loading && !state.error && places.length > 0 && (
        <p className="nearby-source-note">
          {places.length >= 60 ? 'Showing the nearest 60 results the provider returned. ' : ''}
          Distances are approximate road estimates from your search point. Booking and reservation buttons open the
          provider's own page — TRIPSPHERE does not hold rooms, tables or payments.
        </p>
      )}
    </section>
  );
}

/* ================================================================== */
/* card                                                                */
/* ================================================================== */

function NearbyCard({
  place,
  number,
  active,
  onHighlight,
  onDetails,
}: {
  place: NearbyPlace;
  number: number;
  active: boolean;
  onHighlight: (place: NearbyPlace) => void;
  onDetails: (place: NearbyPlace) => void;
}) {
  return (
    <article id={cardId(place)} className={`nearby-card ${active ? 'is-active' : ''}`}>
      <div className="nearby-media">
        {place.photoUrl ? (
          <img src={place.photoUrl} alt={place.name} loading="lazy" />
        ) : (
          <div className="nearby-photo-empty" aria-hidden="true">
            {place.kind === 'hotel' ? <BedIcon /> : <ForkIcon />}
            <span>No photo from provider</span>
          </div>
        )}
        <span className="nearby-num">{number}</span>
        {place.openNow !== null && (
          <span className={`nearby-open ${place.openNow ? 'open' : 'closed'}`}>{place.openNow ? 'Open now' : 'Closed'}</span>
        )}
      </div>
      <div className="nearby-body">
        <div className="nearby-kicker">
          {place.kind === 'hotel'
            ? place.hotelType ?? 'Hotel'
            : place.cuisines.slice(0, 2).join(' · ') || 'Restaurant'}
        </div>
        <h3 className="nearby-name">{place.name}</h3>
        <p className="nearby-addr">{place.address ?? 'Address not listed by the provider'}</p>

        <div className="nearby-facts">
          <span className="nearby-distance">{place.distanceKm} km away</span>
          {place.rating !== null && (
            <span className="nearby-rating">
              ★ {place.rating.toFixed(1)}
              {place.reviews ? ` (${place.reviews.toLocaleString('en-IN')})` : ''}
            </span>
          )}
          {place.priceLabel && <span>{place.priceLabel}</span>}
          {place.stars && <span>{place.stars}-star</span>}
        </div>

        {place.facilities.length > 0 && (
          <div className="nearby-tags">
            {place.facilities.slice(0, 3).map((facility) => (
              <span className="tag" key={facility}>
                {facility}
              </span>
            ))}
          </div>
        )}

        <div className="nearby-card-actions">
          <button type="button" className="nearby-action primary" onClick={() => onDetails(place)}>
            View details
          </button>
          <button type="button" className="nearby-action" onClick={() => onHighlight(place)}>
            Show on map
          </button>
          <a className="nearby-action" href={place.directionsUrl} target="_blank" rel="noopener noreferrer">
            Directions
          </a>
          {place.website && (
            <a className="nearby-action" href={place.website} target="_blank" rel="noopener noreferrer">
              Website
            </a>
          )}
          {place.kind === 'hotel' && place.bookUrl && (
            <a className="nearby-action book" href={place.bookUrl} target="_blank" rel="noopener noreferrer">
              Book hotel
            </a>
          )}
          {place.kind === 'restaurant' && place.reserveUrl && (
            <a className="nearby-action book" href={place.reserveUrl} target="_blank" rel="noopener noreferrer">
              Reserve a table
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

/* ================================================================== */
/* detail modal                                                        */
/* ================================================================== */

function DetailModal({
  place,
  number,
  onClose,
  onShowMap,
}: {
  place: NearbyPlace;
  number?: number;
  onClose: () => void;
  onShowMap: () => void;
}) {
  return (
    <div className="nearby-modal" role="dialog" aria-modal="true" aria-label={`${place.name} details`}>
      <div className="nearby-modal-backdrop" onClick={onClose} />
      <div className="nearby-modal-panel">
        <button type="button" className="nearby-modal-close" onClick={onClose} aria-label="Close details">
          ✕
        </button>
        <div className="nearby-modal-media">
          {place.photoUrl ? (
            <img src={place.photoUrl} alt={place.name} />
          ) : (
            <div className="nearby-photo-empty" aria-hidden="true">
              {place.kind === 'hotel' ? <BedIcon /> : <ForkIcon />}
              <span>The provider has no photo for this place</span>
            </div>
          )}
          {typeof number === 'number' && <span className="nearby-num">{number}</span>}
        </div>
        <div className="nearby-modal-body">
          <span className="eyebrow">{place.kind === 'hotel' ? place.hotelType ?? 'Hotel' : place.cuisines.slice(0, 3).join(' · ') || 'Restaurant'}</span>
          <h2>{place.name}</h2>
          <p className="nearby-addr">{place.address ?? 'Address not listed by the provider'}</p>

          <div className="nearby-facts">
            <span>{place.distanceKm} km away</span>
            {place.rating !== null && (
              <span>
                ★ {place.rating.toFixed(1)}
                {place.reviews ? ` · ${place.reviews.toLocaleString('en-IN')} reviews` : ''}
              </span>
            )}
            {place.priceLabel && <span>{place.priceLabel}</span>}
            {place.openNow !== null && <span>{place.openNow ? 'Open now' : 'Closed now'}</span>}
            {place.source === 'osm' && <span>OpenStreetMap data</span>}
            {place.source === 'google' && <span>Google Places data</span>}
          </div>

          <dl className="nearby-detail-list">
            {place.facilities.length > 0 && (
              <div>
                <dt>Facilities</dt>
                <dd>{place.facilities.join(', ')}</dd>
              </div>
            )}
            {place.cuisines.length > 0 && (
              <div>
                <dt>Cuisine</dt>
                <dd>{place.cuisines.join(', ')}</dd>
              </div>
            )}
            {place.openingHours && (
              <div>
                <dt>Opening hours</dt>
                <dd>{place.openingHours}</dd>
              </div>
            )}
            {place.phone && (
              <div>
                <dt>Phone</dt>
                <dd>
                  <a href={`tel:${place.phone.replace(/\s+/g, '')}`}>{place.phone}</a>
                </dd>
              </div>
            )}
            {place.website && (
              <div>
                <dt>Website</dt>
                <dd>
                  <a href={place.website} target="_blank" rel="noopener noreferrer">
                    {place.website.replace(/^https?:\/\//, '').slice(0, 60)}
                  </a>
                </dd>
              </div>
            )}
          </dl>

          <div className="nearby-modal-actions">
            <button type="button" className="btn btn-sm" onClick={onShowMap}>
              Show on map
            </button>
            <a className="btn btn-sm btn-ghost" href={place.directionsUrl} target="_blank" rel="noopener noreferrer">
              Get directions
            </a>
            {place.menuUrl && (
              <a className="btn btn-sm btn-ghost" href={place.menuUrl} target="_blank" rel="noopener noreferrer">
                View menu
              </a>
            )}
            {place.kind === 'hotel' && place.bookUrl && (
              <a className="btn btn-sm btn-accent" href={place.bookUrl} target="_blank" rel="noopener noreferrer">
                Book hotel
              </a>
            )}
            {place.kind === 'restaurant' && place.reserveUrl && (
              <a className="btn btn-sm btn-accent" href={place.reserveUrl} target="_blank" rel="noopener noreferrer">
                Reserve a table
              </a>
            )}
            {place.detailsUrl && (
              <a className="btn btn-sm btn-ghost" href={place.detailsUrl} target="_blank" rel="noopener noreferrer">
                Provider listing
              </a>
            )}
          </div>

          <p className="form-note">
            Bookings and reservations open the provider's page in a new tab. TRIPSPHERE has not confirmed any
            availability, price or reservation.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* small pieces                                                        */
/* ================================================================== */

function SkeletonGrid({ label }: { label: string }) {
  return (
    <div className="nearby-loading" role="status" aria-live="polite">
      <p>{label}</p>
      <div className="nearby-grid" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="nearby-card skeleton-card" key={index}>
            <div className="skeleton" style={{ height: 150 }} />
            <div className="nearby-body">
              <div className="skeleton" style={{ height: 10, width: '35%' }} />
              <div className="skeleton" style={{ height: 16, width: '75%', marginTop: 8 }} />
              <div className="skeleton" style={{ height: 10, width: '90%', marginTop: 8 }} />
              <div className="skeleton" style={{ height: 10, width: '55%', marginTop: 6 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function CrosshairIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function BedIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 18V8m0 5h18v5M3 13V8h8a4 4 0 0 1 4 4v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="7" cy="10" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function ForkIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 3v7a2 2 0 0 0 4 0V3M9 12v9M17 3c-1.7 0-3 1.9-3 4.2 0 2 .9 3.4 2.2 3.8V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
