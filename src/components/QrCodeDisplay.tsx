import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download } from 'lucide-react';

interface QrCodeDisplayProps {
  value: string;
  label?: string;
  sublabel?: string;
  size?: number;
  downloadFileName?: string;
}

export function QrCodeDisplay({
  value,
  label,
  sublabel,
  size = 180,
  downloadFileName,
}: QrCodeDisplayProps) {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 2,
      color: {
        dark: '#0F172A',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [value, size]);

  const handleDownload = () => {
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${downloadFileName || 'qr-nmc-smpn2ciamis'}.png`;
    link.click();
  };

  return (
    <div className="inline-flex flex-col items-center">
      <div
        className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-center"
        style={{ width: size + 24, height: size + 24 }}
      >
        {dataUrl ? (
          <img
            src={dataUrl}
            alt={label ? `QR Code ${label}` : 'QR Code Profil Siswa'}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-full h-full bg-slate-100 animate-pulse rounded-lg" />
        )}
      </div>
      {label && <p className="mt-2.5 text-sm font-semibold text-slate-900 text-center">{label}</p>}
      {sublabel && <p className="text-xs font-mono text-slate-500 text-center">{sublabel}</p>}
      {downloadFileName && dataUrl && (
        <button
          type="button"
          onClick={handleDownload}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors min-h-[40px] whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5" />
          Unduh QR Code
        </button>
      )}
    </div>
  );
}
