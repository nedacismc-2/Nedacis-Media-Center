import type {
  AdminLmsTask,
  AttendanceRecord,
  NewsArticle,
  ScheduleItem,
  SiteBranding,
  StudentProfile,
  StudentWork,
} from '../types';

export const NMC_DRIVE_FOLDER_NAME = 'NMC Admin Storage (SMPN 2 Ciamis)';

const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';

export type DriveAdminFileKind = 'backup' | 'members' | 'document' | 'media';

export interface GoogleDriveFolderInfo {
  id: string;
  name: string;
  webViewLink?: string;
}

export interface GoogleDriveAdminFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedTime: string;
  createdTime?: string;
  webViewLink?: string;
  description?: string;
  kind: DriveAdminFileKind;
}

export interface AdminDriveSnapshotMember {
  username: string;
  role: 'admin' | 'student';
  full_name: string;
  nis: string;
  kelas: string;
  division: string;
  bio: string;
  nfc_uid: string;
  qr_code_token: string;
  parent_whatsapp: string;
  avatar_color: string;
  avatar_url?: string;
  show_in_members?: number;
  attendance_count?: number;
  works_count?: number;
  lms_points?: number;
}

export interface AdminDriveSnapshotPayload {
  schemaVersion: 'nmc-admin-backup-v1';
  exportedAt: string;
  app: string;
  source: 'cloud-portal' | 'hybrid-sqlite';
  siteSettings: SiteBranding;
  members: AdminDriveSnapshotMember[];
  news: NewsArticle[];
  schedules: ScheduleItem[];
  works: StudentWork[];
  attendance: AttendanceRecord[];
  lmsTasks: AdminLmsTask[];
  sqliteExport?: Record<string, unknown>;
}

export interface ParsedAdminBackupPreview {
  exportedAt: string;
  appName: string;
  members: AdminDriveSnapshotMember[];
  siteSettings: SiteBranding | null;
  newsCount: number;
  schedulesCount: number;
  worksCount: number;
  attendanceCount: number;
  lmsTasksCount: number;
}

export class GoogleDriveApiError extends Error {
  status: number;
  isAuthError: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'GoogleDriveApiError';
    this.status = status;
    this.isAuthError = status === 401 || status === 403;
  }
}

interface RawDriveFile {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string | number;
  modifiedTime?: string;
  createdTime?: string;
  webViewLink?: string;
  description?: string;
  appProperties?: Record<string, string>;
}

function inferDriveFileKind(raw: RawDriveFile): DriveAdminFileKind {
  const propKind = raw.appProperties?.nmcKind;
  if (
    propKind === 'backup' ||
    propKind === 'members' ||
    propKind === 'document' ||
    propKind === 'media'
  ) {
    return propKind;
  }
  const lower = (raw.name || '').toLowerCase();
  const mime = (raw.mimeType || '').toLowerCase();
  if (lower.endsWith('.json') || lower.includes('backup')) return 'backup';
  if (lower.endsWith('.csv') || lower.includes('anggota')) return 'members';
  if (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/')) {
    return 'media';
  }
  return 'document';
}

function normalizeDriveFile(raw: RawDriveFile): GoogleDriveAdminFile {
  return {
    id: String(raw.id || ''),
    name: String(raw.name || 'Tanpa Nama'),
    mimeType: String(raw.mimeType || 'application/octet-stream'),
    size: Number(raw.size || 0),
    modifiedTime: String(raw.modifiedTime || raw.createdTime || new Date().toISOString()),
    createdTime: raw.createdTime,
    webViewLink: raw.webViewLink,
    description: raw.description,
    kind: inferDriveFileKind(raw),
  };
}

async function parseDriveErrorResponse(res: Response): Promise<GoogleDriveApiError> {
  let detail = `Permintaan Google Drive gagal (HTTP ${res.status}).`;
  try {
    const json = (await res.json()) as {
      error?: { message?: string; status?: string };
    };
    if (json?.error?.message) {
      detail = json.error.message;
    }
  } catch {
    // ignore non-json error bodies
  }
  if (res.status === 401) {
    detail =
      'Sesi izin Google Drive telah berakhir atau belum terhubung. Silakan hubungkan ulang akun Google Anda.';
  } else if (res.status === 403) {
    detail = `Akses Google Drive ditolak (${detail}). Pastikan izin Google Drive disetujui saat masuk.`;
  }
  return new GoogleDriveApiError(detail, res.status);
}

