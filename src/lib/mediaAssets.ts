import heroStudio from '../assets/images/hero_mmc_studio_1794726375759.jpg';
import newsLiputan from '../assets/images/news_liputan_sekolah_1794726377007.jpg';
import newsPodcast from '../assets/images/news_podcast_penyiaran_1794726376220.jpg';
import workCiamis from '../assets/images/work_ciamis_landscape_1794726377278.jpg';
import workEditing from '../assets/images/work_editing_workshop_1794726378085.jpg';

const ASSET_MAP: Record<string, string> = {
  'asset:hero_studio': heroStudio,
  'asset:news_liputan': newsLiputan,
  'asset:news_podcast': newsPodcast,
  'asset:work_ciamis': workCiamis,
  'asset:work_editing': workEditing,
};

export function extractGoogleDriveFileId(rawUrl: string): string | null {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return null;

  // https://drive.google.com/file/d/<ID>/view?... or /file/u/0/d/<ID>/view
  const filePathMatch = trimmed.match(/drive\.google\.com\/(?:file\/(?:u\/\d+\/)?d|thumbnail|open)\/?([a-zA-Z0-9_-]{15,})/i);
  if (filePathMatch?.[1]) return filePathMatch[1];

  // https://drive.google.com/open?id=<ID> or /uc?id=<ID> or /thumbnail?id=<ID> or drive.usercontent.google.com/download?id=<ID>
  if (/drive\.google\.com|drive\.usercontent\.google\.com/i.test(trimmed)) {
    const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{15,})/i);
    if (idParamMatch?.[1]) return idParamMatch[1];
  }

  // https://lh3.googleusercontent.com/d/<ID>=w1600 or /d/<ID>
  const lh3Match = trimmed.match(/lh\d\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]{15,})/i);
  if (lh3Match?.[1]) return lh3Match[1];

  return null;
}

export function getGoogleDriveImageCandidates(rawUrl: string): string[] {
  const fileId = extractGoogleDriveFileId(rawUrl);
  if (!fileId) return [];
  return [
    `https://lh3.googleusercontent.com/d/${fileId}=w1600`,
    `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`,
    `https://drive.google.com/uc?export=view&id=${fileId}`,
  ];
}

export function normalizeWorkMediaUrl(rawUrl: string, mediaType: 'image' | 'video' = 'image'): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  const driveId = extractGoogleDriveFileId(trimmed);
  if (driveId) {
    return mediaType === 'video'
      ? `https://drive.google.com/uc?export=download&id=${driveId}`
      : `https://lh3.googleusercontent.com/d/${driveId}=w1600`;
  }
  return trimmed;
}

export function resolveMediaUrl(url: string): string {
  if (!url) return '';
  if (ASSET_MAP[url]) return ASSET_MAP[url];
  const driveId = extractGoogleDriveFileId(url);
  if (driveId) {
    return `https://lh3.googleusercontent.com/d/${driveId}=w1600`;
  }
  return url;
}

export const HERO_IMAGE = heroStudio;

export function formatDateID(dateStr: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

export function formatTimeAgo(isoStr: string): string {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return isoStr;
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return 'Baru saja';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} menit lalu`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} jam lalu`;
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

export function formatLocalClock(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function getLocalTimeZoneLabel(date: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('id-ID', { timeZoneName: 'short' }).formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (tzPart) return tzPart;
  } catch {
    // fallback below
  }
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const absH = Math.floor(Math.abs(offsetMin) / 60);
  const absM = Math.abs(offsetMin) % 60;
  return absM === 0 ? `GMT${sign}${absH}` : `GMT${sign}${absH}:${String(absM).padStart(2, '0')}`;
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}
