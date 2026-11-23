import { useEffect, useState, type ImgHTMLAttributes, type ReactNode, type SyntheticEvent, type VideoHTMLAttributes } from 'react';
import {
  getCachedCloudFile,
  isCloudFileUrl,
  resolveCloudFile,
  downloadOrOpenMedia,
} from '../lib/cloudFiles';
import { extractGoogleDriveFileId, getGoogleDriveImageCandidates, resolveMediaUrl } from '../lib/mediaAssets';

export function useResolvedMedia(rawUrl?: string | null) {
  const [state, setState] = useState<{
    src: string;
    mimeType: string;
    fileName: string;
    loading: boolean;
  }>(() => {
    if (!rawUrl) return { src: '', mimeType: '', fileName: '', loading: false };
    if (isCloudFileUrl(rawUrl)) {
      const cached = getCachedCloudFile(rawUrl);
      if (cached) {
        return {
          src: cached.objectUrl,
          mimeType: cached.mimeType,
          fileName: cached.fileName,
          loading: false,
        };
      }
      return { src: '', mimeType: '', fileName: '', loading: true };
    }
    return {
      src: resolveMediaUrl(rawUrl),
      mimeType: '',
      fileName: rawUrl.split('/').pop() || '',
      loading: false,
    };
  });

  useEffect(() => {
    let active = true;
    if (!rawUrl) {
      setState({ src: '', mimeType: '', fileName: '', loading: false });
      return () => {
        active = false;
      };
    }

    if (!isCloudFileUrl(rawUrl)) {
      setState({
        src: resolveMediaUrl(rawUrl),
        mimeType: '',
        fileName: rawUrl.split('/').pop() || '',
        loading: false,
      });
      return () => {
        active = false;
      };
    }

    const cached = getCachedCloudFile(rawUrl);
    if (cached) {
      setState({
        src: cached.objectUrl,
        mimeType: cached.mimeType,
        fileName: cached.fileName,
        loading: false,
      });
      return () => {
        active = false;
      };
    }

    setState((prev) => ({ ...prev, loading: true }));
    resolveCloudFile(rawUrl).then((resolved) => {
      if (!active) return;
      if (resolved) {
        setState({
          src: resolved.objectUrl,
          mimeType: resolved.mimeType,
          fileName: resolved.fileName,
          loading: false,
        });
      } else {
        setState({ src: '', mimeType: '', fileName: '', loading: false });
      }
    });

    return () => {
      active = false;
    };
  }, [rawUrl]);

  return state;
}

interface CloudImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: string | null;
  fallbackSrc?: string;
  onImageLoadSuccess?: () => void;
  onImageLoadFailed?: () => void;
}

export function CloudImage({
  src,
  fallbackSrc = '',
  alt = '',
  className = '',
  referrerPolicy = 'no-referrer',
  onError,
  onLoad,
  onImageLoadSuccess,
  onImageLoadFailed,
  ...rest
}: CloudImageProps) {
  const { src: resolvedSrc, loading } = useResolvedMedia(src);
  const driveCandidates = src && !isCloudFileUrl(src) ? getGoogleDriveImageCandidates(src) : [];
  const [candidateIdx, setCandidateIdx] = useState(0);

  useEffect(() => {
    setCandidateIdx(0);
  }, [src, resolvedSrc]);

  const effectiveCandidate =
    driveCandidates.length > 0 && candidateIdx < driveCandidates.length
      ? driveCandidates[candidateIdx]
      : candidateIdx >= driveCandidates.length && driveCandidates.length > 0
      ? fallbackSrc
      : resolvedSrc || fallbackSrc;

  if (!effectiveCandidate) {
    return (
      <div
        className={`bg-slate-100 ${loading ? 'animate-pulse' : ''} ${className}`}
        aria-label={alt}
      />
    );
  }

  const handleImgError = (e: SyntheticEvent<HTMLImageElement>) => {
    if (driveCandidates.length > 0 && candidateIdx + 1 < driveCandidates.length) {
      setCandidateIdx((prev) => prev + 1);
      return;
    }
    onImageLoadFailed?.();
    onError?.(e);
  };

  const handleImgLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    onImageLoadSuccess?.();
    onLoad?.(e);
  };

  return (
    <img
      src={effectiveCandidate}
      alt={alt}
      referrerPolicy={referrerPolicy}
      onError={handleImgError}
      onLoad={handleImgLoad}
      className={className}
      {...rest}
    />
  );
}

interface CloudVideoProps extends Omit<VideoHTMLAttributes<HTMLVideoElement>, 'src'> {
  src?: string | null;
}

export function CloudVideo({ src, className = '', ...rest }: CloudVideoProps) {
  const { src: resolvedSrc, loading } = useResolvedMedia(src);

  if (!resolvedSrc) {
    return <div className={`bg-slate-900/90 ${loading ? 'animate-pulse' : ''} ${className}`} />;
  }

  return <video src={resolvedSrc} className={className} {...rest} />;
}

interface CloudFileAttachmentProps {
  url: string;
  fileName?: string;
  fileType?: string;
  title?: string;
  showPreview?: boolean;
  linkLabel?: ReactNode;
  className?: string;
}

export function CloudFileAttachment({
  url,
  fileName,
  fileType,
  title,
  showPreview = true,
  linkLabel,
  className = 'inline-flex items-center gap-1.5 text-xs font-semibold text-[#1D4ED8] hover:underline',
}: CloudFileAttachmentProps) {
  const { src, mimeType, fileName: cloudName } = useResolvedMedia(url);
  const effectiveName = fileName || cloudName || 'lampiran';
  const effectiveMime = fileType || mimeType || '';

  const hasDriveId = Boolean(extractGoogleDriveFileId(url));
  const isLocalUploadOrCloud = isCloudFileUrl(url) || url.startsWith('/uploads/');

  const isVid =
    effectiveMime.startsWith('video/') ||
    /\.(mp4|webm|mov)$/i.test(effectiveName) ||
    /\.(mp4|webm|mov)(\?|$)/i.test(url);
  const isAud =
    effectiveMime.startsWith('audio/') ||
    /\.(mp3|wav|ogg|m4a)$/i.test(effectiveName) ||
    /\.(mp3|wav|ogg|m4a)(\?|$)/i.test(url);
  const isImg =
    !isVid &&
    !isAud &&
    (effectiveMime.startsWith('image/') ||
      /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(effectiveName) ||
      /\.(jpg|jpeg|png|webp|gif|svg)(\?|$)/i.test(url) ||
      (hasDriveId && effectiveMime !== 'application/link'));

  const handleOpen = (e: React.MouseEvent) => {
    if (isCloudFileUrl(url)) {
      e.preventDefault();
      void downloadOrOpenMedia(url, effectiveName).catch(() => {});
    }
  };

  return (
    <div className="space-y-2">
      {showPreview && isImg && (
        <CloudImage
          src={url}
          alt={title || effectiveName}
          className="max-h-64 rounded-lg object-contain border border-slate-200 bg-white"
        />
      )}
      {showPreview && isVid && (
        <CloudVideo
          src={url}
          controls
          className="w-full max-h-64 rounded-lg border border-slate-200 bg-black"
        />
      )}
      {showPreview && src && isAud && (
        <audio src={src} controls className="w-full" />
      )}
      <a
        href={src || url}
        {...(isLocalUploadOrCloud ? { download: effectiveName } : {})}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleOpen}
        className={className}
      >
        {linkLabel || effectiveName}
      </a>
    </div>
  );
}
