import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Alert } from '../components/UI';
import Logo from '../components/Logo';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/profile';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register(name, email, password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap" style={{ paddingTop: 40 }}>
      <div className="split" style={{ alignItems: 'stretch' }}>
        <div style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden', position: 'relative', minHeight: 520 }}>
          <img src="/images/kerala.jpg" alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(9,20,16,.2), rgba(9,20,16,.88))' }} />
          <div style={{ position: 'relative', padding: 34, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', color: 'var(--sand)' }}>
            <Logo light size={40} />
            <h2 style={{ fontSize: 34, fontWeight: 400, marginTop: 16 }}>One account, the whole journey.</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: '14px 0 0', fontSize: 12.5, lineHeight: 2, color: 'rgba(247,241,230,.75)' }}>
              <li>· AI itineraries and shareable trip plans</li>
              <li>· Hotel and restaurant requests in one dashboard</li>
              <li>· Digital travel passport with badges</li>
              <li>· Private photo memories and expense tracking</li>
            </ul>
          </div>
        </div>

        <div className="panel" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 'clamp(24px, 4vw, 44px)' }}>
          <span className="eyebrow">Create account</span>
          <h1 style={{ fontSize: 32, margin: '10px 0 18px' }}>Start your passport.</h1>
          <form onSubmit={submit} className="col" style={{ gap: 13 }}>
            <div className="field">
              <label htmlFor="reg-name">Full name</label>
              <input id="reg-name" required minLength={2} value={name} onChange={(event) => setName(event.target.value)} placeholder="Aditi Rao" />
            </div>
            <div className="field">
              <label htmlFor="reg-email">Email</label>
              <input id="reg-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
            </div>
            <div className="form-grid" style={{ gap: 10 }}>
              <div className="field">
                <label htmlFor="reg-password">Password</label>
                <input id="reg-password" type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="reg-confirm">Confirm</label>
                <input id="reg-confirm" type="password" required minLength={8} value={confirm} onChange={(event) => setConfirm(event.target.value)} />
              </div>
            </div>
            {error && <Alert tone="error">{error}</Alert>}
            <button type="submit" className="btn btn-block" disabled={busy}>
              {busy ? 'Creating account…' : 'Create my account'}
            </button>
          </form>
          <p className="form-note" style={{ marginTop: 12 }}>
            Passwords are hashed with PBKDF2 on the server. We never store the raw password.
          </p>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 14 }}>
            Already have an account?{' '}
            <Link to={`/login?next=${encodeURIComponent(next)}`} className="link">
              Sign in
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