async function driveFetchJson<T>(
  accessToken: string,
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    throw await parseDriveErrorResponse(res);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export async function ensureNmcAdminDriveFolder(
  accessToken: string
): Promise<GoogleDriveFolderInfo> {
  const escapedName = NMC_DRIVE_FOLDER_NAME.replace(/'/g, "\\'");
  const q = `name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const searchParams = new URLSearchParams({
    q,
    spaces: 'drive',
    fields: 'files(id,name,webViewLink)',
    pageSize: '5',
  });

  const found = await driveFetchJson<{ files?: RawDriveFile[] }>(
    accessToken,
    `${DRIVE_FILES_API}?${searchParams.toString()}`
  );
  const existing = found.files?.find((f) => Boolean(f.id));
  if (existing?.id) {
    return {
      id: existing.id,
      name: existing.name || NMC_DRIVE_FOLDER_NAME,
      webViewLink: existing.webViewLink,
    };
  }

  const created = await driveFetchJson<RawDriveFile>(
    accessToken,
    `${DRIVE_FILES_API}?fields=id,name,webViewLink`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        name: NMC_DRIVE_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
        description:
          'Folder penyimpanan cadangan data admin, arsip anggota, dan dokumen portal NMC SMPN 2 Ciamis.',
        appProperties: {
          nmcApp: 'nmc-smpn2-ciamis',
          nmcRoot: 'admin-storage',
        },
      }),
    }
  );

  if (!created.id) {
    throw new GoogleDriveApiError('Gagal membuat folder penyimpanan admin di Google Drive.', 500);
  }

  return {
    id: created.id,
    name: created.name || NMC_DRIVE_FOLDER_NAME,
    webViewLink: created.webViewLink,
  };
}

export async function listNmcDriveFiles(
  accessToken: string,
  folderId: string
): Promise<GoogleDriveAdminFile[]> {
  const escapedFolderId = folderId.replace(/'/g, "\\'");
  const params = new URLSearchParams({
    q: `'${escapedFolderId}' in parents and trashed = false`,
    orderBy: 'modifiedTime desc',
    pageSize: '100',
    fields:
      'files(id,name,mimeType,size,modifiedTime,createdTime,webViewLink,description,appProperties)',
  });

  const res = await driveFetchJson<{ files?: RawDriveFile[] }>(
    accessToken,
    `${DRIVE_FILES_API}?${params.toString()}`
  );
  return (res.files || []).filter((f) => Boolean(f.id)).map(normalizeDriveFile);
}

async function uploadMultipartToDrive(
  accessToken: string,
  options: {
    folderId: string;
    fileName: string;
    mimeType: string;
    content: Blob | string;
    description?: string;
    kind: DriveAdminFileKind;
    existingFileId?: string;
  }
): Promise<GoogleDriveAdminFile> {
  const boundary = `nmc_drive_boundary_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const metadata: Record<string, unknown> = {
    name: options.fileName,
    mimeType: options.mimeType,
    description:
      options.description || `Data admin portal NMC SMPN 2 Ciamis (${options.kind})`,
    appProperties: {
      nmcApp: 'nmc-smpn2-ciamis',
      nmcKind: options.kind,
    },
  };
  if (!options.existingFileId) {
    metadata.parents = [options.folderId];
  }

  const contentBlob =
    typeof options.content === 'string'
      ? new Blob([options.content], { type: options.mimeType })
      : options.content;

  const multipartBody = new Blob(
    [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: ${options.mimeType}\r\n\r\n`,
      contentBlob,
      `\r\n--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` }
  );

  const fields =
    'id,name,mimeType,size,modifiedTime,createdTime,webViewLink,description,appProperties';
  const targetUrl = options.existingFileId
    ? `${DRIVE_UPLOAD_API}/${encodeURIComponent(options.existingFileId)}?uploadType=multipart&fields=${encodeURIComponent(fields)}`
    : `${DRIVE_UPLOAD_API}?uploadType=multipart&fields=${encodeURIComponent(fields)}`;

  const saved = await driveFetchJson<RawDriveFile>(accessToken, targetUrl, {
    method: options.existingFileId ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  return normalizeDriveFile(saved);
}

export async function saveJsonToGoogleDrive(
  accessToken: string,
  folderId: string,
  params: {
    fileName: string;
    data: unknown;
    description?: string;
    kind?: DriveAdminFileKind;
    existingFileId?: string;
  }
): Promise<GoogleDriveAdminFile> {
  return uploadMultipartToDrive(accessToken, {
    folderId,
    fileName: params.fileName,
    mimeType: 'application/json',
    content: JSON.stringify(params.data, null, 2),
    description: params.description,
    kind: params.kind || 'backup',
    existingFileId: params.existingFileId,
  });
}

export async function saveTextToGoogleDrive(
  accessToken: string,
  folderId: string,
  params: {
    fileName: string;
    mimeType: string;
    text: string;
    description?: string;
    kind?: DriveAdminFileKind;
    existingFileId?: string;
  }
): Promise<GoogleDriveAdminFile> {
  return uploadMultipartToDrive(accessToken, {
    folderId,
    fileName: params.fileName,
    mimeType: params.mimeType,
    content: params.text,
    description: params.description,
    kind: params.kind || 'members',
    existingFileId: params.existingFileId,
  });
}

export async function uploadAdminFileToGoogleDrive(
  accessToken: string,
  folderId: string,
  params: {
    file: File;
    fileName?: string;
    description?: string;
    kind?: DriveAdminFileKind;
    existingFileId?: string;
  }
): Promise<GoogleDriveAdminFile> {
  const mime = params.file.type || 'application/octet-stream';
  const defaultKind: DriveAdminFileKind =
    mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/')
      ? 'media'
      : 'document';
  return uploadMultipartToDrive(accessToken, {
    folderId,
    fileName: params.fileName || params.file.name,
    mimeType: mime,
    content: params.file,
    description: params.description,
    kind: params.kind || defaultKind,
    existingFileId: params.existingFileId,
  });
}

export async function downloadGoogleDriveFileBlob(
  accessToken: string,
  fileId: string
): Promise<Blob> {
  const res = await fetch(
    `${DRIVE_FILES_API}/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    throw await parseDriveErrorResponse(res);
  }
  return res.blob();
}

export async function downloadGoogleDriveJson<T = unknown>(
  accessToken: string,
  fileId: string
): Promise<T> {
  const res = await fetch(
    `${DRIVE_FILES_API}/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    throw await parseDriveErrorResponse(res);
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Isi file di Google Drive bukan format JSON backup yang valid.');
  }
}

export async function deleteGoogleDriveFile(
  accessToken: string,
  fileId: string
): Promise<void> {
  await driveFetchJson<void>(
    accessToken,
    `${DRIVE_FILES_API}/${encodeURIComponent(fileId)}`,
    {
      method: 'DELETE',
    }
  );
}

export function buildAdminDriveSnapshot(input: {
  siteSettings: SiteBranding;
  members: StudentProfile[];
  news?: NewsArticle[];
  schedules?: ScheduleItem[];
  works?: StudentWork[];
  attendance?: AttendanceRecord[];
  lmsTasks?: AdminLmsTask[];
  sqliteExport?: Record<string, unknown>;
}): AdminDriveSnapshotPayload {
  return {
    schemaVersion: 'nmc-admin-backup-v1',
    exportedAt: new Date().toISOString(),
    app: 'NMC Digital Portal - SMPN 2 Ciamis',
    source: input.sqliteExport ? 'hybrid-sqlite' : 'cloud-portal',
    siteSettings: input.siteSettings,
    members: input.members.map((m) => ({
      username: m.username,
      role: m.role === 'admin' ? 'admin' : 'student',
      full_name: m.full_name,
      nis: m.nis,
      kelas: m.kelas,
      division: m.division,
      bio: m.bio || '',
      nfc_uid: m.nfc_uid || '',
      qr_code_token: m.qr_code_token || '',
      parent_whatsapp: m.parent_whatsapp || '',
      avatar_color: m.avatar_color || '#1D4ED8',
      avatar_url: m.avatar_url || '',
      show_in_members: m.show_in_members ?? (m.role === 'student' ? 1 : 0),
      attendance_count: Number(m.attendance_count || 0),
      works_count: Number(m.works_count || 0),
      lms_points: Number(m.lms_points || 0),
    })),
    news: input.news || [],
    schedules: input.schedules || [],
    works: input.works || [],
    attendance: input.attendance || [],
    lmsTasks: input.lmsTasks || [],
    ...(input.sqliteExport ? { sqliteExport: input.sqliteExport } : {}),
  };
}

export function parseAdminBackupSnapshot(raw: unknown): ParsedAdminBackupPreview {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Format file backup Google Drive tidak dikenali.');
  }
  const obj = raw as Record<string, unknown>;

  const rawMembers = Array.isArray(obj.members)
    ? obj.members
    : Array.isArray(obj.users)
    ? obj.users
    : [];

  const members: AdminDriveSnapshotMember[] = rawMembers
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((m): AdminDriveSnapshotMember => ({
      username: String(m.username || '').trim(),
      role: String(m.role || '').toLowerCase() === 'admin' ? 'admin' : 'student',
      full_name: String(m.full_name || m.username || '').trim(),
      nis: String(m.nis || '').trim(),
      kelas: String(m.kelas || '8A').trim(),
      division: String(m.division || 'Fotografi').trim(),
      bio: String(m.bio || ''),
      nfc_uid: String(m.nfc_uid || '').trim(),
      qr_code_token: String(m.qr_code_token || '').trim(),
      parent_whatsapp: String(m.parent_whatsapp || '').trim(),
      avatar_color: String(m.avatar_color || '#1D4ED8'),
      avatar_url: String(m.avatar_url || ''),
      show_in_members:
        typeof m.show_in_members === 'number'
          ? m.show_in_members
          : String(m.role || '').toLowerCase() === 'admin'
          ? 0
          : 1,
      attendance_count: Number(m.attendance_count || 0),
      works_count: Number(m.works_count || 0),
      lms_points: Number(m.lms_points || 0),
    }))
    .filter((m) => Boolean(m.username));

  let siteSettings: SiteBranding | null = null;
  if (obj.siteSettings && typeof obj.siteSettings === 'object') {
    const s = obj.siteSettings as Record<string, unknown>;
    siteSettings = {
      brandName: String(s.brandName || 'Multimedia'),
      logoUrl: String(s.logoUrl || ''),
      heroEyebrow: String(s.heroEyebrow || ''),
      heroTitle: String(s.heroTitle || ''),
      heroDescription: String(s.heroDescription || ''),
      heroImageUrl: String(s.heroImageUrl || ''),
      footerAddress: String(s.footerAddress || ''),
      socialLinks: Array.isArray(s.socialLinks) ? (s.socialLinks as SiteBranding['socialLinks']) : [],
    };
  }

  if (members.length === 0 && !siteSettings) {
    throw new Error(
      'File JSON ini tidak berisi data anggota maupun pengaturan situs yang dapat dipulihkan.'
    );
  }

  return {
    exportedAt: String(obj.exportedAt || ''),
    appName: String(obj.app || 'NMC SMPN 2 Ciamis'),
    members,
    siteSettings,
    newsCount: Array.isArray(obj.news)
      ? obj.news.length
      : Array.isArray(obj.news_articles)
      ? obj.news_articles.length
      : 0,
    schedulesCount: Array.isArray(obj.schedules) ? obj.schedules.length : 0,
    worksCount: Array.isArray(obj.works) ? obj.works.length : 0,
    attendanceCount: Array.isArray(obj.attendance)
      ? obj.attendance.length
      : Array.isArray(obj.attendance_records)
      ? obj.attendance_records.length
      : 0,
    lmsTasksCount: Array.isArray(obj.lmsTasks)
      ? obj.lmsTasks.length
      : Array.isArray(obj.lms_tasks)
      ? obj.lms_tasks.length
      : 0,
  };
}
