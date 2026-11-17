import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.activity',
  'https://www.googleapis.com/auth/drive.activity.readonly',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.apps.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.install',
  'https://www.googleapis.com/auth/drive.meet.readonly',
  'https://www.googleapis.com/auth/drive.metadata',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.photos.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.scripts',
];

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}

// In-memory cache only (never stored in localStorage/sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;

export function initGoogleAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.();
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure?.();
    }
  });
}

export async function googleSignIn(): Promise<{ user: User; accessToken: string }> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Gagal memperoleh access token Google Drive.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getGoogleAccessToken(): string | null {
  return cachedAccessToken;
}

export function clearGoogleAccessToken() {
  cachedAccessToken = null;
}

export async function googleSignOut(): Promise<void> {
  await auth.signOut();
  cachedAccessToken = null;
}

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  thumbnailLink?: string;
  iconLink?: string;
  parents?: string[];
}

export class DriveAuthExpiredError extends Error {
  constructor(message = 'Sesi Google Drive berakhir. Silakan masuk ulang dengan Google.') {
    super(message);
    this.name = 'DriveAuthExpiredError';
  }
}

async function driveRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const token = getGoogleAccessToken();
  if (!token) {
    throw new DriveAuthExpiredError();
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    clearGoogleAccessToken();
    throw new DriveAuthExpiredError();
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg =
      (errBody as { error?: { message?: string } })?.error?.message ||
      `Permintaan Google Drive gagal (${res.status})`;
    throw new Error(msg);
  }
  if (res.status === 204) {
    return {} as T;
  }
  return (await res.json()) as T;
}

export async function listDriveFiles(params: {
  folderId?: string;
  query?: string;
  category?: 'all' | 'folder' | 'image' | 'video' | 'document';
  pageToken?: string;
}): Promise<{ files: DriveFileItem[]; nextPageToken?: string }> {
  const conditions: string[] = ['trashed = false'];
  if (params.folderId) {
    conditions.push(`'${params.folderId.replace(/'/g, "\\'")}' in parents`);
  }
  if (params.query?.trim()) {
    const safeQ = params.query.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    conditions.push(`name contains '${safeQ}'`);
  }
  if (params.category === 'folder') {
    conditions.push(`mimeType = 'application/vnd.google-apps.folder'`);
  } else if (params.category === 'image') {
    conditions.push(`mimeType contains 'image/'`);
  } else if (params.category === 'video') {
    conditions.push(`mimeType contains 'video/'`);
  } else if (params.category === 'document') {
    conditions.push(
      `(mimeType = 'application/pdf' or mimeType contains 'document' or mimeType contains 'spreadsheet' or mimeType contains 'presentation' or mimeType contains 'text/')`
    );
  }

  const sp = new URLSearchParams({
    q: conditions.join(' and '),
    fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, thumbnailLink, iconLink, parents)',
    orderBy: 'folder,modifiedTime desc',
    pageSize: '50',
  });
  if (params.pageToken) {
    sp.set('pageToken', params.pageToken);
  }

  return driveRequest<{ files: DriveFileItem[]; nextPageToken?: string }>(
    `https://www.googleapis.com/drive/v3/files?${sp.toString()}`
  );
}

export async function createDriveFolder(name: string, parentId?: string): Promise<DriveFileItem> {
  const metadata: Record<string, unknown> = {
    name: name.trim(),
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId && parentId !== 'root') {
    metadata.parents = [parentId];
  }
  return driveRequest<DriveFileItem>(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,modifiedTime,webViewLink',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    }
  );
}

export async function uploadFileToDrive(file: File, parentId?: string): Promise<DriveFileItem> {
  const token = getGoogleAccessToken();
  if (!token) throw new DriveAuthExpiredError();

  const metadata: Record<string, unknown> = {
    name: file.name,
  };
  if (parentId && parentId !== 'root') {
    metadata.parents = [parentId];
  }

  const boundary = `mmc_drive_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const metaPart = new Blob(
    [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`,
    ],
    { type: 'text/plain' }
  );
  const endPart = new Blob([`\r\n--${boundary}--`]);
  const body = new Blob([metaPart, file, endPart]);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime,webViewLink,thumbnailLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (res.status === 401) {
    clearGoogleAccessToken();
    throw new DriveAuthExpiredError();
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: { message?: string } })?.error?.message ||
        `Gagal mengunggah file ke Google Drive (${res.status})`
    );
  }
  return (await res.json()) as DriveFileItem;
}

export async function renameDriveFile(fileId: string, newName: string): Promise<DriveFileItem> {
  return driveRequest<DriveFileItem>(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    }
  );
}

export async function trashDriveFile(fileId: string): Promise<void> {
  await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    }
  );
}

export async function deleteDriveFilePermanent(fileId: string): Promise<void> {
  await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    {
      method: 'DELETE',
    }
  );
}

export async function downloadDriveFile(file: DriveFileItem): Promise<void> {
  const token = getGoogleAccessToken();
  if (!token) throw new DriveAuthExpiredError();

  let url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`;
  let outName = file.name;

  if (file.mimeType.startsWith('application/vnd.google-apps.')) {
    url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export?mimeType=application/pdf`;
    if (!outName.toLowerCase().endsWith('.pdf')) {
      outName = `${outName}.pdf`;
    }
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    clearGoogleAccessToken();
    throw new DriveAuthExpiredError();
  }
  if (!res.ok) {
    throw new Error(`Gagal mengunduh "${file.name}" (${res.status})`);
  }

  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = outName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
}
