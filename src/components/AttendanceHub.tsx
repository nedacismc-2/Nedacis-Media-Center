import { useEffect, useRef, useState, type FormEvent, type ChangeEvent } from 'react';
import jsQR from 'jsqr';
import {
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Download,
  FileSpreadsheet,
  LogIn,
  LogOut,
  MessageCircle,
  Printer,
  QrCode,
  Radio,
  ScanLine,
  Send,
  StopCircle,
  Trash2,
  Upload,
  Usb,
  Volume2,
  VolumeX,
  Wifi,
} from 'lucide-react';
import type { AttendanceRecord, MonthlyReportRow, StudentProfile } from '../types';
import { apiFetch, getStoredToken } from '../lib/api';
import { auth } from '../lib/firebase';
import {
  deleteAttendanceInFirestore,
  markAttendanceWaNotifiedInFirestore,
  recordAttendanceInFirestore,
  sanitizeDocId,
  sha256Hex,
} from '../lib/firestoreSync';
import { formatDateID, formatLocalClock, getLocalTimeZoneLabel } from '../lib/mediaAssets';
import {
  announceAttendanceVoice,
  playAttendanceChime,
  warmAttendanceVoice,
} from '../lib/attendanceSound';
import {
  buildAttendanceWhatsappMessage,
  buildMonthlyReportWhatsappMessage,
  buildWhatsappUrl,
  formatWhatsappDisplay,
  normalizeWhatsappNumber,
} from '../lib/whatsappReport';

interface AttendanceHubProps {
  members: StudentProfile[];
  attendanceRecords: AttendanceRecord[];
  currentUser: StudentProfile | null;
  isFirebaseAdmin?: boolean;
  wsConnected: boolean;
  onAttendanceRecorded: (record: AttendanceRecord) => void;
  onAttendanceDeleted?: (record: AttendanceRecord) => void;
  onOpenMemberProfile: (username: string) => void;
  onToast: (message: string, variant?: 'success' | 'error' | 'info') => void;
}

type HubTab = 'nfc' | 'qr' | 'report';
type AttendanceMode = 'auto' | 'check_in' | 'check_out';

interface ScannedBannerState {
  name: string;
  kelas: string;
  division: string;
  actionType: 'check_in' | 'check_out';
  method: string;
  status: string;
  checkInTime: string;
  checkOutTime: string;
  parentWhatsapp: string;
  waMessage: string;
  waUrl: string;
  waAutoSent: boolean;
  waError?: string;
  firestoreDocId?: string;
  recordId?: number;
  recordedByUid?: string;
}

