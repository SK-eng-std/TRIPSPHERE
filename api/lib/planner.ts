import type { Env } from '../env';
import { all, first } from './db';
import { addMinutes, haversineKm, roadKm, travelMinutes } from './geo';

export interface PlanInput {
  destinationId: number;
  origin?: string;
  startDate?: string;
  endDate?: string;
  travellers: number;
  budget: number;
  transport: string;
  interests: string[];
  pace: string;
}

export interface PlannedItem {
  day: number;
  slot: string;
  time: string;
  title: string;
  placeType: string;
  placeId: number | null;
  notes: string;
  durationMinutes: number;
  cost: number;
  lat: number | null;
  lng: number | null;
}

export interface PlanResult {
  title: string;
  summary: string;
  items: PlannedItem[];
  mode: 'openai' | 'smart-engine';
  totalCost: number;
  days: number;
  destinationName: string;
}

interface AttractionRow {
  id: number;
  name: string;
  category: string;
  summary: string;
  lat: number;
  lng: number;
  entry_fee: number;
  avg_visit_minutes: number;
  rating: number;
  is_hidden: number;
  opening_hours: string;
}

interface HotelRow {
  id: number;
  name: string;
  price_per_night: number;
  rating: number;
  summary: string;
  lat: number;
  lng: number;
}

interface RestaurantRow {
  id: number;
  name: string;
  cuisine: string;
  price_for_two: number;
  rating: number;
  lat: number;
  lng: number;
  opens_at: string;
  closes_at: string;
}

export const INTEREST_CATEGORIES: Record<string, string[]> = {
  heritage: ['heritage', 'temple', 'cultural', 'museum'],
  history: ['heritage', 'museum', 'cultural'],
  culture: ['cultural', 'temple', 'heritage'],
  nature: ['nature', 'waterfall', 'hill', 'wildlife', 'beach'],
  adventure: ['adventure', 'waterfall', 'nature'],
  beaches: ['beach'],
  beach: ['beach'],
  food: ['cultural'],
  relaxation: ['nature', 'beach'],
  mountains: ['hill', 'viewpoint', 'trek', 'nature'],
  shopping: ['market', 'cultural'],
  wildlife: ['wildlife'],
  photography: ['nature', 'heritage', 'cultural'],
  religion: ['temple', 'heritage'],
  nightlife: ['cultural'],
  family: ['nature', 'beach', 'wildlife'],
};

export function attractionScore(category: string, rating: number, interests: string[], isHidden: boolean): number {
  let score = rating;
  for (const interest of interests) {
    const cats = INTEREST_CATEGORIES[interest.toLowerCase()];
    if (cats && cats.includes(category)) score += 2.5;
  }
  if (isHidden) score += 0.4;
  return score;
}

export function interestTags(interests: string[]): string[] {
  return Array.from(new Set(interests.map((i) => i.toLowerCase())));
}

function daysBetween(start?: string, end?: string, fallback = 2): number {
  if (!start || !end) return fallback;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return fallback;
  return Math.min(7, Math.max(1, Math.round((b - a) / 86_400_000) + 1));
}

function slotForHour(hour: number): string {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 20) return 'evening';
  return 'night';
}

const TRANSPORT_LABEL: Record<string, string> = {
  car: 'self-drive car',
  taxi: 'taxi',
  bike: 'motorcycle',
  train: 'train',
  bus: 'bus',
  flight: 'flight',
};

const TRANSPORT_FLAT_COST: Record<string, number> = {
  car: 2600,
  taxi: 3200,
  bike: 900,
  train: 900,
  bus: 650,
  flight: 4800,
};

