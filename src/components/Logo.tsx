export default function Logo({ size = 38 }: { size?: number; light?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" className="brand-mark">
      <defs>
        <linearGradient id="tsGlobeGradient" x1="2" y1="2" x2="46" y2="46" gradientUnits="userSpaceOnUse">
          <stop stopColor="#315BEB" />
          <stop offset="1" stopColor="#7657E8" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill="url(#tsGlobeGradient)" />
      <circle cx="24" cy="25" r="12" stroke="#FFFFFF" strokeWidth="1.6" opacity="0.95" />
      <ellipse cx="24" cy="25" rx="5.4" ry="12" stroke="#FFFFFF" strokeWidth="1.25" opacity="0.78" />
      <path d="M12 25h24" stroke="#FFFFFF" strokeWidth="1.25" opacity="0.78" />
      <path d="M14.2 19h19.6M14.2 31h19.6" stroke="#FFFFFF" strokeWidth="1" opacity="0.5" />
      <path d="M33.6 11.4l1.9 4.3 4.3 1.9-4.3 1.9-1.9 4.3-1.9-4.3-4.3-1.9 4.3-1.9z" fill="#FFFFFF" />
    </svg>
  );
}
