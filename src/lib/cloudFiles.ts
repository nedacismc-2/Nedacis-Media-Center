import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { resolveMediaUrl } from './mediaAssets';

export const CLOUD_FILE_PREFIX = 'cloudfile://';
export const MAX_CLOUD_FILE_BYTES = 15 * 1024 * 1024; // 15 MB raw binary limit
// Safe Cloud Firestore media quota within Firebase Spark 1 GiB free database limit
export const CLOUD_STORAGE_QUOTA_BYTES = 500 * 1024 * 1024; // 500 MB
export const CLOUD_STORAGE_WARN_RATIO = 0.75; // 75% warning threshold
export const CLOUD_STORAGE_FULL_RATIO = 0.9; // 90% full/critical threshold
const CHUNK_BASE64_LENGTH = 440000; // Multiple of 4, safely below Firestore 1MB doc limit
const CHUNK_BATCH_SIZE = 8;

export interface ResolvedCloudFile {
  fileId: string;
  objectUrl: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
}

export interface CloudUploadResult {
  fileId: string;
  cloudUrl: string;
  previewUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface CloudUploadedFileRecord {
  fileId: string;
  uploaderUid: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  estimatedFirestoreBytes: number;
  chunkCount: number;
  isPublic: boolean;
  createdAt: string;
}

export interface CloudStorageSummary {
  files: CloudUploadedFileRecord[];
  totalFiles: number;
  totalRawBytes: number;
  estimatedFirestoreBytes: number;
  quotaBytes: number;
  usagePercent: number;
  status: 'ok' | 'warning' | 'full';
}

const resolvedCache = new Map<string, ResolvedCloudFile>();
const inFlightReads = new Map<string, Promise<ResolvedCloudFile | null>>();

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function estimateFirestoreFileBytes(rawBytes: number): number {
  const safeRaw = Math.max(0, Number(rawBytes) || 0);
  return Math.ceil(safeRaw * 1.35) + 1024;
}

function sanitizeUploaderId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

export function isCloudFileUrl(url?: string | null): boolean {
  return Boolean(url && url.startsWith(CLOUD_FILE_PREFIX));
}

export function extractCloudFileId(url: string): string {
  return url.slice(CLOUD_FILE_PREFIX.length).trim();
}

export function getCachedCloudFile(url?: string | null): ResolvedCloudFile | null {
  if (!url || !isCloudFileUrl(url)) return null;
  return resolvedCache.get(extractCloudFileId(url)) || null;
}

function guessMimeFromName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.ppt')) return 'application/vnd.ms-powerpoint';
  if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.zip')) return 'application/zip';
  return 'application/octet-stream';
}

function sanitizeFileName(name: string): string {
  const cleaned = (name || 'file').replace(/[\r\n\t]+/g, ' ').trim();
  return (cleaned || 'file').slice(0, 200);
}

