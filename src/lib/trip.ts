import type { ItineraryItem } from './types';

export function itemType(item: ItineraryItem): string {
  return item.placeType ?? item.place_type ?? 'custom';
}

export function itemDuration(item: ItineraryItem): number {
  return Number(item.durationMinutes ?? item.duration_minutes ?? 90);
}

export function groupByDay(items: ItineraryItem[]): { day: number; items: ItineraryItem[] }[] {
  const map = new Map<number, ItineraryItem[]>();
  for (const item of items) {
    const day = Number(item.day ?? 1);
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(item);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([day, list]) => ({
      day,
      items: [...list].sort((a, b) => {
        const orderA = a.sort_order ?? 0;
        const orderB = b.sort_order ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        return String(a.time).localeCompare(String(b.time));
      }),
    }));
}

export function tripDays(items: ItineraryItem[]): number {
  return Math.max(1, ...items.map((item) => Number(item.day ?? 1)));
}

export const TRANSPORT_OPTIONS = [
  { value: 'car', label: 'Self-drive car' },
  { value: 'taxi', label: 'Taxi / cab' },
  { value: 'bike', label: 'Motorcycle' },
  { value: 'train', label: 'Train' },
  { value: 'bus', label: 'Bus' },
  { value: 'flight', label: 'Flight' },
];

export const INTERESTS = [
  'adventure',
  'nature',
  'heritage',
  'history',
  'culture',
  'beach',
  'mountains',
  'shopping',
  'food',
  'relaxation',
  'wildlife',
  'photography',
];

export const INTEREST_LABELS: Record<string, string> = {
  adventure: 'Adventure',
  nature: 'Nature',
  heritage: 'Historical places',
  history: 'History',
  culture: 'Cultural experiences',
  beach: 'Beaches',
  mountains: 'Mountains',
  shopping: 'Shopping',
  food: 'Food experiences',
  relaxation: 'Relaxation',
  wildlife: 'Wildlife',
  photography: 'Photography',
  religion: 'Temples',
  nightlife: 'Nightlife',
  family: 'Family',
};

export const PACE_OPTIONS = [
  { value: 'slow', label: 'Slow — one anchor a day' },
  { value: 'balanced', label: 'Balanced — two stops a day' },
  { value: 'packed', label: 'Packed — see as much as possible' },
];
