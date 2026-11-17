interface NmcLogoProps {
  logoUrl: string;
  brandName: string;
}

export function NmcLogo({ logoUrl, brandName }: NmcLogoProps) {
  return (
    <span className="inline-flex items-center gap-2.5">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={brandName || 'Logo NMC'}
          className="h-9 sm:h-10 w-auto max-w-[160px] object-contain rounded-lg bg-white/10 p-0.5"
        />
      ) : (
        <svg
          width="36"
          height="36"
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="w-8 h-8 sm:w-9 sm:h-9 shrink-0"
        >
          <rect x="1.5" y="1.5" width="37" height="37" rx="10" fill="#1D4ED8" stroke="#FACC15" strokeWidth="2.5" />
          <circle cx="20" cy="14.5" r="5" stroke="#FACC15" strokeWidth="2" />
          <circle cx="20" cy="14.5" r="2" fill="#FFFFFF" />
          <text
            x="20"
            y="32"
            textAnchor="middle"
            fill="#FFFFFF"
            fontSize="11"
            fontWeight="800"
            fontFamily="system-ui, -apple-system, sans-serif"
            letterSpacing="0.8"
          >
            NMC
          </text>
        </svg>
      )}
      {brandName && (
        <span className="font-serif text-lg sm:text-xl font-semibold tracking-tight text-white">
          {brandName}
        </span>
      )}
    </span>
  );
}
