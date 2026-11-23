import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export function Chip({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button type="button" className={`chip ${active ? 'active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

export function Rating({ value, reviews }: { value: number; reviews?: number }) {
  return (
    <span className="rating">
      ★ {value.toFixed(1)}
      {reviews !== undefined && <span>({reviews.toLocaleString('en-IN')})</span>}
    </span>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="loading-block">
      <span className="spinner" />
      {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'error' | 'ok'; children: React.ReactNode }) {
  return <div className={`alert alert-${tone}`}>{children}</div>;
}

export function SaveButton({
  placeType,
  placeId,
  label = 'Save',
}: {
  placeType: 'destination' | 'attraction' | 'hotel' | 'restaurant';
  placeId: number;
  label?: string;
}) {
  const { user } = useAuth();
  const [saved, setSaved] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    api<{ saved: { placeType: string; placeId: number }[] }>('/saved')
      .then((data) => {
        if (!active) return;
        setSaved(data.saved.some((item) => item.placeType === placeType && item.placeId === placeId));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [user, placeType, placeId]);

  if (!user) {
    return (
      <Link to="/login" className="saved-btn">
        ♡ {label}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={`saved-btn ${saved ? 'on' : ''}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const result = await api<{ saved: boolean }>('/saved', {
            method: 'POST',
            body: { placeType, placeId },
          });
          setSaved(result.saved);
        } catch {
          /* leave state unchanged */
        } finally {
          setBusy(false);
        }
      }}
    >
      {saved ? '♥ Saved' : `♡ ${label}`}
    </button>
  );
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="stat">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <button key={tab.id} type="button" className={`tab ${value === tab.id ? 'active' : ''}`} onClick={() => onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function SectionHead({
  eyebrow,
  title,
  desc,
  action,
}: {
  eyebrow: string;
  title: React.ReactNode;
  desc?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2 className="section-title">{title}</h2>
        {desc && <p className="section-desc">{desc}</p>}
      </div>
      {action}
    </div>
  );
}
