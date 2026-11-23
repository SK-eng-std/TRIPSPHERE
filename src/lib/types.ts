export interface Destination {
  id: number;
  slug: string;
  name: string;
  state: string;
  region: string;
  tagline: string;
  summary: string;
  description: string;
  image: string;
  lat: number;
  lng: number;
  best_season: string;
  ideal_days: number;
  avg_daily_budget: number;
  interests: string[];
  is_hidden: boolean;
  popularity: number;
  unesco: boolean;
  attraction_count: number;
  hotel_count: number;
  restaurant_count: number;
  from_price: number | null;
  distanceKm: number | null;
  matchScore?: number;
  reason?: string;
}

export interface Place {
  id: number;
  type: 'hotel' | 'restaurant' | 'attraction';
  slug: string;
  name: string;
  summary: string;
  description: string;
  image: string;
  lat: number;
  lng: number;
  price: number;
  priceUnit: string;
  rating: number;
  reviews: number;
  tags: string[];
  kind: string;
  destination: { id: number; name: string; slug: string };
  distanceKm: number | null;
  travelMinutes: number | null;
  isHidden: boolean;
  extra: Record<string, string | number | null>;
}

export interface ItineraryItem {
  id?: number;
  day: number;
  slot: string;
  time: string;
  title: string;
  place_type?: string;
  placeType?: string;
  place_id?: number | null;
  placeId?: number | null;
  notes: string;
  duration_minutes?: number;
  durationMinutes?: number;
  cost: number;
  lat: number | null;
  lng: number | null;
  sort_order?: number;
}

export interface Trip {
  id: number;
  title: string;
  origin: string | null;
  destination_id: number | null;
  start_date: string | null;
  end_date: string | null;
  travellers: number;
  budget: number;
  transport: string;
  interests: string[];
  pace: string;
  status: string;
  summary: string | null;
  ai_mode: string;
  share_token: string | null;
  items: ItineraryItem[];
  destination: Destination | null;
  item_count?: number;
  destination_name?: string;
  destination_image?: string;
  destination_state?: string;
  ownerName?: string;
  shared?: boolean;
}

export interface Plan {
  title: string;
  summary: string;
  items: ItineraryItem[];
  mode: 'openai' | 'smart-engine';
  totalCost: number;
  days: number;
  destinationName: string;
}

export interface BudgetBreakdown {
  key: string;
  label: string;
  amount: number;
  note: string;
}

export interface BudgetEstimate {
  destination: { id: number; name: string };
  nights: number;
  days: number;
  travellers: number;
  rooms: number;
  currency: string;
  breakdown: BudgetBreakdown[];
  total: number;
  perPerson: number;
  daily: number;
  confidence: string;
}

export interface SessionUser {
  id: number;
  name: string;
  email: string;
}

export interface Preferences {
  interests: string[];
  budget_level: string;
  budgetLevel?: string;
  pace: string;
  transport: string;
  dietary?: string | null;
}

export interface AuthPayload {
  user: SessionUser | null;
  profile: Record<string, unknown> | null;
  preferences: Preferences | null;
  counts: { trips: number; bookings: number; reservations: number; saved: number; passport: number };
}

export interface AiCard {
  type: 'destination' | 'hotel' | 'restaurant' | 'attraction' | 'guide';
  slug: string;
  name: string;
  subtitle: string;
  image: string;
  href: string;
}

export interface AssistantResponse {
  answer: string;
  cards: AiCard[];
  suggestions: string[];
  mode: string;
  notice?: string;
}

export interface Guide {
  slug: string;
  title: string;
  excerpt: string;
  body?: string;
  image: string;
  category: string;
  read_minutes: number;
  author: string;
  destination_name?: string | null;
  destination_slug?: string | null;
}

export interface PassportEntry {
  id: number;
  destination_id: number;
  visited_on: string;
  notes: string | null;
  rating: number | null;
  destination_name: string;
  destination_slug: string;
  state: string;
  image: string;
  unesco: number;
  is_hidden: number;
}

export interface Badge {
  id: string;
  label: string;
  description: string;
  threshold: number;
  progress: number;
  earned: boolean;
}

export interface Photo {
  id: number;
  caption: string | null;
  created_at: string;
  destination_name?: string | null;
  url: string;
}

export interface Notification {
  id: number;
  title: string;
  body: string;
  kind: string;
  link: string | null;
  read: number;
  created_at: string;
}

export interface HotelBooking {
  id?: number;
  reference: string;
  hotel_name?: string;
  hotelName?: string;
  hotel_image?: string;
  hotel_slug?: string;
  destination_name?: string;
  check_in: string;
  check_out: string;
  nights: number;
  rooms: number;
  guests: number;
  total_amount?: number;
  total?: number;
  status: string;
  mode: string;
}

export interface Reservation {
  id?: number;
  reference: string;
  restaurant_name?: string;
  restaurantName?: string;
  restaurant_image?: string;
  restaurant_slug?: string;
  cuisine?: string;
  restaurant_cuisine?: string;
  destination_name?: string;
  date: string;
  time: string;
  guests: number;
  status: string;
  mode: string;
}

export interface PlacesProvider {
  id: 'osm' | 'google';
  label: string;
  attribution: string;
  attributionUrl: string;
  needsKey: boolean;
  hasRatings: boolean;
  hasPrices: boolean;
  hasPhotos: boolean;
  hasOpeningHours: boolean;
}

export interface GeoResult {
  id: string;
  name: string;
  label: string;
  lat: number;
  lng: number;
  type: string;
}

export interface NearbyPlace {
  id: string;
  source: 'osm' | 'google';
  kind: 'hotel' | 'restaurant';
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  distanceKm: number;
  rating: number | null;
  reviews: number | null;
  priceBand: 'budget' | 'moderate' | 'premium' | 'luxury' | null;
  priceLabel: string | null;
  stars: number | null;
  hotelType: string | null;
  cuisines: string[];
  facilities: string[];
  phone: string | null;
  website: string | null;
  menuUrl: string | null;
  openingHours: string | null;
  openNow: boolean | null;
  photoUrl: string | null;
  detailsUrl: string | null;
  mapsUrl: string;
  directionsUrl: string;
  bookUrl: string | null;
  reserveUrl: string | null;
}

export interface NearbyResponse {
  provider: PlacesProvider;
  kind: 'hotel' | 'restaurant';
  origin: { lat: number; lng: number };
  radiusKm: number;
  places: NearbyPlace[];
  count: number;
  notice: string | null;
  fetchedAt: string;
}

export interface MiniStop {
  id: number;
  name: string;
  type: string;
  summary: string;
  image: string;
  lat: number;
  lng: number;
  distanceKm: number;
  arriveAt: string;
  leaveAt: string;
  entryFee: number;
}

export interface MiniPlan {
  hours: number;
  stops: MiniStop[];
  totalKm: number;
  note: string;
}
