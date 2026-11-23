import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Logo from './Logo';
import Assistant from './Assistant';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/', label: 'Home' },
  { to: '/explore', label: 'Explore' },
  { to: '/plan', label: 'AI Trip Planner' },
  { to: '/hotels', label: 'Hotels' },
  { to: '/restaurants', label: 'Restaurants' },
  { to: '/trips', label: 'My Trips' },
];

const MORE = [
  { to: '/attractions', label: 'Nearby attractions' },
  { to: '/guides', label: 'Travel guides' },
  { to: '/budget', label: 'Budget calculator' },
  { to: '/passport', label: 'Digital passport' },
  { to: '/history', label: 'Travel timeline' },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setMenuOpen(false);
    setMoreOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1081px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    closeOnDesktop();
    desktop.addEventListener('change', closeOnDesktop);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setMoreOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      desktop.removeEventListener('change', closeOnDesktop);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const isActive = (to: string) => (to === '/' ? location.pathname === '/' : location.pathname.startsWith(to));

  return (
    <>
      <header className="nav">
        <div className="wrap nav-inner">
          <Link to="/" className="brand" aria-label="TRIPSPHERE home">
            <Logo />
            <span className="brand-text">
              <span className="brand-name">TRIPSPHERE</span>
              <span className="brand-tag">Explore beyond boundaries</span>
            </span>
          </Link>

          <nav className="nav-links" aria-label="Main navigation">
            {NAV.map((item) => (
              <Link key={item.to} to={item.to} className={`nav-link ${isActive(item.to) ? 'active' : ''}`}>
                {item.label}
              </Link>
            ))}
            <div className="more" onMouseLeave={() => setMoreOpen(false)}>
              <button
                type="button"
                className={`more-trigger ${moreOpen ? 'open' : ''}`}
                aria-expanded={moreOpen}
                aria-haspopup="true"
                onClick={() => setMoreOpen((v) => !v)}
              >
                More
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
              {moreOpen && (
                <div className="more-menu" role="menu">
                  {MORE.map((item) => (
                    <Link key={item.to} to={item.to} role="menuitem">
                      {item.label}
                      <span>↗</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </nav>

          <div className="nav-actions">
            {user ? (
              <Link to="/profile" className={`account ${location.pathname.startsWith('/profile') ? 'active' : ''}`}>
                <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
                <span>{user.name.split(' ')[0] || 'Profile'}</span>
              </Link>
            ) : (
              <>
                <Link to="/login" className="btn btn-sm btn-ghost">
                  Sign in
                </Link>
                <Link to="/register" className="btn btn-sm btn-accent">
                  Get started
                </Link>
              </>
            )}
            <button type="button" className="nav-burger" aria-label="Toggle menu" onClick={() => setMenuOpen((v) => !v)}>
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>

        {menuOpen && <div className="drawer-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />}

        {menuOpen && (
          <div className="mobile-drawer">
            {[...NAV, ...MORE].map((item) => (
              <Link key={item.to} to={item.to} style={isActive(item.to) ? { color: 'var(--blue)' } : undefined}>
                {item.label}
              </Link>
            ))}
            <Link to="/profile">Profile</Link>
            <div className="drawer-actions">
              {user ? (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={async () => {
                    await logout();
                    navigate('/');
                  }}
                >
                  Sign out
                </button>
              ) : (
                <>
                  <Link to="/login" className="btn btn-sm btn-ghost">
                    Sign in
                  </Link>
                  <Link to="/register" className="btn btn-sm">
                    Create account
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <main>{children}</main>

      <footer className="footer">
        <div className="wrap">
          <div className="footer-grid">
            <div>
              <Link to="/" className="brand" style={{ marginBottom: 14 }}>
                <Logo />
                <span className="brand-text">
                  <span className="brand-name">TRIPSPHERE</span>
                  <span className="brand-tag">Explore beyond boundaries</span>
                </span>
              </Link>
              <p style={{ fontSize: 12, lineHeight: 1.75, color: 'rgba(255,255,255,.6)', maxWidth: 280 }}>
                An AI-powered travel companion for India. Plan whole journeys, discover nearby places, compare stays and
                tables, and keep a passport that grows with every trip.
              </p>
            </div>
            <div>
              <h4>Discover</h4>
              <Link to="/explore">Destinations</Link>
              <Link to="/attractions">Attractions</Link>
              <Link to="/hotels">Hotels</Link>
              <Link to="/restaurants">Restaurants</Link>
              <Link to="/explore?hidden=1">Hidden gems</Link>
            </div>
            <div>
              <h4>Plan</h4>
              <Link to="/plan">AI trip planner</Link>
              <Link to="/budget">Budget calculator</Link>
              <Link to="/history">Travel timeline</Link>
              <Link to="/passport">Digital passport</Link>
              <Link to="/guides">Travel guides</Link>
            </div>
            <div>
              <h4>Account</h4>
              <Link to="/trips">My trips</Link>
              <Link to="/profile">Profile and bookings</Link>
              <Link to="/login">Sign in</Link>
              <Link to="/register">Create an account</Link>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} TRIPSPHERE · Explore Beyond Boundaries.</span>
            <span>
              Hotel and restaurant inventory is sample data for demonstration. Bookings are requests, not confirmed
              reservations. Distances and costs are estimates.
            </span>
          </div>
        </div>
      </footer>

      <Assistant />
    </>
  );
}
