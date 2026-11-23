import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="wrap" style={{ padding: '90px 0' }}>
      <div className="panel" style={{ maxWidth: 620, margin: '0 auto', textAlign: 'center', padding: 48 }}>
        <span className="eyebrow">Off the map</span>
        <h1 style={{ fontSize: 'clamp(40px, 7vw, 72px)', margin: '12px 0' }}>404</h1>
        <p className="muted" style={{ marginBottom: 24 }}>
          This path does not lead anywhere yet. Try a destination, or let the planner take over.
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link to="/" className="btn">Back home</Link>
          <Link to="/explore" className="btn btn-ghost">Explore</Link>
        </div>
      </div>
    </div>
  );
}