export async function loadPlanningData(env: Env, destinationId: number) {
  const destination = await first<Record<string, unknown>>(env.DB, 'SELECT * FROM destinations WHERE id = ?', destinationId);
  if (!destination) return null;
  const attractions = await all<AttractionRow>(
    env.DB,
    'SELECT id, name, category, summary, lat, lng, entry_fee, avg_visit_minutes, rating, is_hidden, opening_hours FROM attractions WHERE destination_id = ?',
    destinationId,
  );
  const hotels = await all<HotelRow>(
    env.DB,
    'SELECT id, name, price_per_night, rating, summary, lat, lng FROM hotels WHERE destination_id = ? ORDER BY price_per_night ASC',
    destinationId,
  );
  const restaurants = await all<RestaurantRow>(
    env.DB,
    'SELECT id, name, cuisine, price_for_two, rating, lat, lng, opens_at, closes_at FROM restaurants WHERE destination_id = ? ORDER BY rating DESC',
    destinationId,
  );
  return { destination, attractions, hotels, restaurants };
}

function nearestOrder<T extends { lat: number; lng: number }>(items: T[], fromLat: number, fromLng: number): T[] {
  const remaining = [...items];
  const ordered: T[] = [];
  let curLat = fromLat;
  let curLng = fromLng;
  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    remaining.forEach((item, idx) => {
      const d = haversineKm(curLat, curLng, item.lat, item.lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    });
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    curLat = next.lat;
    curLng = next.lng;
  }
  return ordered;
}

