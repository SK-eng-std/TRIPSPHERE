import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Destination } from '../lib/types';

let cache: Destination[] | null = null;

export default function DestinationPicker({
  value,
  onChange,
  label = 'Destination',
}: {
  value: number | '';
  onChange: (id: number) => void;
  label?: string;
}) {
  const [destinations, setDestinations] = useState<Destination[]>(cache ?? []);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (cache) return;
    api<{ destinations: Destination[] }>('/destinations?limit=60')
      .then((data) => {
        cache = data.destinations;
        setDestinations(data.destinations);
      })
      .catch(() => setError(true));
  }, []);

  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
        <option value="">{error ? 'Could not load destinations' : 'Choose a destination…'}</option>
        {destinations.map((destination) => (
          <option key={destination.id} value={destination.id}>
            {destination.name}, {destination.state}
            {destination.is_hidden ? ' — hidden gem' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
