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

export function resolveMediaUrl(url: string): string {
  if (ASSET_MAP[url]) return ASSET_MAP[url];
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