export function buildSmartPlan(env: Env, input: PlanInput, data: NonNullable<Awaited<ReturnType<typeof loadPlanningData>>>): PlanResult {
  const dest = data.destination as Record<string, unknown>;
  const destinationName = String(dest.name);
  const centreLat = Number(dest.lat);
  const centreLng = Number(dest.lng);
  const days = daysBetween(input.startDate, input.endDate, Number(dest.ideal_days ?? 2));
  const pace = (input.pace || 'balanced').toLowerCase();
  const perDay = pace === 'packed' ? 3 : pace === 'slow' ? 1 : 2;
  const travellers = Math.max(1, input.travellers);
  const nights = Math.max(1, days - 1);
  const interests = interestTags(input.interests.length ? input.interests : (JSON.parse(String(dest.interests ?? '[]')) as string[]));

  const ranked = data.attractions
    .map((a) => ({ ...a, score: attractionScore(a.category, a.rating, interests, a.is_hidden === 1) }))
    .sort((a, b) => b.score - a.score);

  // Never repeat a place: spread the available attractions across the days instead.
  const chosen = ranked.slice(0, Math.min(perDay * days, ranked.length));
  const perDayLists: typeof chosen[] = Array.from({ length: days }, () => []);
  chosen.forEach((item, index) => {
    perDayLists[index % days].push(item);
  });

  const hotel = pickHotel(data.hotels, travellers);
  const items: PlannedItem[] = [];

  const transportLabel = TRANSPORT_LABEL[input.transport] ?? input.transport;
  const arrivalCost = TRANSPORT_FLAT_COST[input.transport] ?? 1500;

  items.push({
    day: 1,
    slot: 'morning',
    time: '08:00',
    title: input.origin ? `${input.origin} → ${destinationName} (${transportLabel})` : `Arrive in ${destinationName}`,
    placeType: 'transport',
    placeId: null,
    notes: `Journey by ${transportLabel}. Estimated one-way group cost shown; verify with your provider.`,
    durationMinutes: 180,
    cost: arrivalCost,
    lat: centreLat,
    lng: centreLng,
  });

  let prevLat = centreLat;
  let prevLng = centreLng;

  for (let day = 1; day <= days; day += 1) {
    const todays = nearestOrder(perDayLists[day - 1] ?? [], prevLat, prevLng);
    let clock = day === 1 ? '10:30' : '08:30';

    todays.forEach((attraction, idx) => {
      const km = roadKm(haversineKm(prevLat, prevLng, attraction.lat, attraction.lng));
      clock = addMinutes(clock, travelMinutes(km));
      const entry = Number(attraction.entry_fee ?? 0) * travellers;
      items.push({
        day,
        slot: slotForHour(Number(clock.slice(0, 2))),
        time: clock,
        title: attraction.name,
        placeType: 'attraction',
        placeId: attraction.id,
        notes: `${attraction.summary} ${km > 0.5 ? `About ${km} km (${travelMinutes(km)} min) from your previous stop.` : ''} ${attraction.opening_hours ? `${attraction.opening_hours.startsWith('Open') || attraction.opening_hours.startsWith('May') ? attraction.opening_hours : `Open ${attraction.opening_hours}`}.` : ''}`.trim(),
        durationMinutes: Number(attraction.avg_visit_minutes ?? 90),
        cost: entry,
        lat: attraction.lat,
        lng: attraction.lng,
      });
      clock = addMinutes(clock, Number(attraction.avg_visit_minutes ?? 90));
      prevLat = attraction.lat;
      prevLng = attraction.lng;

      if (idx === 0) {
        const lunch = pickRestaurant(data.restaurants, day - 1);
        items.push({
          day,
          slot: 'afternoon',
          time: clock >= '13:00' ? clock : '13:00',
          title: `Lunch at ${lunch.name}`,
          placeType: 'restaurant',
          placeId: lunch.id,
          notes: `${lunch.cuisine}. Estimated ${Math.round(lunch.price_for_two / 2)} per person. Open ${lunch.opens_at} - ${lunch.closes_at}.`,
          durationMinutes: 60,
          cost: Math.round((lunch.price_for_two / 2) * travellers),
          lat: lunch.lat,
          lng: lunch.lng,
        });
        clock = addMinutes(clock >= '13:00' ? clock : '13:00', 60);
      }
    });

    const dinner = pickRestaurant(data.restaurants, day);
    items.push({
      day,
      slot: 'night',
      time: '19:30',
      title: `Dinner at ${dinner.name}`,
      placeType: 'restaurant',
      placeId: dinner.id,
      notes: `${dinner.cuisine}. Estimated ${Math.round(dinner.price_for_two / 2)} per person.`,
      durationMinutes: 90,
      cost: Math.round((dinner.price_for_two / 2) * travellers),
      lat: dinner.lat,
      lng: dinner.lng,
    });

    if (hotel) {
      items.push({
        day,
        slot: 'night',
        time: '21:30',
        title: `Return to ${hotel.name}`,
        placeType: 'hotel',
        placeId: hotel.id,
        notes: `${hotel.summary} Nightly rate from ${hotel.price_per_night} for the room.`,
        durationMinutes: 30,
        cost: 0,
        lat: hotel.lat,
        lng: hotel.lng,
      });
    }

    if (day < days && todays.length) {
      const last = todays[todays.length - 1];
      prevLat = last.lat;
      prevLng = last.lng;
    }
  }

  if (days > 1) {
    items.push({
      day: days,
      slot: 'evening',
      time: '16:30',
      title: `Return journey from ${destinationName}`,
      placeType: 'transport',
      placeId: null,
      notes: `Return leg by ${transportLabel}${input.origin ? ` to ${input.origin}` : ''}. Buffer time included.`,
      durationMinutes: 180,
      cost: arrivalCost,
      lat: centreLat,
      lng: centreLng,
    });
  }

  const accommodation = hotel ? hotel.price_per_night * Math.ceil(travellers / 2) * nights : 0;
  const itemCost = items.reduce((sum, item) => sum + item.cost, 0);
  const totalCost = accommodation + itemCost;

  const topThemes = interests.slice(0, 3).join(', ') || 'local highlights';
  const summary = `A ${days}-day ${pace} route through ${destinationName} built around ${topThemes}. Estimated cost for ${travellers} traveller${travellers > 1 ? 's' : ''}: ₹${totalCost.toLocaleString('en-IN')}${hotel ? `, staying at ${hotel.name}` : ''}. Distances are road estimates and should be checked before departure.`;

  return {
    title: `${days} days in ${destinationName}`,
    summary,
    items,
    mode: 'smart-engine',
    totalCost,
    days,
    destinationName,
  };
}