async function compressImageIfNeeded(
  file: File,
  opts?: { maxDimension?: number; targetBytes?: number }
): Promise<{ blob: Blob; mimeType: string; fileName: string }> {
  const originalMime = (file.type || guessMimeFromName(file.name)).slice(0, 120);
  const maxDimension = opts?.maxDimension ?? 1600;
  const targetBytes = opts?.targetBytes ?? 220 * 1024;

  // Preserve vector SVG and animated GIF untouched
  if (
    !originalMime.startsWith('image/') ||
    originalMime === 'image/svg+xml' ||
    originalMime === 'image/gif'
  ) {
    return { blob: file, mimeType: originalMime, fileName: sanitizeFileName(file.name) };
  }

  // Small raster images can stay untouched if already compact
  if (file.size <= targetBytes && maxDimension >= 1200) {
    return { blob: file, mimeType: originalMime, fileName: sanitizeFileName(file.name) };
  }

  const tempUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Gagal memproses gambar.'));
      el.src = tempUrl;
    });

    const srcW = img.naturalWidth || img.width || 1;
    const srcH = img.naturalHeight || img.height || 1;
    const scale = Math.min(1, maxDimension / Math.max(srcW, srcH));
    const dstW = Math.max(1, Math.round(srcW * scale));
    const dstH = Math.max(1, Math.round(srcH * scale));

    if (scale === 1 && file.size <= targetBytes) {
      return { blob: file, mimeType: originalMime, fileName: sanitizeFileName(file.name) };
    }

    const canvas = document.createElement('canvas');
    canvas.width = dstW;
    canvas.height = dstH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { blob: file, mimeType: originalMime, fileName: sanitizeFileName(file.name) };
    }
    ctx.drawImage(img, 0, 0, dstW, dstH);

    // Keep transparency for PNG/WebP via WebP, otherwise use high-efficiency JPEG
    const keepAlpha = originalMime === 'image/png' || originalMime === 'image/webp';
    const targetMime = keepAlpha ? 'image/webp' : 'image/jpeg';

    const encoded = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), targetMime, keepAlpha ? 0.88 : 0.84);
    });

    if (encoded && encoded.size > 0 && encoded.size < file.size) {
      const ext = targetMime === 'image/webp' ? '.webp' : '.jpg';
      const base = sanitizeFileName(file.name).replace(/\.[^.]+$/, '');
      return {
        blob: encoded,
        mimeType: targetMime,
        fileName: `${base}${ext}`.slice(0, 200),
      };
    }

    return { blob: file, mimeType: originalMime, fileName: sanitizeFileName(file.name) };
  } catch {
    return { blob: file, mimeType: originalMime, fileName: sanitizeFileName(file.name) };
  } finally {
    URL.revokeObjectURL(tempUrl);
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Gagal membaca data file untuk diunggah.'));
    reader.readAsDataURL(blob);
  });
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function uploadFileToCloud(
  file: File,
  options?: { isPublic?: boolean; maxDimension?: number; targetBytes?: number; uploaderMemberId?: string }
): Promise<CloudUploadResult> {
  const uid =
    auth.currentUser?.uid ||
    (options?.uploaderMemberId ? sanitizeUploaderId(options.uploaderMemberId) : '');
  if (!uid) {
    throw new Error('Silakan masuk ke akun anggota terlebih dahulu untuk mengunggah file ke Firebase.');
  }

  const processed = await compressImageIfNeeded(file, {
    maxDimension: options?.maxDimension,
    targetBytes: options?.targetBytes,
  });

  if (processed.blob.size <= 0) {
    throw new Error('File kosong atau tidak dapat dibaca.');
  }
  if (processed.blob.size > MAX_CLOUD_FILE_BYTES) {
    throw new Error(
      `Ukuran file (${(processed.blob.size / (1024 * 1024)).toFixed(1)} MB) melebihi batas maksimal 15 MB untuk sinkronisasi Firebase lintas perangkat.`
    );
  }

  const b64 = await blobToBase64(processed.blob);
  if (!b64) {
    throw new Error('Gagal mengonversi file ke format penyimpanan Firebase.');
  }

  const chunks: string[] = [];
  for (let offset = 0; offset < b64.length; offset += CHUNK_BASE64_LENGTH) {
    chunks.push(b64.slice(offset, offset + CHUNK_BASE64_LENGTH));
  }

  if (chunks.length > 60) {
    throw new Error('Ukuran file terlalu besar untuk penyimpanan Firebase. Maksimal 15 MB per file.');
  }

  const fileId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const isPublic = options?.isPublic ?? true;

  await setDoc(doc(db, 'uploaded_files', fileId), {
    fileId,
    uploaderUid: uid,
    fileName: processed.fileName,
    mimeType: processed.mimeType,
    sizeBytes: processed.blob.size,
    chunkCount: chunks.length,
    isPublic,
    createdAt: serverTimestamp(),
  });

  for (let i = 0; i < chunks.length; i += CHUNK_BATCH_SIZE) {
    const batch = writeBatch(db);
    const slice = chunks.slice(i, i + CHUNK_BATCH_SIZE);
    slice.forEach((chunkData, offset) => {
      const idx = i + offset;
      const chunkId = `chunk_${String(idx).padStart(4, '0')}`;
      batch.set(doc(db, 'uploaded_files', fileId, 'chunks', chunkId), {
        fileId,
        uploaderUid: uid,
        chunkIndex: idx,
        data: chunkData,
      });
    });
    await batch.commit();
  }

  const objectUrl = URL.createObjectURL(processed.blob);
  resolvedCache.set(fileId, {
    fileId,
    objectUrl,
    mimeType: processed.mimeType,
    fileName: processed.fileName,
    sizeBytes: processed.blob.size,
  });

  return {
    fileId,
    cloudUrl: `${CLOUD_FILE_PREFIX}${fileId}`,
    previewUrl: objectUrl,
    fileName: processed.fileName,
    mimeType: processed.mimeType,
    sizeBytes: processed.blob.size,
  };
}

export function subscribeUploadedFilesAdmin(
  onData: (summary: CloudStorageSummary) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'uploaded_files'),
    (snap) => {
      let totalRawBytes = 0;
      let estimatedFirestoreBytes = 0;

      const files: CloudUploadedFileRecord[] = snap.docs.map((docSnap) => {
        const d = docSnap.data();
        const sizeBytes = Math.max(0, Number(d.sizeBytes || 0));
        const estBytes = estimateFirestoreFileBytes(sizeBytes);
        totalRawBytes += sizeBytes;
        estimatedFirestoreBytes += estBytes;
        const createdAt =
          d.createdAt instanceof Timestamp
            ? d.createdAt.toDate().toISOString()
            : typeof d.createdAt === 'string' && d.createdAt
            ? d.createdAt
            : new Date().toISOString();

        return {
          fileId: String(d.fileId || docSnap.id),
          uploaderUid: String(d.uploaderUid || ''),
          fileName: String(d.fileName || 'file'),
          mimeType: String(d.mimeType || 'application/octet-stream'),
          sizeBytes,
          estimatedFirestoreBytes: estBytes,
          chunkCount: Number(d.chunkCount || 1),
          isPublic: Boolean(d.isPublic),
          createdAt,
        };
      });

      files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      const ratio = estimatedFirestoreBytes / CLOUD_STORAGE_QUOTA_BYTES;
      const usagePercent = Math.min(100, Math.round(ratio * 1000) / 10);
      const status: CloudStorageSummary['status'] =
        ratio >= CLOUD_STORAGE_FULL_RATIO
          ? 'full'
          : ratio >= CLOUD_STORAGE_WARN_RATIO
          ? 'warning'
          : 'ok';

      onData({
        files,
        totalFiles: files.length,
        totalRawBytes,
        estimatedFirestoreBytes,
        quotaBytes: CLOUD_STORAGE_QUOTA_BYTES,
        usagePercent,
        status,
      });
    },
    (err) => {
      onError?.(err);
    }
  );
}

