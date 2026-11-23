import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { Guide } from '../lib/types';
import { Empty, Loading } from '../components/UI';

export default function GuideDetail() {
  const { slug = '' } = useParams();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGuide(null);
    setError(null);
    api<{ guide: Guide }>(`/guides/${slug}`)
      .then((data) => setGuide(data.guide))
      .catch((err) => setError(err instanceof Error ? err.message : 'Guide not found'));
  }, [slug]);

  if (error) return <div className="wrap" style={{ paddingTop: 60 }}><Empty title="Guide not found">{error}</Empty></div>;
  if (!guide) return <div className="wrap"><Loading label="Opening guide" /></div>;

  const paragraphs = (guide.body ?? guide.excerpt).split('\n').map((line) => line.trim()).filter(Boolean);

  return (
    <article className="wrap" style={{ maxWidth: 860 }}>
      <div className="breadcrumb" style={{ paddingTop: 22 }}>
        <Link to="/guides">Guides</Link>
        <span>/</span>
        <span>{guide.category.replace('-', ' ')}</span>
      </div>

      <span className="eyebrow">{guide.category.replace('-', ' ')}</span>
      <h1 className="prose-head" style={{ marginTop: 12 }}>{guide.title}</h1>
      <div className="row row-wrap" style={{ gap: 12, marginBottom: 22 }}>
        <span className="tag">{guide.read_minutes} min read</span>
        <span className="muted" style={{ fontSize: 11.5 }}>{guide.author}</span>
        {guide.destination_slug && (
          <Link to={`/explore/${guide.destination_slug}`} className="tag tag-sage">
            {guide.destination_name}
          </Link>
        )}
      </div>

      <img
        src={guide.image}
        alt={guide.title}
        style={{ width: '100%', height: 420, objectFit: 'cover', borderRadius: 'var(--radius-lg)', marginBottom: 30 }}
      />

      <p style={{ fontFamily: 'var(--serif)', fontSize: 20, lineHeight: 1.6, color: 'var(--ink-2)', marginBottom: 26 }}>
        {guide.excerpt}
      </p>

      <div className="rte">
        {paragraphs.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>

      <div className="hr" />
      <div className="row-between row-wrap" style={{ gap: 16 }}>
        <div>
          <span className="eyebrow">Put it into practice</span>
          <p className="form-note" style={{ marginTop: 6 }}>Build a plan around this route in a few clicks.</p>
        </div>
        <div className="row">
          <Link to="/plan" className="btn btn-sm">Open the planner</Link>
          <Link to="/guides" className="btn btn-sm btn-ghost">All guides</Link>
        </div>
      </div>
    </article>
  );
}