function pickHotel(hotels: HotelRow[], travellers: number): HotelRow | null {
  if (!hotels.length) return null;
  const rooms = Math.ceil(travellers / 2);
  const sorted = [...hotels].sort((a, b) => a.price_per_night - b.price_per_night);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rooms - 1))];
}

function pickRestaurant(restaurants: RestaurantRow[], index: number): RestaurantRow {
  if (!restaurants.length) {
    return {
      id: 0,
      name: 'a local restaurant',
      cuisine: 'local',
      price_for_two: 800,
      rating: 4,
      lat: 0,
      lng: 0,
      opens_at: '11:00',
      closes_at: '22:00',
    };
  }
  const affordable = [...restaurants].sort((a, b) => a.price_for_two - b.price_for_two);
  return affordable[Math.abs(index) % affordable.length];
}

export async function estimateBudget(
  env: Env,
  input: { destinationId: number; nights: number; travellers: number; transport: string; hotelPrice?: number },
) {
  const data = await loadPlanningData(env, input.destinationId);
  if (!data) return null;
  const dest = data.destination as Record<string, unknown>;
  const travellers = Math.max(1, input.travellers);
  const nights = Math.max(1, Math.min(30, input.nights));
  const days = nights + 1;
  const rooms = Math.ceil(travellers / 2);

  const hotelPrices = data.hotels.map((h) => h.price_per_night).sort((a, b) => a - b);
  const medianHotel = hotelPrices.length ? hotelPrices[Math.floor(hotelPrices.length / 2)] : Number(dest.avg_daily_budget ?? 2500);
  const hotelNightly = input.hotelPrice && input.hotelPrice > 0 ? input.hotelPrice : medianHotel;

  const foodPrices = data.restaurants.map((r) => r.price_for_two);
  const avgForTwo = foodPrices.length ? foodPrices.reduce((a, b) => a + b, 0) / foodPrices.length : 900;
  const foodPerPersonDay = Math.round(avgForTwo * 0.6);

  const localTransportDay: Record<string, number> = { car: 1100, taxi: 1600, bike: 550, public: 260, walk: 100, train: 400, bus: 350, flight: 1200 };
  const transportDaily = localTransportDay[input.transport] ?? 1000;

  const topFees = data.attractions
    .map((a) => a.entry_fee)
    .sort((a, b) => b - a)
    .slice(0, 4);
  const feePerDay = topFees.length ? Math.round(topFees.reduce((a, b) => a + b, 0) / topFees.length) : 0;

  const accommodation = hotelNightly * rooms * nights;
  const food = foodPerPersonDay * travellers * days;
  const transport = transportDaily * days;
  const activities = feePerDay * travellers * days;
  const subtotal = accommodation + food + transport + activities;
  const other = Math.round(subtotal * 0.08);
  const total = subtotal + other;

  return {
    destination: { id: Number(dest.id), name: String(dest.name) },
    nights,
    days,
    travellers,
    rooms,
    currency: 'INR',
    breakdown: [
      { key: 'accommodation', label: 'Accommodation', amount: accommodation, note: `${rooms} room${rooms > 1 ? 's' : ''} × ${nights} night${nights > 1 ? 's' : ''} at ₹${hotelNightly.toLocaleString('en-IN')}` },
      { key: 'food', label: 'Food and drink', amount: food, note: `About ₹${foodPerPersonDay.toLocaleString('en-IN')} per person per day` },
      { key: 'transport', label: 'Local transport', amount: transport, note: `${TRANSPORT_LABEL[input.transport] ?? input.transport} estimate` },
      { key: 'activities', label: 'Attractions and activities', amount: activities, note: `Average entry of ₹${feePerDay.toLocaleString('en-IN')} per day` },
      { key: 'other', label: 'Other and buffer', amount: other, note: '8% buffer for water, tips and small extras' },
    ],
    total,
    perPerson: Math.round(total / travellers),
    daily: Math.round(total / days),
    confidence: 'estimate',
  };
}
