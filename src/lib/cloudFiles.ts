import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { auth, db } from './firebase';
import { resolveMediaUrl } from './mediaAssets';

export const CLOUD_FILE_PREFIX = 'cloudfile://';
export const MAX_CLOUD_FILE_BYTES = 15 * 1024 * 1024; // 15 MB raw binary limit
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

const resolvedCache = new Map<string, ResolvedCloudFile>();
const inFlightReads = new Map<string, Promise<ResolvedCloudFile | null>>();

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
  options?: { isPublic?: boolean; maxDimension?: number; targetBytes?: number }
): Promise<CloudUploadResult> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    throw new Error(
      'Hubungkan akun Google terlebih dahulu agar file dapat diunggah dan tersinkron di semua perangkat.'
    );
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
      `Ukuran file (${(processed.blob.size / (1024 * 1024)).toFixed(1)} MB) melebihi batas maksimal 15 MB untuk sinkronisasi Cloud lintas perangkat.`
    );
  }

  const b64 = await blobToBase64(processed.blob);
  if (!b64) {
    throw new Error('Gagal mengonversi file ke format penyimpanan Cloud.');
  }

  const chunks: string[] = [];
  for (let offset = 0; offset < b64.length; offset += CHUNK_BASE64_LENGTH) {
    chunks.push(b64.slice(offset, offset + CHUNK_BASE64_LENGTH));
  }

  if (chunks.length > 60) {
    throw new Error('Ukuran file terlalu besar untuk penyimpanan Cloud. Maksimal 15 MB per file.');
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
