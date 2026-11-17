import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import jsQR from 'jsqr';
import {
  Camera,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  FileSpreadsheet,
  Printer,
  QrCode,
  Radio,
  ScanLine,
  StopCircle,
  Upload,
  Usb,
  Wifi,
} from 'lucide-react';
import type { AttendanceRecord, MonthlyReportRow, StudentProfile } from '../types';
import { apiFetch } from '../lib/api';
import { formatDateID, formatLocalClock, getLocalTimeZoneLabel } from '../lib/mediaAssets';

interface AttendanceHubProps {
  members: StudentProfile[];
  attendanceRecords: AttendanceRecord[];
  currentUser: StudentProfile | null;
  wsConnected: boolean;
  onAttendanceRecorded: (record: AttendanceRecord) => void;
  onOpenMemberProfile: (username: string) => void;
  onToast: (message: string, variant?: 'success' | 'error' | 'info') => void;
}

type HubTab = 'nfc' | 'qr' | 'report';

export function AttendanceHub({
  members,
  attendanceRecords,
  currentUser,
  wsConnected,
  onAttendanceRecorded,
  onOpenMemberProfile,
  onToast,
}: AttendanceHubProps) {
  const [subTab, setSubTab] = useState<HubTab>('nfc');
  const [sessionTitle, setSessionTitle] = useState('Pertemuan Rutin Multimedia Media Center');
  const [scanStatusMode, setScanStatusMode] = useState<'Hadir' | 'Terlambat' | 'Izin'>('Hadir');

  // NFC/RFID USB Reader state
  const [nfcInput, setNfcInput] = useState('');
  const [kioskListening, setKioskListening] = useState(true);
  const [serialConnected, setSerialConnected] = useState(false);
  const [webNfcActive, setWebNfcActive] = useState(false);
  const [lastScannedBanner, setLastScannedBanner] = useState<{
    name: string;
    kelas: string;
    method: string;
    status: string;
    time: string;
  } | null>(null);
  const nfcInputRef = useRef<HTMLInputElement>(null);

  // QR Camera Scanner state
  const [qrModeAction, setQrModeAction] = useState<'attendance' | 'profile'>('attendance');
  const [cameraActive, setCameraActive] = useState(false);
  const [qrManualInput, setQrManualInput] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastQrScanTimeRef = useRef<number>(0);

  // Monthly report state
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [reportMonth, setReportMonth] = useState(defaultMonth);
  const [reportRows, setReportRows] = useState<MonthlyReportRow[]>([]);
  const [reportTotalSessions, setReportTotalSessions] = useState(0);
  const [loadingReport, setLoadingReport] = useState(false);

  // Live clock matched to computer timezone
  const [computerNow, setComputerNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setComputerNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const localTzLabel = getLocalTimeZoneLabel(computerNow);

  const submitScan = async (
    code: string,
    method: 'NFC/RFID' | 'QR Scan' | 'Manual Admin',
    statusOverride?: 'Hadir' | 'Terlambat' | 'Izin'
  ) => {
    const clean = code.trim();
    if (!clean) return;
    try {
      const res = await apiFetch<{
        record: AttendanceRecord;
        student: { username: string; full_name: string; kelas: string };
      }>('/api/attendance/scan', {
        method: 'POST',
        body: JSON.stringify({
          code: clean,
          method,
          session_title: sessionTitle,
          status: statusOverride || scanStatusMode,
        }),
      });
      onAttendanceRecorded(res.record);
      setLastScannedBanner({
        name: res.student.full_name,
        kelas: res.student.kelas,
        method,
        status: res.record.status,
        time: res.record.check_in_time,
      });
      onToast(
        `${res.student.full_name} (${res.student.kelas}) tercatat ${res.record.status} via ${method}.`,
        'success'
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Kartu / QR tidak dikenali.', 'error');
    }
  };

  // Global USB HID Keyboard Wedge capture when kioskListening is enabled on NFC tab
  useEffect(() => {
    if (subTab !== 'nfc' || !kioskListening) return;
    let buffer = '';
    let lastKeyTime = 0;

    const handleGlobalKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      const nowMs = Date.now();
      if (nowMs - lastKeyTime > 120) {
        buffer = '';
      }
      lastKeyTime = nowMs;

      if (e.key === 'Enter' && buffer.length >= 4) {
        e.preventDefault();
        const captured = buffer;
        buffer = '';
        submitScan(captured, 'NFC/RFID');
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    };

    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [subTab, kioskListening, sessionTitle, scanStatusMode]);

  // Web Serial API connection for Serial USB NFC/RFID Readers
  const handleConnectUsbSerial = async () => {
    const nav = navigator as Navigator & {
      serial?: { requestPort: () => Promise<{ open: (opts: { baudRate: number }) => Promise<void>; readable: ReadableStream<Uint8Array> | null }> };
    };
    if (!nav.serial) {
      onToast(
        'Browser ini tidak mendukung Web Serial API. Gunakan mode USB HID Keyboard Wedge (otomatis aktif di kolom input di atas).',
        'info'
      );
      return;
    }

    try {
      const port = await nav.serial.requestPort();
      await port.open({ baudRate: 9600 });
      setSerialConnected(true);
      onToast('USB Serial Reader terhubung! Silakan tempelkan kartu NFC/RFID.', 'success');

      if (port.readable) {
        const reader = port.readable.getReader();
        const decoder = new TextDecoder();
        let lineBuffer = '';
        (async () => {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            lineBuffer += decoder.decode(value, { stream: true });
            const lines = lineBuffer.split(/\r?\n/);
            lineBuffer = lines.pop() || '';
            for (const line of lines) {
              const uid = line.replace(/[^a-zA-Z0-9_-]/g, '').trim();
              if (uid.length >= 4) {
                submitScan(uid, 'NFC/RFID');
              }
            }
          }
        })().catch(() => setSerialConnected(false));
      }
    } catch {
      onToast('Koneksi USB Serial dibatalkan.', 'info');
    }
  };

  // Web NFC API for Android Chrome
  const handleStartWebNfc = async () => {
    const win = window as unknown as {
      NDEFReader?: new () => {
        scan: () => Promise<void>;
        onreading: ((ev: { serialNumber?: string }) => void) | null;
      };
    };
    if (!win.NDEFReader) {
      onToast('Web NFC hanya didukung di browser Chrome Android. Gunakan USB Reader atau QR Code pada desktop.', 'info');
      return;
    }
    try {
      const ndef = new win.NDEFReader();
      await ndef.scan();
      setWebNfcActive(true);
      onToast('Sensor NFC perangkat aktif. Tempelkan kartu pelajar ke belakang ponsel.', 'success');
      ndef.onreading = (ev) => {
        if (ev.serialNumber) {
          const cleanUid = ev.serialNumber.replace(/:/g, '').toUpperCase();
          submitScan(cleanUid, 'NFC/RFID');
        }
      };
    } catch {
      onToast('Izin sensor NFC ditolak atau perangkat tidak memiliki chip NFC.', 'error');
    }
  };

  const handleNfcFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!nfcInput.trim()) return;
    submitScan(nfcInput.trim(), 'NFC/RFID');
    setNfcInput('');
    nfcInputRef.current?.focus();
  };

  // Camera QR Scanner
  const stopCamera = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const handleDecodedQr = (rawText: string) => {
    const nowMs = Date.now();
    if (nowMs - lastQrScanTimeRef.current < 2200) return;
    lastQrScanTimeRef.current = nowMs;

    if (qrModeAction === 'profile') {
      const match = rawText.match(/profil\/([a-zA-Z0-9._-]+)$/i);
      const identifier = match ? match[1] : rawText.trim();
      const found = members.find(
        (m) =>
          m.username.toLowerCase() === identifier.toLowerCase() ||
          m.qr_code_token.toUpperCase() === identifier.toUpperCase()
      );
      if (found) {
        stopCamera();
        onOpenMemberProfile(found.username);
      } else {
        onToast(`QR "${identifier}" tidak cocok dengan profil siswa.`, 'error');
      }
    } else {
      submitScan(rawText, 'QR Scan');
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          scanVideoFrame();
        }
      }, 100);
    } catch {
      onToast('Kamera tidak tersedia atau izin kamera ditolak. Gunakan unggah gambar QR atau input kode manual.', 'error');
    }
  };

  const scanVideoFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imgData.data, imgData.width, imgData.height);
        if (code?.data) {
          handleDecodedQr(code.data);
        }
      }
    }
    rafRef.current = requestAnimationFrame(scanVideoFrame);
  };

  const handleQrImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imgData.data, imgData.width, imgData.height);
        if (decoded?.data) {
          handleDecodedQr(decoded.data);
        } else {
          onToast('Tidak ditemukan QR Code yang valid pada gambar tersebut.', 'error');
        }
      }
      URL.revokeObjectURL(objectUrl);
    };
    img.src = objectUrl;
  };

  // Monthly Report Fetch
  useEffect(() => {
    if (subTab !== 'report') return;
    let active = true;
    setLoadingReport(true);
    apiFetch<{ month: string; totalSessions: number; rows: MonthlyReportRow[] }>(
      `/api/attendance/monthly-report?month=${encodeURIComponent(reportMonth)}`
    )
      .then((res) => {
        if (active) {
          setReportRows(res.rows);
          setReportTotalSessions(res.totalSessions);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingReport(false);
      });
    return () => {
      active = false;
    };
  }, [subTab, reportMonth, attendanceRecords.length]);

  const handleDownloadCsv = () => {
    const headers = ['NIS', 'Nama Lengkap', 'Kelas', 'Divisi', 'Total Sesi', 'Hadir', 'Terlambat', 'Izin', 'Alpha', 'Persentase (%)', 'Metode Terakhir'];
    const lines = [
      headers.join(','),
      ...reportRows.map((r) =>
        [
          r.nis,
          `"${r.full_name}"`,
          r.kelas,
          r.division,
          r.total_sessions,
          r.hadir_count,
          r.terlambat_count,
          r.izin_count,
          r.alpha_count,
          r.attendance_rate,
          r.last_method || '-',
        ].join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Laporan-Kehadiran-MMC-SMPN2Ciamis-${reportMonth}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    onToast('Laporan kehadiran bulanan CSV berhasil diunduh.', 'success');
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-6 no-print">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-[#C81E1E]">
            Sistem Kehadiran Otomatis
          </p>
          <h1 className="mt-1 font-serif text-3xl font-semibold text-slate-900">
            Absensi NFC/RFID, QR Scanner &amp; Rekap Pembina
          </h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Terintegrasi langsung dengan USB Reader kartu pelajar NFC/RFID dan pemindaian QR Code profil siswa secara real-time.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 font-mono tabular-nums">
            <Clock className="w-4 h-4 text-[#1D4ED8]" />
            <span>
              {formatLocalClock(computerNow)} {localTzLabel}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5">
            <Wifi className={`w-4 h-4 ${wsConnected ? 'text-emerald-600' : 'text-amber-600'}`} />
            <span>{wsConnected ? 'Sinkronisasi Real-Time Aktif' : 'Menghubungkan Server...'}</span>
          </div>
        </div>
      </div>

      {/* Sub-Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl overflow-x-auto max-w-full w-fit no-print">
        <button
          type="button"
          onClick={() => {
            stopCamera();
            setSubTab('nfc');
          }}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[42px] ${
            subTab === 'nfc' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          USB Reader NFC / RFID
        </button>
        <button
          type="button"
          onClick={() => setSubTab('qr')}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[42px] ${
            subTab === 'qr' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <QrCode className="w-4 h-4" />
          Scan QR Profil (Admin)
        </button>
        <button
          type="button"
          onClick={() => {
            stopCamera();
            setSubTab('report');
          }}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[42px] ${
            subTab === 'report' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          Laporan Bulanan Pembina
        </button>
      </div>

      {/* Active Session Config Bar (for NFC & QR tabs) */}
      {subTab !== 'report' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-8">
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Nama Sesi Kegiatan Aktif</label>
            <input
              type="text"
              value={sessionTitle}
              onChange={(e) => setSessionTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#1D4ED8]"
            />
          </div>
          <div className="md:col-span-4">
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Status Pencatatan</label>
            <select
              value={scanStatusMode}
              onChange={(e) => setScanStatusMode(e.target.value as 'Hadir' | 'Terlambat' | 'Izin')}
              className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#1D4ED8]"
            >
              <option value="Hadir">Hadir (Tepat Waktu)</option>
              <option value="Terlambat">Terlambat</option>
              <option value="Izin">Izin</option>
            </select>
          </div>
        </div>
      )}

      {/* TAB 1: USB NFC/RFID READER */}
      {subTab === 'nfc' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Terminal Pembaca Kartu NFC / RFID</h2>
                  <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                    Colokkan USB Reader (mode Keyboard HID atau Serial), lalu tempelkan kartu pelajar.
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={kioskListening}
                    onChange={(e) => setKioskListening(e.target.checked)}
                    className="rounded border-slate-300 text-[#1D4ED8]"
                  />
                  Tangkapan HID Otomatis
                </label>
              </div>

              {/* Focused USB Reader Input */}
              <form onSubmit={handleNfcFormSubmit} className="space-y-3">
                <label className="block text-xs font-medium text-slate-700">
                  Input UID Kartu NFC / RFID (Otomatis terisi oleh USB Reader + Enter)
                </label>
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    ref={nfcInputRef}
                    type="text"
                    value={nfcInput}
                    onChange={(e) => setNfcInput(e.target.value)}
                    placeholder="Tempelkan kartu pada USB reader atau ketik UID (mis. 04E2A10001)"
                    className="flex-1 px-4 py-3 text-sm font-mono bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#1D4ED8]/20 focus:border-[#1D4ED8]"
                  />
                  <button
                    type="submit"
                    className="px-5 py-3 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-xl min-h-[46px] whitespace-nowrap shrink-0"
                  >
                    Catat Kehadiran
                  </button>
                </div>
              </form>

              {/* Hardware API Buttons */}
              <div className="pt-2 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleConnectUsbSerial}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-medium rounded-xl border transition-colors min-h-[44px] ${
                    serialConnected
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Usb className="w-4 h-4" />
                  {serialConnected ? 'USB Serial Terhubung' : 'Hubungkan USB Serial Reader'}
                </button>

                <button
                  type="button"
                  onClick={handleStartWebNfc}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-medium rounded-xl border transition-colors min-h-[44px] ${
                    webNfcActive
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Radio className="w-4 h-4" />
                  {webNfcActive ? 'Sensor NFC HP Aktif' : 'Pindai via NFC Ponsel'}
                </button>
              </div>

              {lastScannedBanner && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-emerald-950">
                        {lastScannedBanner.name} ({lastScannedBanner.kelas})
                      </p>
                      <p className="text-xs text-emerald-800 font-mono tabular-nums">
                        {lastScannedBanner.status} · {lastScannedBanner.method} · {lastScannedBanner.time} {localTzLabel}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Tap Panel for Testing 20 Student Cards */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Daftar UID Kartu Pelajar Terdaftar ({members.length} Siswa)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Klik kartu siswa di bawah ini untuk uji tap kehadiran secara cepat bila USB reader fisik belum tersambung.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto pr-1">
                {members.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => submitScan(m.nfc_uid, 'NFC/RFID')}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-left bg-slate-50 hover:bg-amber-50 border border-slate-200 hover:border-amber-300 rounded-xl transition-colors min-h-[44px]"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">{m.full_name}</p>
                      <p className="text-[11px] text-slate-500">
                        Kelas {m.kelas} · {m.division}
                      </p>
                    </div>
                    <span className="text-[11px] font-mono text-[#1D4ED8] shrink-0">{m.nfc_uid}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Live Attendance Feed */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Log Kehadiran Real-Time</h2>
                <p className="text-xs text-slate-500">Otomatis tampil di profil masing-masing siswa</p>
              </div>
              <span className="text-xs font-mono text-slate-500 tabular-nums">
                {attendanceRecords.length} catatan
              </span>
            </div>

            <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
              {attendanceRecords.slice(0, 25).map((rec) => (
                <button
                  key={`${rec.id}-${rec.attendance_date}`}
                  type="button"
                  onClick={() => onOpenMemberProfile(rec.username)}
                  className="w-full py-3.5 text-left flex items-center justify-between gap-3 hover:bg-slate-50 rounded-lg px-2 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{rec.full_name}</p>
                    <p className="text-xs text-slate-500 truncate">
                      Kelas {rec.kelas} · {rec.method} · {formatDateID(rec.attendance_date)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={`text-xs font-semibold ${
                        rec.status === 'Hadir'
                          ? 'text-emerald-700'
                          : rec.status === 'Terlambat'
                          ? 'text-amber-700'
                          : 'text-sky-700'
                      }`}
                    >
                      {rec.status}
                    </p>
                    <p className="text-[11px] font-mono text-slate-400 tabular-nums">
                      {rec.check_in_time} {localTzLabel}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ADMIN QR CODE SCANNER */}
      {subTab === 'qr' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Pemindai QR Code Profil Siswa</h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                  Arahkan kamera ke QR Code pada akun atau kartu anggota siswa.
                </p>
              </div>
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit">
                <button
                  type="button"
                  onClick={() => setQrModeAction('attendance')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
                    qrModeAction === 'attendance' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  Catat Absensi
                </button>
                <button
                  type="button"
                  onClick={() => setQrModeAction('profile')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
                    qrModeAction === 'profile' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  Buka Profil
                </button>
              </div>
            </div>

            {currentUser?.role !== 'admin' && qrModeAction === 'attendance' && (
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                Mode Pembina/Admin disarankan untuk mencatat absensi QR secara resmi, namun pemindai tetap aktif untuk pengujian perangkat.
              </div>
            )}

            {/* Camera Viewport */}
            <div className="relative aspect-video bg-slate-950 rounded-2xl overflow-hidden flex items-center justify-center border border-slate-200">
              {cameraActive ? (
                <>
                  <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-48 h-48 border-2 border-white/80 rounded-2xl" />
                  </div>
                </>
              ) : (
                <div className="text-center p-6 space-y-3">
                  <ScanLine className="w-10 h-10 text-slate-400 mx-auto" />
                  <p className="text-sm text-slate-300">Kamera pemindai belum diaktifkan</p>
                </div>
              )}
              <canvas ref={canvasRef} className="hidden" />
            </div>

            <div className="flex flex-wrap gap-3">
              {!cameraActive ? (
                <button
                  type="button"
                  onClick={startCamera}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-xl min-h-[44px]"
                >
                  <Camera className="w-4 h-4" />
                  Aktifkan Kamera QR
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopCamera}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl min-h-[44px]"
                >
                  <StopCircle className="w-4 h-4" />
                  Matikan Kamera
                </button>
              )}

              <label className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer min-h-[44px]">
                <Upload className="w-4 h-4" />
                Pindai dari Gambar QR
                <input type="file" accept="image/*" className="hidden" onChange={handleQrImageUpload} />
              </label>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!qrManualInput.trim()) return;
                handleDecodedQr(qrManualInput.trim());
                setQrManualInput('');
              }}
              className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row gap-2.5"
            >
              <input
                type="text"
                value={qrManualInput}
                onChange={(e) => setQrManualInput(e.target.value)}
                placeholder="Atau masukkan token QR siswa (mis. MMC-CMS-001)"
                className="flex-1 px-4 py-2.5 text-sm font-mono bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:bg-white focus:border-[#1D4ED8]"
              />
              <button
                type="submit"
                className="px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl min-h-[44px] whitespace-nowrap"
              >
                Proses Kode QR
              </button>
            </form>
          </div>

          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">Token QR Siswa Terdaftar</h3>
            <p className="text-xs text-slate-500">
              Klik salah satu siswa untuk langsung memproses scan QR Code sesuai mode yang dipilih ({qrModeAction === 'attendance' ? 'Catat Absensi' : 'Buka Profil'}).
            </p>
            <div className="divide-y divide-slate-100 max-h-[460px] overflow-y-auto">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleDecodedQr(m.qr_code_token)}
                  className="w-full py-3 px-2 flex items-center justify-between gap-2 text-left hover:bg-slate-50 rounded-lg transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">{m.full_name}</p>
                    <p className="text-xs text-slate-500">Kelas {m.kelas} · {m.division}</p>
                  </div>
                  <span className="text-xs font-mono text-[#1D4ED8]">{m.qr_code_token}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: MONTHLY REPORT FOR PEMBINA */}
      {subTab === 'report' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-[#1D4ED8] print-only">
                SMP Negeri 2 Ciamis · Multimedia Media Center
              </p>
              <h2 className="text-xl font-semibold text-slate-900">
                Laporan Kehadiran Bulanan Pembina
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                Rekapitulasi kehadiran {reportRows.length} peserta didik terdaftar pada periode {reportMonth} ({reportTotalSessions} total pertemuan).
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 no-print">
              <input
                type="month"
                value={reportMonth}
                onChange={(e) => setReportMonth(e.target.value)}
                className="px-3.5 py-2 text-sm border border-slate-300 rounded-xl bg-white focus:outline-none focus:border-[#1D4ED8] min-h-[42px]"
              />
              <button
                type="button"
                onClick={handleDownloadCsv}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl min-h-[42px]"
              >
                <Download className="w-4 h-4" />
                Unduh CSV
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-xl min-h-[42px]"
              >
                <Printer className="w-4 h-4" />
                Cetak Laporan
              </button>
            </div>
          </div>

          {loadingReport ? (
            <p className="text-sm text-slate-500 py-8 text-center">Menghitung rekap bulanan...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                    <th className="py-3 pr-3">NIS</th>
                    <th className="py-3 px-3">Nama Siswa</th>
                    <th className="py-3 px-3">Kelas</th>
                    <th className="py-3 px-3">Divisi</th>
                    <th className="py-3 px-3 text-right">Hadir</th>
                    <th className="py-3 px-3 text-right">Terlambat</th>
                    <th className="py-3 px-3 text-right">Izin</th>
                    <th className="py-3 px-3 text-right">Alpha</th>
                    <th className="py-3 pl-3 text-right">Persentase</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {reportRows.map((row) => (
                    <tr key={row.user_id} className="hover:bg-slate-50">
                      <td className="py-3 pr-3 font-mono text-xs text-slate-500 tabular-nums">{row.nis}</td>
                      <td className="py-3 px-3 font-medium text-slate-900">
                        <button
                          type="button"
                          onClick={() => onOpenMemberProfile(row.username)}
                          className="hover:text-[#1D4ED8] text-left"
                        >
                          {row.full_name}
                        </button>
                      </td>
                      <td className="py-3 px-3 text-slate-600">{row.kelas}</td>
                      <td className="py-3 px-3 text-slate-600">{row.division}</td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-700 font-medium">
                        {row.hadir_count}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-amber-700">
                        {row.terlambat_count}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-sky-700">
                        {row.izin_count}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-500">
                        {row.alpha_count}
                      </td>
                      <td className="py-3 pl-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {row.attendance_rate}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
