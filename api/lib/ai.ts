import type { Env } from '../env';
import { all, first } from './db';
import { haversineKm, roadKm, travelMinutes, addMinutes } from './geo';
import { attractionScore, buildSmartPlan, loadPlanningData, interestTags, type PlanInput } from './planner';

export interface AiCard {
  type: 'destination' | 'hotel' | 'restaurant' | 'attraction' | 'guide';
  slug: string;
  name: string;
  subtitle: string;
  image: string;
  href: string;
}

export interface AssistantReply {
  answer: string;
  cards: AiCard[];
  suggestions: string[];
  mode: 'openai' | 'smart-engine';
  notice?: string;
}

const ALLOWED_MODELS = new Set(['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4.1']);

export function aiMode(env: Env): 'openai' | 'smart-engine' {
  return env.OPENAI_API_KEY ? 'openai' : 'smart-engine';
}

export async function callOpenAI(
  env: Env,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  opts: { json?: boolean; maxTokens?: number } = {},
): Promise<string | null> {
  if (!env.OPENAI_API_KEY) return null;
  const base = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const requested = env.OPENAI_MODEL || 'gpt-4o-mini';
  const model = ALLOWED_MODELS.has(requested) ? requested : 'gpt-4o-mini';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.5,
        max_tokens: opts.maxTokens ?? 900,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return payload.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

interface AiPlanPayload {
  title?: string;
  summary?: string;
  days?: {
    day?: number;
    items?: {
      time?: string;
      slot?: string;
      title?: string;
      placeId?: number | null;
      placeType?: string;
      notes?: string;
      durationMinutes?: number;
    }[];
  }[];
}

export async function generateItinerary(env: Env, input: PlanInput) {
  const data = await loadPlanningData(env, input.destinationId);
  if (!data) return null;
  const fallback = buildSmartPlan(env, input, data);
  if (aiMode(env) === 'smart-engine') return fallback;

  const dest = data.destination as Record<string, unknown>;
  const interests = interestTags(input.interests);
  const candidates = {
    attractions: data.attractions.map((a) => ({ placeId: a.id, name: a.name, category: a.category, rating: a.rating, entryFee: a.entry_fee, minutes: a.avg_visit_minutes })),
    hotels: data.hotels.map((h) => ({ placeId: h.id, name: h.name, pricePerNight: h.price_per_night, rating: h.rating })),
    restaurants: data.restaurants.map((r) => ({ placeId: r.id, name: r.name, cuisine: r.cuisine, priceForTwo: r.price_for_two, rating: r.rating })),
  };

  const prompt = `Build a day-by-day itinerary for ${String(dest.name)}, ${String(dest.state)}, India.
Travellers: ${input.travellers}. Budget: INR ${input.budget}. Pace: ${input.pace}. Transport: ${input.transport}.
Start: ${input.startDate || 'flexible'}. End: ${input.endDate || 'flexible'}.
Interests: ${interests.join(', ') || 'general sightseeing'}.
Origin: ${input.origin || 'not specified'}.

Candidate places (use ONLY these placeId values, and never invent a place):
${JSON.stringify(candidates)}

Return strict JSON:
{"title": string, "summary": string, "days": [{"day": number, "items": [{"time": "HH:MM", "slot": "morning|afternoon|evening|night", "title": string, "placeType": "attraction|restaurant|hotel|transport|custom", "placeId": number|null, "notes": string, "durationMinutes": number}]}]}

Rules: 1-3 attractions per day according to pace, one lunch and one dinner restaurant per day, a hotel item at the end of each day when staying overnight, an arrival transport item on day 1. Do not exceed 3 attractions or 2 restaurants per day. Keep notes factual and under 30 words. The summary must mention the destination and a realistic total estimate.`;

  const raw = await callOpenAI(
    env,
    [
      { role: 'system', content: "You are TRIPSPHERE's senior itinerary architect for Indian travel. You return only valid JSON and you never invent places, prices or opening hours that are not in the supplied data." },
      { role: 'user', content: prompt },
    ],
    { json: true, maxTokens: 1600 },
  );
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as AiPlanPayload;
    if (!parsed.days?.length) return fallback;
    const attrById = new Map(data.attractions.map((a) => [a.id, a]));
    const hotelById = new Map(data.hotels.map((h) => [h.id, h]));
    const restById = new Map(data.restaurants.map((r) => [r.id, r]));
    const travellers = Math.max(1, input.travellers);
    const items = [];

    for (const [idx, day] of parsed.days.entries()) {
      const dayNumber = Math.max(1, Number(day.day ?? idx + 1));
      for (const item of day.items ?? []) {
        const placeType = ['attraction', 'restaurant', 'hotel', 'transport', 'custom'].includes(String(item.placeType))
          ? String(item.placeType)
          : 'custom';
        const placeId = item.placeId ? Number(item.placeId) : null;
        let lat: number | null = null;
        let lng: number | null = null;
        let cost = 0;
        let title = String(item.title || '').slice(0, 140);
        let notes = String(item.notes || '').slice(0, 300);

        if (placeType === 'attraction' && placeId && attrById.has(placeId)) {
          const a = attrById.get(placeId)!;
          title = a.name;
          lat = a.lat;
          lng = a.lng;
          cost = a.entry_fee * travellers;
          if (!notes) notes = a.summary;
        } else if (placeType === 'restaurant' && placeId && restById.has(placeId)) {
          const r = restById.get(placeId)!;
          title = title || `Meal at ${r.name}`;
          lat = r.lat;
          lng = r.lng;
          cost = Math.round((r.price_for_two / 2) * travellers);
          if (!notes) notes = `${r.cuisine}. Open ${r.opens_at} - ${r.closes_at}.`;
        } else if (placeType === 'hotel' && placeId && hotelById.has(placeId)) {
          const h = hotelById.get(placeId)!;
          title = title || `Stay at ${h.name}`;
          lat = h.lat;
          lng = h.lng;
          if (!notes) notes = h.summary;
        }

        if (!title) continue;
        items.push({
          day: dayNumber,
          slot: String(item.slot || 'morning'),
          time: /^\d{2}:\d{2}$/.test(String(item.time)) ? String(item.time) : '09:00',
          title,
          placeType,
          placeId: placeId && (attrById.has(placeId) || restById.has(placeId) || hotelById.has(placeId)) ? placeId : null,
          notes,
          durationMinutes: Math.min(360, Math.max(15, Number(item.durationMinutes) || 90)),
          cost,
          lat,
          lng,
        });
      }
    }

    if (items.length < 3) return fallback;
    const nights = Math.max(1, (parsed.days?.length ?? 1) - 1);
    const hotelForStay = data.hotels[0];
    const accommodation = hotelForStay ? hotelForStay.price_per_night * Math.ceil(travellers / 2) * nights : 0;
    const totalCost = accommodation + items.reduce((sum, item) => sum + item.cost, 0);

    return {
      title: String(parsed.title || `${parsed.days.length} days in ${String(dest.name)}`).slice(0, 120),
      summary: String(parsed.summary || fallback.summary).slice(0, 600),
      items,
      mode: 'openai' as const,
      totalCost,
      days: parsed.days.length,
      destinationName: String(dest.name),
    };
  } catch {
    return fallback;
  }
}

