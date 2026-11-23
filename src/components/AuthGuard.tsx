import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Loading } from './UI';

export default function AuthGuard({ children, title = 'Sign in to continue' }: { children: React.ReactNode; title?: string }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="wrap"><Loading label="Checking your session" /></div>;

  if (!user) {
    return (
      <div className="wrap" style={{ paddingTop: 60, paddingBottom: 80 }}>
        <div className="panel" style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
          <span className="eyebrow">Members only</span>
          <h2 style={{ fontSize: 32, margin: '10px 0 12px' }}>{title}</h2>
          <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.7, marginBottom: 22 }}>
            Your trips, bookings, reservations and travel passport live in your account. Sign in or create one in a few
            seconds.
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link to={`/login?next=${encodeURIComponent(location.pathname)}`} className="btn">
              Sign in
            </Link>
            <Link to={`/register?next=${encodeURIComponent(location.pathname)}`} className="btn btn-ghost">
              Create account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
