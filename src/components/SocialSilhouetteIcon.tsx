import type { SocialPlatform } from '../types';
import { CloudImage } from './CloudMedia';

interface SocialSilhouetteIconProps {
  platform: SocialPlatform;
  customIconUrl?: string;
  label?: string;
  className?: string;
  tone?: 'light' | 'dark';
}

export function SocialSilhouetteIcon({
  platform,
  customIconUrl,
  label,
  className = 'w-5 h-5',
  tone = 'light',
}: SocialSilhouetteIconProps) {
  if (customIconUrl) {
    return (
      <CloudImage
        src={customIconUrl}
        alt={label || platform}
        className={`${className} object-contain ${
          tone === 'light' ? 'brightness-0 invert' : 'brightness-0'
        }`}
      />
    );
  }

  switch (platform) {
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
          <path d="M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2Zm0 2A3.75 3.75 0 0 0 4 7.75v8.5A3.75 3.75 0 0 0 7.75 20h8.5A3.75 3.75 0 0 0 20 16.25v-8.5A3.75 3.75 0 0 0 16.25 4h-8.5Zm9.5 1.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5ZM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
        </svg>
      );
    case 'tiktok':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
          <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V8.94a6.34 6.34 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15.2a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.71a8.26 8.26 0 0 0 4.76 1.5V6.77a4.8 4.8 0 0 1-1-.08Z" />
        </svg>
      );
    case 'youtube':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814ZM9.545 15.568V8.432L15.818 12l-6.273 3.568Z" />
        </svg>
      );
    case 'facebook':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
          <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.51 1.49-3.9 3.78-3.9 1.09 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.44 2.91h-2.34V22c4.78-.76 8.44-4.92 8.44-9.94Z" />
        </svg>
      );
    case 'x':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117Z" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
          <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm6.93 6h-2.95a15.65 15.65 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.93 8ZM12 4.04A13.66 13.66 0 0 1 13.86 8h-3.72A13.66 13.66 0 0 1 12 4.04ZM4.26 14a7.8 7.8 0 0 1 0-4h3.38a16.5 16.5 0 0 0-.14 2 16.5 16.5 0 0 0 .14 2Zm.81 2h2.95a15.65 15.65 0 0 0 1.38 3.56A8.03 8.03 0 0 1 5.07 16Zm2.95-8H5.07a8.03 8.03 0 0 1 4.33-3.56A15.65 15.65 0 0 0 8.02 8ZM12 19.96A13.66 13.66 0 0 1 10.14 16h3.72A13.66 13.66 0 0 1 12 19.96ZM14.34 14H9.66a14.48 14.48 0 0 1-.16-2 14.48 14.48 0 0 1 .16-2h4.68a14.48 14.48 0 0 1 .16 2 14.48 14.48 0 0 1-.16 2Zm.26 5.56A15.65 15.65 0 0 0 15.98 16h2.95a8.03 8.03 0 0 1-4.33 3.56ZM16.36 14a16.5 16.5 0 0 0 .14-2 16.5 16.5 0 0 0-.14-2h3.38a7.8 7.8 0 0 1 0 4Z" />
        </svg>
      );
  }
}