interface MiniPlanInput {
  lat?: number;
  lng?: number;
  hours: number;
  interests: string[];
  destinationId?: number;
}

export async function miniPlan(env: Env, input: MiniPlanInput) {
  const hours = Math.min(12, Math.max(0.5, input.hours));
  const budgetMinutes = hours * 60;
  const interests = interestTags(input.interests);
  const attractions = await all<{
    id: number; slug: string; name: string; category: string; summary: string; image: string;
    lat: number; lng: number; avg_visit_minutes: number; entry_fee: number; rating: number; is_hidden: number;
    destination_id: number; destination_name: string; destination_slug: string; opening_hours: string;
  }>(
    env.DB,
    `SELECT a.id, a.slug, a.name, a.category, a.summary, a.image, a.lat, a.lng, a.avg_visit_minutes,
      a.entry_fee, a.rating, a.is_hidden, a.opening_hours, a.destination_id,
      d.name AS destination_name, d.slug AS destination_slug
     FROM attractions a JOIN destinations d ON d.id = a.destination_id`,
  );
  const lat = typeof input.lat === 'number' ? input.lat : attractions[0]?.lat;
  const lng = typeof input.lng === 'number' ? input.lng : attractions[0]?.lng;

  const scored = attractions
    .filter((a) => (input.destinationId ? a.destination_id === input.destinationId : true))
    .map((a) => {
      const distance = typeof lat === 'number' && typeof lng === 'number' ? roadKm(haversineKm(lat, lng, a.lat, a.lng)) : 0;
      return { ...a, distance, score: attractionScore(a.category, a.rating, interests, a.is_hidden === 1) - distance * 0.05 };
    })
    .filter((a) => a.distance <= 80)
    .sort((a, b) => b.score - a.score);

  const stops: {
    id: number; name: string; type: string; summary: string; image: string;
    lat: number; lng: number; distanceKm: number; arriveAt: string; leaveAt: string; entryFee: number;
  }[] = [];
  let clock = addMinutes(new Date().toTimeString().slice(0, 5), 20);
  let remaining = budgetMinutes;
  let lastLat = lat ?? 0;
  let lastLng = lng ?? 0;
  let totalKm = 0;

  for (const candidate of scored) {
    const km = roadmap(lastLat, lastLng, candidate.lat, candidate.lng);
    const travel = travelMinutes(km);
    const visit = Math.min(candidate.avg_visit_minutes ?? 60, 90);
    if (travel + visit + 20 > remaining) continue;
    clock = addMinutes(clock, travel);
    const arriveAt = clock;
    clock = addMinutes(clock, visit);
    stops.push({
      id: candidate.id,
      name: candidate.name,
      type: 'attraction',
      summary: candidate.summary,
      image: candidate.image,
      lat: candidate.lat,
      lng: candidate.lng,
      distanceKm: km,
      arriveAt,
      leaveAt: clock,
      entryFee: candidate.entry_fee,
    });
    remaining -= travel + visit;
    totalKm += km;
    lastLat = candidate.lat;
    lastLng = candidate.lng;
    if (stops.length >= 3) break;
  }

  if (hours >= 3) {
    const restaurant = await first<{ id: number; name: string; summary: string; image: string; lat: number; lng: number; price_for_two: number; cuisine: string }>(
      env.DB,
      'SELECT id, name, summary, image, lat, lng, price_for_two, cuisine FROM restaurants WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? ORDER BY rating DESC LIMIT 1',
      lastLat - 0.12,
      lastLat + 0.12,
      lastLng - 0.12,
      lastLng + 0.12,
    );
    if (restaurant) {
      const km = roadmap(lastLat, lastLng, restaurant.lat, restaurant.lng);
      clock = addMinutes(clock, travelMinutes(km));
      stops.push({
        id: restaurant.id,
        name: restaurant.name,
        type: 'restaurant',
        summary: `${restaurant.cuisine} · about ₹${Math.round(restaurant.price_for_two / 2)} per person`,
        image: restaurant.image,
        lat: restaurant.lat,
        lng: restaurant.lng,
        distanceKm: km,
        arriveAt: clock,
        leaveAt: addMinutes(clock, 60),
        entryFee: 0,
      });
      totalKm += km;
    }
  }

  return {
    hours,
    stops,
    totalKm: Math.round(totalKm * 10) / 10,
    note: stops.length
      ? `A ${hours}-hour route using estimated road distances. Opening hours and traffic can change the plan — check before you set out.`
      : 'No attraction fits that window from this location. Try a longer window or a different starting point.',
  };
}