export async function deleteUploadedFileFromCloud(fileId: string): Promise<void> {
  const cleanId = sanitizeUploaderId(fileId);
  if (!cleanId) return;

  const chunksSnap = await getDocs(collection(db, 'uploaded_files', cleanId, 'chunks'));
  const chunkRefs = chunksSnap.docs.map((d) => d.ref);

  const DELETE_BATCH_LIMIT = 350;
  for (let i = 0; i < chunkRefs.length; i += DELETE_BATCH_LIMIT) {
    const batch = writeBatch(db);
    const slice = chunkRefs.slice(i, i + DELETE_BATCH_LIMIT);
    slice.forEach((ref) => batch.delete(ref));
    if (i + DELETE_BATCH_LIMIT >= chunkRefs.length) {
      batch.delete(doc(db, 'uploaded_files', cleanId));
    }
    await batch.commit();
  }

  if (chunkRefs.length === 0) {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'uploaded_files', cleanId));
    await batch.commit();
  }

  const cached = resolvedCache.get(cleanId);
  if (cached) {
    URL.revokeObjectURL(cached.objectUrl);
    resolvedCache.delete(cleanId);
  }
}

export async function deleteMultipleUploadedFilesFromCloud(
  fileIds: string[]
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (const id of fileIds) {
    try {
      await deleteUploadedFileFromCloud(id);
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { deleted, failed };
}

export async function resolveCloudFile(url: string): Promise<ResolvedCloudFile | null> {
  if (!url || !isCloudFileUrl(url)) return null;
  const fileId = extractCloudFileId(url);
  if (!fileId) return null;

  const cached = resolvedCache.get(fileId);
  if (cached) return cached;

  const pending = inFlightReads.get(fileId);
  if (pending) return pending;

  const promise = (async (): Promise<ResolvedCloudFile | null> => {
    try {
      const metaSnap = await getDoc(doc(db, 'uploaded_files', fileId));
      if (!metaSnap.exists()) return null;
      const meta = metaSnap.data();
      const mimeType = String(meta.mimeType || 'application/octet-stream');
      const fileName = String(meta.fileName || 'file');
      const sizeBytes = Number(meta.sizeBytes || 0);

      const chunksSnap = await getDocs(collection(db, 'uploaded_files', fileId, 'chunks'));
      const ordered = chunksSnap.docs
        .map((d) => ({
          index: Number(d.data().chunkIndex ?? 0),
          data: String(d.data().data || ''),
        }))
        .sort((a, b) => a.index - b.index);

      const parts: BlobPart[] = ordered.map((c) => {
        const bytes = base64ToUint8Array(c.data);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      });
      const blob = new Blob(parts, { type: mimeType });
      const objectUrl = URL.createObjectURL(blob);

      const resolved: ResolvedCloudFile = {
        fileId,
        objectUrl,
        mimeType,
        fileName,
        sizeBytes,
      };
      resolvedCache.set(fileId, resolved);
      return resolved;
    } catch {
      return null;
    } finally {
      inFlightReads.delete(fileId);
    }
  })();

  inFlightReads.set(fileId, promise);
  return promise;
}

export async function resolveAnyMediaSrc(rawUrl?: string | null): Promise<{
  src: string;
  mimeType: string;
  fileName: string;
}> {
  if (!rawUrl) return { src: '', mimeType: '', fileName: '' };
  if (isCloudFileUrl(rawUrl)) {
    const resolved = await resolveCloudFile(rawUrl);
    if (!resolved) return { src: '', mimeType: '', fileName: '' };
    return {
      src: resolved.objectUrl,
      mimeType: resolved.mimeType,
      fileName: resolved.fileName,
    };
  }
  const src = resolveMediaUrl(rawUrl);
  return {
    src,
    mimeType: guessMimeFromName(src),
    fileName: src.split('/').pop() || 'file',
  };
}

export async function downloadOrOpenMedia(rawUrl: string, fallbackName = 'lampiran-nmc'): Promise<void> {
  const { src, fileName } = await resolveAnyMediaSrc(rawUrl);
  if (!src) {
    throw new Error('File tidak tersedia atau gagal dimuat dari Cloud.');
  }
  const link = document.createElement('a');
  link.href = src;
  link.download = fileName || fallbackName;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
