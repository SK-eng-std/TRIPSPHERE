import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Alert } from '../components/UI';
import Logo from '../components/Logo';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/profile';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap" style={{ paddingTop: 40 }}>
      <div className="split" style={{ alignItems: 'stretch' }}>
        <div style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden', position: 'relative', minHeight: 460 }}>
          <img src="/images/hero.jpg" alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(9,20,16,.25), rgba(9,20,16,.85))' }} />
          <div style={{ position: 'relative', padding: 34, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', color: 'var(--sand)' }}>
            <Logo light size={40} />
            <h2 style={{ fontSize: 34, fontWeight: 400, marginTop: 16 }}>Welcome back to the sphere.</h2>
            <p style={{ fontSize: 13, color: 'rgba(247,241,230,.7)', marginTop: 8, maxWidth: 340 }}>
              Your itineraries, bookings, passport and photos are waiting exactly where you left them.
            </p>
          </div>
        </div>

        <div className="panel" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 'clamp(24px, 4vw, 44px)' }}>
          <span className="eyebrow">Sign in</span>
          <h1 style={{ fontSize: 34, margin: '10px 0 20px' }}>Continue your journey.</h1>
          <form onSubmit={submit} className="col" style={{ gap: 14 }}>
            <div className="field">
              <label htmlFor="login-email">Email</label>
              <input id="login-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
            </div>
            <div className="field">
              <label htmlFor="login-password">Password</label>
              <input id="login-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" />
            </div>
            {error && <Alert tone="error">{error}</Alert>}
            <button type="submit" className="btn btn-block" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 18 }}>
            New here?{' '}
            <Link to={`/register?next=${encodeURIComponent(next)}`} className="link">
              Create an account
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