function roadmap(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return roadKm(haversineKm(lat1, lng1, lat2, lng2));
}

export async function assistantReply(
  env: Env,
  input: { message: string; lat?: number; lng?: number; destinationId?: number; history?: { role: string; content: string }[] },
): Promise<AssistantReply> {
  const message = input.message.slice(0, 500);
  const lower = message.toLowerCase();
  const cards: AiCard[] = [];

  const budgetMention = /under|budget|cheap|affordable|₹|rs\.?|inr|\d{3,}/.test(lower);
  const wantsHotel = /hotel|stay|room|accommodation|sleep/.test(lower);
  const wantsFood = /restaurant|eat|food|dinner|lunch|breakfast|cafe|cuisine/.test(lower);
  const wantsHidden = /hidden|offbeat|secret|less.?explored|underrated|quiet/.test(lower);
  const wantsNearby = /near me|nearby|around me|close to me|near my/.test(lower);
  const wantsCost = /cost|budget|how much|expense|price/.test(lower);
  const wantsPlan = /plan|itinerary|day trip|schedule|hours?/.test(lower);
  const wantsAttractions = /attraction|places|visit|see|sightseeing|monument|temple|beach|trek/.test(lower);

  const destinations = await all<{
    id: number; slug: string; name: string; state: string; summary: string; image: string; interests: string;
    is_hidden: number; lat: number; lng: number;
  }>(env.DB, 'SELECT id, slug, name, state, summary, image, interests, is_hidden, lat, lng FROM destinations');

  const named = destinations.find((d) => lower.includes(d.name.toLowerCase().split(' ')[0]));

  let lat = input.lat;
  let lng = input.lng;
  if (typeof lat !== 'number' && named) {
    lat = named.lat;
    lng = named.lng;
  }

  const priceCap = parseBudget(lower);
  const hotels = await all<{
    id: number; slug: string; name: string; summary: string; image: string; price_per_night: number; rating: number;
    lat: number; lng: number; destination_name: string; destination_slug: string;
  }>(
    env.DB,
    `SELECT h.id, h.slug, h.name, h.summary, h.image, h.price_per_night, h.rating, h.lat, h.lng,
      d.name AS destination_name, d.slug AS destination_slug
     FROM hotels h JOIN destinations d ON d.id = h.destination_id
     ${named ? 'WHERE h.destination_id = ?' : 'WHERE 1 = 1'}
     ORDER BY h.rating DESC LIMIT 40`,
    ...(named ? [named.id] : []),
  );
  const affordableHotels = priceCap ? hotels.filter((h) => h.price_per_night <= priceCap) : hotels;

  const restaurants = await all<{
    id: number; slug: string; name: string; summary: string; image: string; price_for_two: number; rating: number;
    cuisine: string; lat: number; lng: number; destination_name: string; destination_slug: string;
  }>(
    env.DB,
    `SELECT r.id, r.slug, r.name, r.summary, r.image, r.price_for_two, r.rating, r.cuisine, r.lat, r.lng,
      d.name AS destination_name, d.slug AS destination_slug
     FROM restaurants r JOIN destinations d ON d.id = r.destination_id
     ${named ? 'WHERE r.destination_id = ?' : 'WHERE 1 = 1'}
     ORDER BY r.rating DESC LIMIT 40`,
    ...(named ? [named.id] : []),
  );

  const attractions = await all<{
    id: number; slug: string; name: string; summary: string; image: string; category: string; rating: number;
    lat: number; lng: number; is_hidden: number; entry_fee: number; destination_name: string; destination_slug: string;
  }>(
    env.DB,
    `SELECT a.id, a.slug, a.name, a.summary, a.image, a.category, a.rating, a.lat, a.lng, a.is_hidden, a.entry_fee,
      d.name AS destination_name, d.slug AS destination_slug
     FROM attractions a JOIN destinations d ON d.id = a.destination_id
     ${named ? 'WHERE a.destination_id = ?' : 'WHERE 1 = 1'}
     ORDER BY a.rating DESC LIMIT 80`,
    ...(named ? [named.id] : []),
  );

  const withDistance = <T extends { lat: number; lng: number }>(list: T[]) =>
    list
      .map((item) => ({
        ...item,
        distanceKm: typeof lat === 'number' && typeof lng === 'number' ? roadKm(haversineKm(lat, lng, item.lat, item.lng)) : null,
      }))
      .sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));

  const nearbyHotels = withDistance(affordableHotels);
  const nearbyRestaurants = withDistance(restaurants);
  const nearbyAttractions = withDistance(attractions.filter((a) => (wantsHidden ? a.is_hidden === 1 : true)));

  const destinationCards = (list: typeof destinations, limit = 4): AiCard[] =>
    withDistance(list)
      .sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9))
      .slice(0, limit)
      .map((d) => ({
        type: 'destination',
        slug: d.slug,
        name: d.name,
        subtitle: `${d.state}${d.distanceKm !== null ? ` · ${d.distanceKm} km` : ''}`,
        image: d.image,
        href: `/explore/${d.slug}`,
      }));

  if (wantsHotel) {
    cards.push(
      ...nearbyHotels.slice(0, 4).map((h) => ({
        type: 'hotel' as const,
        slug: h.slug,
        name: h.name,
        subtitle: `₹${h.price_per_night.toLocaleString('en-IN')} / night · ${h.rating}★${h.distanceKm !== null ? ` · ${h.distanceKm} km` : ''}`,
        image: h.image,
        href: `/hotels/${h.slug}`,
      })),
    );
  }
  if (wantsFood) {
    cards.push(
      ...nearbyRestaurants.slice(0, 4).map((r) => ({
        type: 'restaurant' as const,
        slug: r.slug,
        name: r.name,
        subtitle: `${r.cuisine} · ₹${r.price_for_two.toLocaleString('en-IN')} for two${r.distanceKm !== null ? ` · ${r.distanceKm} km` : ''}`,
        image: r.image,
        href: `/restaurants/${r.slug}`,
      })),
    );
  }
  if (!wantsHotel && !wantsFood) {
    cards.push(
      ...nearbyAttractions.slice(0, 4).map((a) => ({
        type: 'attraction' as const,
        slug: a.slug,
        name: a.name,
        subtitle: `${a.category} · ${a.rating}★${a.distanceKm !== null ? ` · ${a.distanceKm} km` : ''}`,
        image: a.image,
        href: `/attractions?q=${encodeURIComponent(a.name)}`,
      })),
    );
  }
  if (wantsHidden || /where|destination|place/.test(lower)) {
    const hiddenDests = destinations.filter((d) => d.is_hidden === 1);
    cards.push(...destinationCards(hiddenDests.length ? hiddenDests : destinations, 3));
  }

  let answer: string;
  let notice: string | undefined;

  if (wantsCost && named) {
    const cheapestHotel = hotels.slice().sort((a, b) => a.price_per_night - b.price_per_night)[0];
    const avgFood = restaurants.length ? Math.round(restaurants.reduce((s, r) => s + r.price_for_two, 0) / restaurants.length / 2) : 600;
    answer = `A comfortable day in ${named.name} for one traveller lands around ₹${((cheapestHotel?.price_per_night ?? 2500) / 2 + avgFood * 2 + 900).toLocaleString('en-IN')}: roughly ₹${Math.round((cheapestHotel?.price_per_night ?? 2500) / 2).toLocaleString('en-IN')} for a shared room, ₹${(avgFood * 2).toLocaleString('en-IN')} for two meals and about ₹900 for local transport and entries. Use the Budget Planner to model your exact dates, group size and hotel choice.`;
  } else if (wantsHotel) {
    if (nearbyHotels.length) {
      answer = `Here are the best-rated stays${named ? ` in ${named.name}` : ' from our inventory'}${priceCap ? ` under ₹${priceCap.toLocaleString('en-IN')} a night` : ''}. Rates are sample inventory used for planning — always confirm live availability with the property before booking.`;
    } else if (priceCap && hotels.length) {
      const cheapest = Math.min(...hotels.map((h) => h.price_per_night));
      answer = `I could not find a stay under ₹${priceCap.toLocaleString('en-IN')}${named ? ` in ${named.name}` : ''}. The available options start at ₹${cheapest.toLocaleString('en-IN')} a night. Raise the limit or try a homestay.`;
      cards.push(
        ...[...hotels]
          .sort((a, b) => a.price_per_night - b.price_per_night)
          .slice(0, 3)
          .map((h) => ({
            type: 'hotel' as const,
            slug: h.slug,
            name: h.name,
            subtitle: `₹${h.price_per_night.toLocaleString('en-IN')} / night · ${h.rating}★`,
            image: h.image,
            href: `/hotels/${h.slug}`,
          })),
      );
    } else {
      answer = 'I do not have stays matching that filter yet. Try a different destination or raise the nightly budget.';
    }
  } else if (wantsFood) {
    answer = nearbyRestaurants.length
      ? `Good tables${named ? ` in ${named.name}` : ' nearby'}: ${nearbyRestaurants.slice(0, 3).map((r) => r.name).join(', ')}. Reservation requests can be logged from each restaurant page, and I will always show you when a request is a demo rather than a confirmed booking.`
      : 'No restaurants match that yet. Try a destination name or clear the cuisine filter.';
  } else if (wantsNearby && (typeof input.lat !== 'number' || typeof input.lng !== 'number')) {
    answer = 'I need your location to answer that precisely. Allow location access in the Explore tab, or tell me a destination and I will plan from its centre.';
  } else if (wantsNearby) {
    const nearest = nearbyAttractions.slice(0, 3);
    answer = nearest.length
      ? `Closest to you right now: ${nearest.map((a) => `${a.name} (${a.distanceKm} km)`).join(', ')}. Distances are road estimates from your coordinates.`
      : 'Nothing in our inventory is close to your current location. Try the Explore Around Me tab for a wider radius.';
  } else if (wantsPlan && /hour/.test(lower)) {
    const hours = Number((lower.match(/(\d+(\.\d+)?)\s*hour/) ?? [])[1] ?? 3);
    const plan = await miniPlan(env, { lat, lng, hours, interests: [], destinationId: named?.id });
    answer = plan.stops.length
      ? `With ${hours} hours${named ? ` in ${named.name}` : ''}, start at ${plan.stops[0].name}. Suggested route: ${plan.stops.map((s) => `${s.name} (${s.arriveAt})`).join(' → ')}, about ${plan.totalKm} km total.`
      : plan.note;
  } else if (named) {
    const top = nearbyAttractions.slice(0, 3);
    answer = `${named.name}, ${named.state}: ${named.summary} ${top.length ? `Start with ${top.map((a) => a.name).join(', ')}.` : ''} I can build a full itinerary, a hotel shortlist or a budget estimate from here.`;
  } else if (wantsHidden) {
    answer = 'For quieter travel, start with Chikmagalur, Gokarna, Mahabalipuram, Shillong and Havelock. Each has the scenery without the crowd, and the hidden-gem filters on Explore will show you specific places.';
  } else {
    answer = 'I can help with four things: building a day-by-day itinerary, finding stays and tables near a destination, estimating a realistic budget, and filling a short window with a practical mini-plan. Tell me where you are going and how long you have.';
  }

  if (aiMode(env) === 'openai') {
    const context = {
      destinationMentioned: named ? { name: named.name, state: named.state, summary: named.summary } : null,
      hotels: nearbyHotels.slice(0, 5).map((h) => ({ name: h.name, city: h.destination_name, price: h.price_per_night, rating: h.rating, distanceKm: h.distanceKm })),
      restaurants: nearbyRestaurants.slice(0, 5).map((r) => ({ name: r.name, city: r.destination_name, cuisine: r.cuisine, priceForTwo: r.price_for_two, rating: r.rating })),
      attractions: nearbyAttractions.slice(0, 6).map((a) => ({ name: a.name, city: a.destination_name, category: a.category, entryFee: a.entry_fee, rating: a.rating, distanceKm: a.distanceKm })),
      userLocation: typeof lat === 'number' ? { lat, lng } : null,
    };
    const history = (input.history ?? []).slice(-6).map((h) => ({
      role: h.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: String(h.content).slice(0, 400),
    }));
    const aiAnswer = await callOpenAI(
      env,
      [
        {
          role: 'system',
          content:
            'You are Trippy, the travel concierge for TRIPSPHERE (Indian tourism). Answer in 2-4 short sentences, warm and concrete. Use only the supplied context for names and prices. Never claim a booking is confirmed; bookings in this product are requests. If the context is insufficient, say so and suggest the closest option. Do not use markdown headings or bullet lists.',
        },
        ...history,
        { role: 'user', content: `Traveller question: ${message}\n\nContext JSON: ${JSON.stringify(context)}` },
      ],
      { maxTokens: 320 },
    );
    if (aiAnswer) {
      return {
        answer: aiAnswer.trim(),
        cards,
        suggestions: buildSuggestions(named?.name, wantsHotel, wantsFood, wantsCost),
        mode: 'openai',
      };
    }
    notice = 'Live AI is configured but did not respond, so this answer uses the built-in travel engine.';
  }

  if (!notice && aiMode(env) === 'smart-engine') {
    notice = 'Built-in travel engine. Add an OpenAI key on the server to enable live conversational AI.';
  }

  return {
    answer,
    cards: dedupeCards(cards).slice(0, 6),
    suggestions: buildSuggestions(named?.name, wantsHotel, wantsFood, wantsCost),
    mode: aiMode(env),
    notice,
  };
}

function parseBudget(text: string): number | null {
  const match = text.match(/(?:under|below|within|upto|up to|max)\s*(?:₹|rs\.?|inr)?\s*(\d{3,6})/);
  if (match) return Number(match[1]);
  return null;
}

function dedupeCards(cards: AiCard[]): AiCard[] {
  const seen = new Set<string>();
  return cards.filter((card) => {
    const key = `${card.type}:${card.slug}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSuggestions(destination: string | undefined, hotel: boolean, food: boolean, cost: boolean): string[] {
  const place = destination ? ` in ${destination}` : '';
  const pool = [
    `Plan a 2-day trip${place}`,
    `Hotels under ₹3000${place}`,
    `Best restaurants${place}`,
    `What can I see in 3 hours${place}?`,
    'Suggest hidden destinations in Karnataka',
    `How much will a trip${place} cost?`,
  ];
  if (hotel) return pool.slice(2);
  if (food) return pool.slice(0, 3);
  if (cost) return [pool[0], pool[1], pool[5]];
  return pool.slice(0, 4);
}
