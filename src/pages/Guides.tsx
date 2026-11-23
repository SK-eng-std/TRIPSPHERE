import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { Guide } from '../lib/types';
import { Chip, Empty, Loading } from '../components/UI';

export default function Guides() {
  const [guides, setGuides] = useState<Guide[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('');

  useEffect(() => {
    api<{ guides: Guide[] }>('/guides')
      .then((data) => setGuides(data.guides))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(() => Array.from(new Set(guides.map((guide) => guide.category))), [guides]);
  const filtered = category ? guides.filter((guide) => guide.category === category) : guides;

  return (
    <div className="wrap">
      <header className="page-head">
        <span className="eyebrow">Field notes</span>
        <h1>Guides from the road.</h1>
        <p>
          Timing, routes and food worth planning around. These are working notes for independent travellers, not
          brochures — including the parts that do not go to plan.
        </p>
      </header>

      <div className="chip-row" style={{ marginBottom: 24 }}>
        <Chip active={!category} onClick={() => setCategory('')}>All notes</Chip>
        {categories.map((item) => (
          <Chip key={item} active={category === item} onClick={() => setCategory(item)}>
            {item.replace('-', ' ')}
          </Chip>
        ))}
      </div>

      {loading && <Loading label="Opening the notebook" />}
      {!loading && filtered.length === 0 && <Empty title="No guides yet" />}

      <div className="grid grid-3">
        {filtered.map((guide) => (
          <Link key={guide.slug} to={`/guides/${guide.slug}`} className="dest-card">
            <div className="dest-media" style={{ aspectRatio: '16 / 10' }}>
              <img src={guide.image} alt={guide.title} loading="lazy" />
              <span className="float-tag">{guide.category.replace('-', ' ')}</span>
            </div>
            <div className="dest-body">
              <div className="dest-meta">
                <span>{guide.destination_name ?? 'Across India'}</span>
                <span>·</span>
                <span>{guide.read_minutes} min read</span>
              </div>
              <h3 className="dest-title" style={{ fontSize: 21 }}>{guide.title}</h3>
              <p className="dest-summary">{guide.excerpt}</p>
              <div className="dest-foot">
                <span>{guide.author}</span>
                <span className="link">Read →</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