export function AttendanceHub({
  members,
  attendanceRecords,
  currentUser,
  isFirebaseAdmin = false,
  wsConnected,
  onAttendanceRecorded,
  onAttendanceDeleted,
  onOpenMemberProfile,
  onToast,
}: AttendanceHubProps) {
  const [subTab, setSubTab] = useState<HubTab>('nfc');
  const [sessionTitle, setSessionTitle] = useState('Pertemuan Rutin Nedacis Media Center');
  const [scanStatusMode, setScanStatusMode] = useState<'Hadir' | 'Terlambat' | 'Izin' | 'Tanpa Keterangan'>('Hadir');
  const [attendanceMode, setAttendanceMode] = useState<AttendanceMode>('auto');
  const [autoQueueWa, setAutoQueueWa] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(() =>
    typeof window !== 'undefined' ? window.localStorage.getItem('nmc_attendance_voice') !== 'off' : true
  );
  const voiceEnabledRef = useRef(voiceEnabled);
  voiceEnabledRef.current = voiceEnabled;
  const [gatewayConfigured, setGatewayConfigured] = useState(false);
  const [copiedWaBanner, setCopiedWaBanner] = useState(false);

  // NFC/RFID USB Reader state
  const [nfcInput, setNfcInput] = useState('');
  const [kioskListening, setKioskListening] = useState(true);
  const [serialConnected, setSerialConnected] = useState(false);
  const [webNfcActive, setWebNfcActive] = useState(false);
  const [lastScannedBanner, setLastScannedBanner] = useState<ScannedBannerState | null>(null);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const nfcInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    warmAttendanceVoice();
  }, []);

  const toggleVoiceEnabled = () => {
    setVoiceEnabled((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('nmc_attendance_voice', next ? 'on' : 'off');
      }
      if (next) {
        warmAttendanceVoice();
        announceAttendanceVoice({
          fullName: 'Notifikasi',
          customPhrase: 'Suara notifikasi absensi diaktifkan',
        });
      }
      return next;
    });
  };

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
  const [sendingBulkWa, setSendingBulkWa] = useState(false);

  // Live clock matched to computer timezone
  const [computerNow, setComputerNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setComputerNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const localTzLabel = getLocalTimeZoneLabel(computerNow);

  useEffect(() => {
    if (!getStoredToken()) return;
    apiFetch<{ gatewayConfigured: boolean }>('/api/whatsapp/status')
      .then((res) => setGatewayConfigured(Boolean(res.gatewayConfigured)))
      .catch(() => {});
  }, []);

  const pad = (n: number) => String(n).padStart(2, '0');
  const todayDateStr = `${computerNow.getFullYear()}-${pad(computerNow.getMonth() + 1)}-${pad(computerNow.getDate())}`;

  const handleMarkWaSent = async (params: {
    firestoreDocId?: string;
    recordId?: number;
    actionType: 'check_in' | 'check_out';
    recordedByUid?: string;
    matchedRecord?: AttendanceRecord;
  }) => {
    if (params.firestoreDocId) {
      await markAttendanceWaNotifiedInFirestore(
        params.firestoreDocId,
        params.actionType,
        params.recordedByUid
      );
    }
    if (getStoredToken() && params.recordId) {
      apiFetch('/api/attendance/send-wa', {
        method: 'POST',
        body: JSON.stringify({
          mark_only: true,
          record_id: params.recordId,
          action_type: params.actionType,
        }),
      }).catch(() => {});
    }
    if (params.matchedRecord) {
      onAttendanceRecorded({
        ...params.matchedRecord,
        ...(params.actionType === 'check_out' ? { wa_notified_out: true } : { wa_notified_in: true }),
      });
    }
  };

  const submitScan = async (
    code: string,
    method: 'NFC/RFID' | 'QR Scan' | 'Manual Admin',
    statusOverride?: 'Hadir' | 'Terlambat' | 'Izin' | 'Tanpa Keterangan'
  ) => {
    const clean = code.trim();
    if (!clean) return;
    const finalStatus = statusOverride || scanStatusMode;
    try {
      const normalizedUpper = clean.toUpperCase();
      const normalizedLower = clean.toLowerCase();
      const swappedUpper = normalizedUpper.startsWith('MMC-')
        ? `NMC-${normalizedUpper.slice(4)}`
        : normalizedUpper.startsWith('NMC-')
        ? `MMC-${normalizedUpper.slice(4)}`
        : normalizedUpper;

      let matched = members.find(
        (m) =>
          (m.nfc_uid && m.nfc_uid.toUpperCase() === normalizedUpper) ||
          (m.qr_code_token &&
            (m.qr_code_token.toUpperCase() === normalizedUpper ||
              m.qr_code_token.toUpperCase() === swappedUpper)) ||
          m.username.toLowerCase() === normalizedLower ||
          clean.includes(`profil/${m.username}`)
      );

      if (!matched) {
        const [upperHash, lowerHash, swappedLowerHash] = await Promise.all([
          sha256Hex(normalizedUpper),
          sha256Hex(normalizedLower),
          sha256Hex(swappedUpper.toLowerCase()),
        ]);
        matched = members.find(
          (m) =>
            (m.nfc_hash && (m.nfc_hash === upperHash || m.nfc_hash === lowerHash)) ||
            Boolean(
              m.auth_hashes &&
                (m.auth_hashes.includes(upperHash) ||
                  m.auth_hashes.includes(lowerHash) ||
                  m.auth_hashes.includes(swappedLowerHash))
            )
        );
      }

      let recordedRecord: AttendanceRecord | null = null;
      let studentName = matched?.full_name || '';
      let studentKelas = matched?.kelas || '';
      let studentDivision = matched?.division || 'Fotografi';
      let studentParentWa = matched?.parent_whatsapp || '';
      let resolvedActionType: 'check_in' | 'check_out' =
        attendanceMode === 'check_out' ? 'check_out' : 'check_in';
      let effectiveRecorderUid: string | undefined;
      let cloudDocId: string | undefined;

      const nowDate = new Date();
      const attendanceDate = `${nowDate.getFullYear()}-${pad(nowDate.getMonth() + 1)}-${pad(nowDate.getDate())}`;
      const scanTime = `${pad(nowDate.getHours())}:${pad(nowDate.getMinutes())}:${pad(nowDate.getSeconds())}`;
      const recorderName = currentUser?.full_name || 'Pembina NMC';

      if (matched) {
        const memberDocId = matched.firestoreId || sanitizeDocId(`member_${matched.username}`);
        const recorderDocId = currentUser?.firestoreId?.startsWith('member_')
          ? currentUser.firestoreId
          : currentUser?.username
          ? sanitizeDocId(`member_${currentUser.username}`)
          : undefined;
        effectiveRecorderUid =
          isFirebaseAdmin && auth.currentUser?.uid
            ? auth.currentUser.uid
            : recorderDocId || auth.currentUser?.uid;

        try {
          const cloudRes = await recordAttendanceInFirestore({
            memberId: memberDocId,
            studentUid: matched.owner_uid || '',
            fullName: matched.full_name,
            username: matched.username,
            kelas: matched.kelas,
            division: matched.division,
            attendanceDate,
            checkInTime: scanTime,
            attendanceMode,
            method,
            status: finalStatus,
            sessionTitle,
            recordedBy: recorderName,
            recordedByUid: effectiveRecorderUid,
          });
          cloudDocId = cloudRes.docId;
          resolvedActionType = cloudRes.actionType;
          recordedRecord = {
            id: Date.now(),
            firestoreId: cloudRes.docId,
            user_id: matched.id,
            full_name: matched.full_name,
            username: matched.username,
            nis: matched.nis,
            kelas: matched.kelas,
            division: matched.division,
            nfc_uid: matched.nfc_uid,
            parent_whatsapp: matched.parent_whatsapp || '',
            attendance_date: attendanceDate,
            check_in_time: cloudRes.checkInTime,
            check_out_time: cloudRes.checkOutTime,
            method: cloudRes.method,
            check_out_method: cloudRes.checkOutMethod,
            status: cloudRes.status,
            session_title: cloudRes.sessionTitle,
            recorded_by: recorderName,
            wa_notified_in: cloudRes.waNotifiedIn,
            wa_notified_out: cloudRes.waNotifiedOut,
            created_at: nowDate.toISOString(),
          };
        } catch (cloudErr) {
          if (!getStoredToken()) {
            throw cloudErr;
          }
        }
      }

      let waAutoSent = false;
      let waError: string | undefined;

      if (getStoredToken()) {
        try {
          const res = await apiFetch<{
            action_type?: 'check_in' | 'check_out';
            record: AttendanceRecord;
            wa_dispatch?: {
              gatewayConfigured: boolean;
              sent: boolean;
              normalizedPhone: string;
              error?: string;
            };
            student: {
              username: string;
              full_name: string;
              kelas: string;
              division?: string;
              parent_whatsapp?: string;
            };
          }>('/api/attendance/scan', {
            method: 'POST',
            body: JSON.stringify({
              code: clean,
              method,
              session_title: sessionTitle,
              status: finalStatus,
              attendance_type: attendanceMode,
              auto_send_wa: autoQueueWa,
            }),
          });

          if (res.action_type) resolvedActionType = res.action_type;
          studentName = res.student.full_name || studentName;
          studentKelas = res.student.kelas || studentKelas;
          studentDivision = res.student.division || studentDivision;
          studentParentWa = res.student.parent_whatsapp || res.record.parent_whatsapp || studentParentWa;

          let mergedRecord: AttendanceRecord = recordedRecord
            ? {
                ...recordedRecord,
                id: res.record.id || recordedRecord.id,
                parent_whatsapp: studentParentWa || recordedRecord.parent_whatsapp,
                check_in_time: res.record.check_in_time || recordedRecord.check_in_time,
                check_out_time: res.record.check_out_time ?? recordedRecord.check_out_time,
                check_out_method: res.record.check_out_method ?? recordedRecord.check_out_method,
                wa_notified_in: res.record.wa_notified_in ?? recordedRecord.wa_notified_in,
                wa_notified_out: res.record.wa_notified_out ?? recordedRecord.wa_notified_out,
              }
            : res.record;

          if (res.wa_dispatch) {
            setGatewayConfigured(res.wa_dispatch.gatewayConfigured);
            if (res.wa_dispatch.sent) {
              waAutoSent = true;
              if (cloudDocId) {
                await markAttendanceWaNotifiedInFirestore(
                  cloudDocId,
                  resolvedActionType,
                  effectiveRecorderUid
                );
              }
              mergedRecord = {
                ...mergedRecord,
                ...(resolvedActionType === 'check_out'
                  ? { wa_notified_out: true }
                  : { wa_notified_in: true }),
              };
            } else if (res.wa_dispatch.error) {
              waError = res.wa_dispatch.error;
            }
          }
          recordedRecord = mergedRecord;
        } catch (apiErr) {
          if (!recordedRecord) throw apiErr;
        }
      }

      if (!recordedRecord) {
        throw new Error('Kartu / QR tidak dikenali dalam daftar anggota.');
      }

      const finalCheckIn = recordedRecord.check_in_time || scanTime;
      const finalCheckOut = recordedRecord.check_out_time || '';
      const activeTime = resolvedActionType === 'check_out' ? finalCheckOut || scanTime : finalCheckIn;

      const waMessage = buildAttendanceWhatsappMessage({
        studentName: studentName || recordedRecord.full_name,
        kelas: studentKelas || recordedRecord.kelas,
        division: studentDivision || recordedRecord.division,
        actionType: resolvedActionType,
        status: recordedRecord.status,
        attendanceDate: recordedRecord.attendance_date || attendanceDate,
        timeStr: activeTime,
        tzLabel: localTzLabel,
        checkInTime: finalCheckIn,
        checkOutTime: finalCheckOut,
        method,
        sessionTitle: recordedRecord.session_title || sessionTitle,
        recordedBy: recordedRecord.recorded_by || recorderName,
      });

      const waUrl = buildWhatsappUrl(studentParentWa, waMessage);

      onAttendanceRecorded(recordedRecord);
      setCopiedWaBanner(false);
      setLastScannedBanner({
        name: studentName || recordedRecord.full_name,
        kelas: studentKelas || recordedRecord.kelas,
        division: studentDivision || recordedRecord.division,
        actionType: resolvedActionType,
        method,
        status: recordedRecord.status,
        checkInTime: finalCheckIn,
        checkOutTime: finalCheckOut,
        parentWhatsapp: studentParentWa,
        waMessage,
        waUrl,
        waAutoSent,
        waError,
        firestoreDocId: recordedRecord.firestoreId,
        recordId: recordedRecord.id,
        recordedByUid: effectiveRecorderUid,
      });

      const actionLabel = resolvedActionType === 'check_out' ? 'Absen Pulang' : 'Absen Masuk';
      const waSuffix = waAutoSent
        ? ' Laporan WA otomatis terkirim ke orang tua.'
        : waUrl && autoQueueWa
        ? ' Siap kirim laporan WA orang tua.'
        : '';

      onToast(
        `${recordedRecord.full_name} (${recordedRecord.kelas}) tercatat ${actionLabel} (${recordedRecord.status}) via ${method}.${waSuffix}`,
        'success'
      );
      if (voiceEnabledRef.current) {
        announceAttendanceVoice({
          fullName: studentName || recordedRecord.full_name,
          actionType: resolvedActionType,
          status: recordedRecord.status,
        });
      }
    } catch (err) {
      if (voiceEnabledRef.current) {
        playAttendanceChime('error');
      }
      onToast(err instanceof Error ? err.message : 'Kartu / QR tidak dikenali.', 'error');
    }
  };

  const submitScanRef = useRef(submitScan);
  submitScanRef.current = submitScan;

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
        submitScanRef.current(captured, 'NFC/RFID');
      } else if (e.key.length === 1) {
        buffer += e.key;
      }
    };

    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [subTab, kioskListening]);

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

  // Monthly Report Fetch / Cloud Calculation
  useEffect(() => {
    if (subTab !== 'report') return;
    let active = true;

    const buildClientReport = () => {
      const monthRecs = attendanceRecords.filter((r) => r.attendance_date.startsWith(reportMonth));
      const uniqueDates = new Set(monthRecs.map((r) => r.attendance_date));
      const totalSessions = Math.max(uniqueDates.size, 1);
      const studentByUsername = new Map<string, StudentProfile>();
      for (const m of members) {
        if (m.role !== 'student') continue;
        const key = m.username.trim().toLowerCase();
        if (key && !studentByUsername.has(key)) {
          studentByUsername.set(key, m);
        }
      }
      const students = Array.from(studentByUsername.values());
      const rows: MonthlyReportRow[] = students.map((st) => {
        const recs = monthRecs.filter(
          (r) =>
            r.username.toLowerCase() === st.username.toLowerCase() ||
            (st.id > 0 && r.user_id === st.id)
        );
        const hadir = recs.filter((r) => r.status === 'Hadir').length;
        const terlambat = recs.filter((r) => r.status === 'Terlambat').length;
        const izin = recs.filter((r) => r.status === 'Izin').length;
        const tanpaKeterangan = recs.filter((r) => r.status === 'Tanpa Keterangan').length;
        const pulangCount = recs.filter((r) => Boolean(r.check_out_time && r.check_out_time.trim())).length;
        const attended = hadir + terlambat;
        const alpha = Math.max(tanpaKeterangan, uniqueDates.size - (attended + izin));
        const rate = uniqueDates.size === 0 ? 0 : Math.min(100, Math.round((attended / totalSessions) * 100));
        return {
          user_id: st.id,
          full_name: st.full_name,
          username: st.username,
          nis: st.nis,
          kelas: st.kelas,
          division: st.division,
          parent_whatsapp: st.parent_whatsapp || '',
          total_sessions: uniqueDates.size,
          hadir_count: hadir,
          terlambat_count: terlambat,
          izin_count: izin,
          alpha_count: alpha,
          pulang_count: pulangCount,
          attendance_rate: rate,
          last_method: recs[0]?.method || null,
        };
      });
      if (active) {
        setReportRows(rows);
        setReportTotalSessions(uniqueDates.size);
        setLoadingReport(false);
      }
    };

    if (getStoredToken() && attendanceRecords.length === 0) {
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
        .catch(() => buildClientReport())
        .finally(() => {
          if (active) setLoadingReport(false);
        });
    } else {
      buildClientReport();
    }
    return () => {
      active = false;
    };
  }, [subTab, reportMonth, attendanceRecords, members]);

  const handleDeleteAttendance = async (rec: AttendanceRecord, rowKey: string) => {
    if (deletingKey) return;
    setDeletingKey(rowKey);
    try {
      let deletedCloud = false;
      const actorPembinaId =
        currentUser?.role === 'admin'
          ? currentUser.firestoreId?.startsWith('member_')
            ? currentUser.firestoreId
            : currentUser.username
            ? sanitizeDocId(`member_${currentUser.username}`)
            : undefined
          : undefined;
      if (rec.firestoreId) {
        try {
          await deleteAttendanceInFirestore(rec.firestoreId, actorPembinaId);
          deletedCloud = true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : '';
          const isPerm =
            msg.includes('Missing or insufficient permissions') || msg.includes('PERMISSION_DENIED');
          if (isPerm && !getStoredToken()) {
            throw new Error(
              'Tidak memiliki izin menghapus log ini di Firebase. Login dengan Google Admin untuk menghapus log buatan Admin.'
            );
          }
          if (!isPerm) throw err;
        }
      }

      if (getStoredToken()) {
        const deleteParams = new URLSearchParams({
          username: rec.username || '',
          date: rec.attendance_date || '',
        });
        try {
          await apiFetch(`/api/attendance/${rec.id || 0}?${deleteParams.toString()}`, {
            method: 'DELETE',
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message.toLowerCase() : '';
          const notFoundInLocal = msg.includes('tidak ditemukan') || msg.includes('404');
          if (!deletedCloud || !notFoundInLocal) {
            throw err;
          }
        }
      }

      setLastScannedBanner((prev) => {
        if (!prev) return prev;
        const matchesBanner =
          (Boolean(rec.firestoreId) && prev.firestoreDocId === rec.firestoreId) ||
          (rec.id > 0 && prev.recordId === rec.id);
        return matchesBanner ? null : prev;
      });
      onAttendanceDeleted?.(rec);
      onToast(`Log kehadiran ${rec.full_name} berhasil dihapus.`, 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menghapus log kehadiran.', 'error');
    } finally {
      setDeletingKey(null);
      setConfirmDeleteKey((prev) => (prev === rowKey ? null : prev));
    }
  };

  const handleDownloadCsv = () => {
    const headers = [
      'NIS',
      'Nama Lengkap',
      'Kelas',
      'Divisi',
      'No. WA Orang Tua',
      'Total Sesi',
      'Hadir',
      'Terlambat',
      'Izin',
      'Alpha',
      'Pulang',
      'Persentase (%)',
      'Metode Terakhir',
    ];
    const lines = [
      headers.join(','),
      ...reportRows.map((r) =>
        [
          r.nis,
          `"${r.full_name}"`,
          r.kelas,
          r.division,
          r.parent_whatsapp || '',
          r.total_sessions,
          r.hadir_count,
          r.terlambat_count,
          r.izin_count,
          r.alpha_count,
          r.pulang_count ?? 0,
          r.attendance_rate,
          r.last_method || '-',
        ].join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Laporan-Kehadiran-NMC-SMPN2Ciamis-${reportMonth}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    onToast('Laporan kehadiran bulanan CSV berhasil diunduh.', 'success');
  };

  const handleBulkSendMonthlyWa = async () => {
    const validItems = reportRows
      .filter((r) => Boolean(normalizeWhatsappNumber(r.parent_whatsapp)))
      .map((r) => ({
        phone: r.parent_whatsapp || '',
        student_name: r.full_name,
        message: buildMonthlyReportWhatsappMessage({
          studentName: r.full_name,
          nis: r.nis,
          kelas: r.kelas,
          division: r.division,
          month: reportMonth,
          totalSessions: r.total_sessions,
          hadirCount: r.hadir_count,
          terlambatCount: r.terlambat_count,
          izinCount: r.izin_count,
          alphaCount: r.alpha_count,
          pulangCount: r.pulang_count,
          attendanceRate: r.attendance_rate,
        }),
      }));

    if (validItems.length === 0) {
      onToast('Belum ada siswa dengan No. WA Orang Tua yang valid untuk dikirimi rekap.', 'info');
      return;
    }

    setSendingBulkWa(true);
    try {
      const res = await apiFetch<{
        sentCount: number;
        failedCount: number;
        errors?: string[];
      }>('/api/attendance/send-wa', {
        method: 'POST',
        body: JSON.stringify({ items: validItems }),
      });
      onToast(
        `Rekap bulanan dikirim via Gateway WA: ${res.sentCount} berhasil${res.failedCount > 0 ? `, ${res.failedCount} gagal` : ''}.`,
        res.failedCount > 0 ? 'info' : 'success'
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal mengirim rekap WA massal.', 'error');
    } finally {
      setSendingBulkWa(false);
    }
  };

  const handleCopyWaBanner = () => {
    if (!lastScannedBanner) return;
    navigator.clipboard?.writeText(lastScannedBanner.waMessage).then(() => {
      setCopiedWaBanner(true);
      onToast('Teks laporan WhatsApp berhasil disalin.', 'success');
    });
  };

  const renderScannedBanner = () => {
    if (!lastScannedBanner) return null;
    const isCheckOut = lastScannedBanner.actionType === 'check_out';
    const isTanpaKeterangan = !isCheckOut && lastScannedBanner.status === 'Tanpa Keterangan';
    const wrapperClasses = isCheckOut
      ? 'p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-3'
      : isTanpaKeterangan
      ? 'p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-3'
      : 'p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-3';

    return (
      <div className={wrapperClasses}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {isCheckOut ? (
              <LogOut className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
            ) : (
              <LogIn className={`w-5 h-5 shrink-0 mt-0.5 ${isTanpaKeterangan ? 'text-rose-600' : 'text-emerald-600'}`} />
            )}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p
                  className={`text-sm font-semibold ${
                    isCheckOut ? 'text-indigo-950' : isTanpaKeterangan ? 'text-rose-950' : 'text-emerald-950'
                  }`}
                >
                  {lastScannedBanner.name} ({lastScannedBanner.kelas})
                </p>
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${
                    isCheckOut
                      ? 'bg-indigo-100 text-indigo-800'
                      : isTanpaKeterangan
                      ? 'bg-rose-100 text-rose-800'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {isCheckOut ? 'ABSEN PULANG' : isTanpaKeterangan ? 'TANPA KETERANGAN' : 'ABSEN MASUK'}
                </span>
              </div>
              <p
                className={`text-xs font-mono tabular-nums mt-0.5 ${
                  isCheckOut ? 'text-indigo-800' : isTanpaKeterangan ? 'text-rose-800' : 'text-emerald-800'
                }`}
              >
                {lastScannedBanner.status} · {lastScannedBanner.method} · Masuk {lastScannedBanner.checkInTime}
                {lastScannedBanner.checkOutTime ? ` · Pulang ${lastScannedBanner.checkOutTime}` : ''} {localTzLabel}
              </p>
            </div>
          </div>

          {lastScannedBanner.waAutoSent && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 bg-white border border-emerald-200 px-2.5 py-1 rounded-lg">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              WA Otomatis Terkirim ({formatWhatsappDisplay(lastScannedBanner.parentWhatsapp)})
            </span>
          )}
        </div>

        <div className="pt-2 border-t border-black/10 flex flex-wrap items-center justify-between gap-2">
          {lastScannedBanner.waUrl ? (
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={lastScannedBanner.waUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  const matchedRec = attendanceRecords.find(
                    (r) =>
                      (lastScannedBanner.firestoreDocId && r.firestoreId === lastScannedBanner.firestoreDocId) ||
                      (lastScannedBanner.recordId && r.id === lastScannedBanner.recordId)
                  );
                  handleMarkWaSent({
                    firestoreDocId: lastScannedBanner.firestoreDocId,
                    recordId: lastScannedBanner.recordId,
                    actionType: lastScannedBanner.actionType,
                    recordedByUid: lastScannedBanner.recordedByUid,
                    matchedRecord: matchedRec,
                  });
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors min-h-[36px]"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                {lastScannedBanner.waAutoSent
                  ? 'Kirim Ulang via WhatsApp'
                  : `Kirim Laporan WA ke Ortu (${formatWhatsappDisplay(lastScannedBanner.parentWhatsapp)})`}
              </a>
              <button
                type="button"
                onClick={handleCopyWaBanner}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg min-h-[36px]"
              >
                {copiedWaBanner ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedWaBanner ? 'Teks Disalin' : 'Salin Pesan WA'}
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-600">
              No. WA Orang Tua belum diisi. Tambahkan nomor WA pada menu Admin Panel &gt; Akun Siswa agar laporan dapat langsung dikirim.
            </p>
          )}
          {lastScannedBanner.waError && (
            <span className="text-[11px] text-amber-800">
              Gateway WA: {lastScannedBanner.waError} (gunakan tombol WA langsung).
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-6 no-print">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-[#C81E1E]">
            Sistem Kehadiran Otomatis · Masuk &amp; Pulang
          </p>
          <h1 className="mt-1 font-serif text-3xl font-semibold text-slate-900">
            Absensi NFC/RFID, QR Scanner &amp; Laporan WA Orang Tua
          </h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Catat absen masuk dan absen pulang melalui USB Reader atau QR Code dengan laporan instan ke WhatsApp orang tua/wali siswa.
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
          Laporan Bulanan &amp; WA Ortu
        </button>
      </div>

      {/* Active Session Config Bar (for NFC & QR tabs) */}
      {subTab !== 'report' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className="md:col-span-5">
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Nama Sesi Kegiatan Aktif</label>
              <input
                type="text"
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#1D4ED8]"
              />
            </div>
            <div className="md:col-span-4">
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Mode Absensi</label>
              <select
                value={attendanceMode}
                onChange={(e) => setAttendanceMode(e.target.value as AttendanceMode)}
                className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#1D4ED8]"
              >
                <option value="auto">Otomatis (Tap 1 Masuk · Tap 2 Pulang)</option>
                <option value="check_in">Absen Masuk</option>
                <option value="check_out">Absen Pulang</option>
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Status Kehadiran</label>
              <select
                value={scanStatusMode}
                onChange={(e) =>
                  setScanStatusMode(
                    e.target.value as 'Hadir' | 'Terlambat' | 'Izin' | 'Tanpa Keterangan'
                  )
                }
                className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#1D4ED8]"
              >
                <option value="Hadir">Hadir (Tepat Waktu)</option>
                <option value="Terlambat">Terlambat</option>
                <option value="Izin">Izin</option>
                <option value="Tanpa Keterangan">Tanpa Keterangan</option>
              </select>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={autoQueueWa}
                onChange={(e) => setAutoQueueWa(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600"
              />
              Siapkan &amp; kirim laporan WhatsApp ke orang tua otomatis saat scan
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={toggleVoiceEnabled}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors min-h-[34px] ${
                  voiceEnabled
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
                title="Aktifkan/nonaktifkan suara notifikasi saat tap kartu atau scan QR"
              >
                {voiceEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                <span>{voiceEnabled ? 'Suara Notifikasi Aktif' : 'Suara Dibisukan'}</span>
              </button>
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <MessageCircle className={`w-3.5 h-3.5 ${gatewayConfigured ? 'text-emerald-600' : 'text-slate-400'}`} />
                {gatewayConfigured
                  ? 'Gateway WA Server Aktif (Auto-Kirim Tanpa Klik)'
                  : 'Mode WA Langsung (1-Klik Kirim via WhatsApp Orang Tua)'}
              </span>
            </div>
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
                    Colokkan USB Reader (mode Keyboard HID atau Serial), lalu tempelkan kartu pelajar untuk Absen Masuk / Pulang.
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
                    Catat {attendanceMode === 'check_out' ? 'Pulang' : attendanceMode === 'check_in' ? 'Masuk' : 'Kehadiran'}
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

              {renderScannedBanner()}
            </div>

            {/* Quick Tap Panel for Student Cards */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Daftar UID Kartu Pelajar Terdaftar ({members.filter((m) => m.role === 'student' || m.show_in_members === 1).length} Anggota)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Klik kartu anggota di bawah ini untuk mencatat Absen Masuk / Pulang secara cepat bila USB reader fisik belum tersambung.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto pr-1">
                {members
                  .filter((m) => m.role === 'student' || m.show_in_members === 1)
                  .map((m) => {
                    const cardCode = m.nfc_uid || m.qr_code_token || m.username;
                    const todayRec = attendanceRecords.find(
                      (r) =>
                        r.attendance_date === todayDateStr &&
                        (r.username === m.username || r.user_id === m.id)
                    );
                    const hasOut = Boolean(todayRec?.check_out_time);
                    const hasIn = Boolean(todayRec?.check_in_time);
                    return (
                      <button
                        key={m.firestoreId || `${m.id}-${m.username}`}
                        type="button"
                        onClick={() => submitScan(cardCode, 'NFC/RFID')}
                        className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-left bg-slate-50 hover:bg-amber-50 border border-slate-200 hover:border-amber-300 rounded-xl transition-colors min-h-[44px]"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900 truncate">{m.full_name}</p>
                          <p className="text-[11px] text-slate-500 truncate">
                            Kelas {m.kelas} ·{' '}
                            {hasOut ? (
                              <span className="text-indigo-700 font-medium">Pulang {todayRec?.check_out_time}</span>
                            ) : todayRec?.status === 'Tanpa Keterangan' ? (
                              <span className="text-rose-700 font-medium">Tanpa Keterangan</span>
                            ) : todayRec?.status === 'Izin' ? (
                              <span className="text-sky-700 font-medium">Izin</span>
                            ) : hasIn ? (
                              <span className="text-emerald-700 font-medium">Masuk {todayRec?.check_in_time}</span>
                            ) : (
                              <span>Belum Absen</span>
                            )}
                          </p>
                        </div>
                        <span className="text-[11px] font-mono text-[#1D4ED8] shrink-0">
                          {m.nfc_uid || m.qr_code_token}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>

          {/* Live Attendance Feed */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Log Kehadiran Real-Time</h2>
                <p className="text-xs text-slate-500">Jam Masuk, Jam Pulang &amp; Aksi Kirim WA Ortu</p>
              </div>
              <span className="text-xs font-mono text-slate-500 tabular-nums">
                {attendanceRecords.length} catatan
              </span>
            </div>

            <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
              {attendanceRecords.slice(0, 25).map((rec) => {
                const rowKey = rec.firestoreId || `${rec.id}-${rec.attendance_date}-${rec.username}`;
                const canDeleteLog = currentUser?.role === 'admin' || isFirebaseAdmin;
                const memberMatch = members.find(
                  (m) => m.username === rec.username || m.id === rec.user_id
                );
                const parentWa = rec.parent_whatsapp || memberMatch?.parent_whatsapp || '';
                const hasCheckOut = Boolean(rec.check_out_time && rec.check_out_time.trim());
                const latestAction: 'check_in' | 'check_out' = hasCheckOut ? 'check_out' : 'check_in';
                const rowWaMsg = parentWa
                  ? buildAttendanceWhatsappMessage({
                      studentName: rec.full_name,
                      kelas: rec.kelas,
                      division: rec.division,
                      actionType: latestAction,
                      status: rec.status,
                      attendanceDate: rec.attendance_date,
                      timeStr: hasCheckOut ? rec.check_out_time || rec.check_in_time : rec.check_in_time,
                      tzLabel: localTzLabel,
                      checkInTime: rec.check_in_time,
                      checkOutTime: rec.check_out_time,
                      method: hasCheckOut ? rec.check_out_method || rec.method : rec.method,
                      sessionTitle: rec.session_title,
                      recordedBy: rec.recorded_by,
                    })
                  : '';
                const rowWaUrl = parentWa ? buildWhatsappUrl(parentWa, rowWaMsg) : '';
                const isNotified = hasCheckOut
                  ? Boolean(rec.wa_notified_out)
                  : Boolean(rec.wa_notified_in);

                return (
                  <div
                    key={rowKey}
                    className="py-3 flex items-center justify-between gap-2.5 hover:bg-slate-50 rounded-lg px-2 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenMemberProfile(rec.username)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="text-sm font-semibold text-slate-900 truncate">{rec.full_name}</p>
                      <p className="text-xs text-slate-500 truncate">
                        Kelas {rec.kelas} · {formatDateID(rec.attendance_date)} ·{' '}
                        <span className="font-mono text-slate-700">Masuk {rec.check_in_time}</span>
                        {hasCheckOut && (
                          <span className="font-mono text-indigo-700"> · Pulang {rec.check_out_time}</span>
                        )}
                      </p>
                    </button>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <p
                          className={`text-xs font-semibold ${
                            rec.status === 'Hadir'
                              ? 'text-emerald-700'
                              : rec.status === 'Terlambat'
                              ? 'text-amber-700'
                              : rec.status === 'Tanpa Keterangan'
                              ? 'text-rose-700'
                              : 'text-sky-700'
                          }`}
                        >
                          {rec.status}
                        </p>
                        {isNotified && (
                          <p className="text-[10px] font-medium text-emerald-700">WA ✓</p>
                        )}
                      </div>

                      {rowWaUrl && (
                        <a
                          href={rowWaUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() =>
                            handleMarkWaSent({
                              firestoreDocId: rec.firestoreId,
                              recordId: rec.id,
                              actionType: latestAction,
                              matchedRecord: rec,
                            })
                          }
                          title={`Kirim WA ${hasCheckOut ? 'Pulang' : 'Masuk'} ke Orang Tua`}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border transition-colors min-h-[32px] ${
                            isNotified
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                              : 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                          }`}
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">WA</span>
                        </a>
                      )}

                      {canDeleteLog && (
                        confirmDeleteKey === rowKey ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={deletingKey === rowKey}
                              onClick={() => handleDeleteAttendance(rec, rowKey)}
                              className="px-2 py-1 text-[11px] font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 min-h-[32px]"
                            >
                              {deletingKey === rowKey ? '...' : 'Hapus'}
                            </button>
                            <button
                              type="button"
                              disabled={deletingKey === rowKey}
                              onClick={() => setConfirmDeleteKey(null)}
                              className="px-2 py-1 text-[11px] font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-50 min-h-[32px]"
                            >
                              Batal
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteKey(rowKey)}
                            title={`Hapus log kehadiran ${rec.full_name}`}
                            aria-label={`Hapus log kehadiran ${rec.full_name}`}
                            className="inline-flex items-center justify-center p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg border border-transparent hover:border-rose-200 transition-colors min-h-[32px] min-w-[32px]"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
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
                  Arahkan kamera ke QR Code pada akun atau kartu anggota siswa untuk Absen Masuk / Pulang.
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
                placeholder="Atau masukkan token QR siswa (mis. NMC-CMS-001)"
                className="flex-1 px-4 py-2.5 text-sm font-mono bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:bg-white focus:border-[#1D4ED8]"
              />
              <button
                type="submit"
                className="px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl min-h-[44px] whitespace-nowrap"
              >
                Proses Kode QR
              </button>
            </form>

            {renderScannedBanner()}
          </div>

          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">Token QR Siswa Terdaftar</h3>
            <p className="text-xs text-slate-500">
              Klik salah satu siswa untuk langsung memproses scan QR Code sesuai mode yang dipilih ({qrModeAction === 'attendance' ? 'Catat Absensi' : 'Buka Profil'}).
            </p>
            <div className="divide-y divide-slate-100 max-h-[460px] overflow-y-auto">
              {members.map((m) => (
                <button
                  key={m.firestoreId || `${m.id}-${m.username}`}
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

      {/* TAB 3: MONTHLY REPORT FOR PEMBINA + WA ORANG TUA */}
      {subTab === 'report' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 pb-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-[#1D4ED8] print-only">
                SMP Negeri 2 Ciamis · Nedacis Media Center
              </p>
              <h2 className="text-xl font-semibold text-slate-900">
                Laporan Kehadiran Bulanan Pembina
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                Rekapitulasi kehadiran {reportRows.length} peserta didik periode {reportMonth} ({reportTotalSessions} total pertemuan) &amp; kirim rekap WA ke orang tua.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 no-print">
              <input
                type="month"
                value={reportMonth}
                onChange={(e) => setReportMonth(e.target.value)}
                className="px-3.5 py-2 text-sm border border-slate-300 rounded-xl bg-white focus:outline-none focus:border-[#1D4ED8] min-h-[42px]"
              />
              {gatewayConfigured && (
                <button
                  type="button"
                  disabled={sendingBulkWa}
                  onClick={handleBulkSendMonthlyWa}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl min-h-[42px]"
                >
                  <Send className="w-4 h-4" />
                  {sendingBulkWa ? 'Mengirim WA...' : 'Kirim WA Rekap Massal'}
                </button>
              )}
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
                    <th className="py-3 px-3 text-right">Pulang</th>
                    <th className="py-3 px-3 text-right">Persentase</th>
                    <th className="py-3 pl-3 text-right no-print">WA Orang Tua</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {reportRows.map((row) => {
                    const waMsg = row.parent_whatsapp
                      ? buildMonthlyReportWhatsappMessage({
                          studentName: row.full_name,
                          nis: row.nis,
                          kelas: row.kelas,
                          division: row.division,
                          month: reportMonth,
                          totalSessions: row.total_sessions,
                          hadirCount: row.hadir_count,
                          terlambatCount: row.terlambat_count,
                          izinCount: row.izin_count,
                          alphaCount: row.alpha_count,
                          pulangCount: row.pulang_count,
                          attendanceRate: row.attendance_rate,
                        })
                      : '';
                    const waHref = row.parent_whatsapp ? buildWhatsappUrl(row.parent_whatsapp, waMsg) : '';

                    return (
                      <tr key={`${row.user_id}-${row.username}`} className="hover:bg-slate-50">
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
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-indigo-700 font-medium">
                          {row.pulang_count ?? 0}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                          {row.attendance_rate}%
                        </td>
                        <td className="py-3 pl-3 text-right no-print">
                          {waHref ? (
                            <a
                              href={waHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Kirim rekap ke ${formatWhatsappDisplay(row.parent_whatsapp)}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              Kirim WA
                            </a>
                          ) : (
                            <span className="text-xs text-slate-400">Belum ada no.</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

