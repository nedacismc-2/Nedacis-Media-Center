import { formatDateID } from './mediaAssets';

/**
 * Normalizes Indonesian WhatsApp phone numbers into international digits-only format (e.g. "6281234567890").
 * Returns empty string if input is missing or clearly invalid.
 */
export function normalizeWhatsappNumber(raw?: string | null): string {
  if (!raw) return '';
  let digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  if (digits.startsWith('0')) {
    digits = `62${digits.slice(1)}`;
  } else if (digits.startsWith('8')) {
    digits = `62${digits}`;
  }
  if (digits.length < 9 || digits.length > 15) return '';
  return digits;
}

export function formatWhatsappDisplay(raw?: string | null): string {
  const norm = normalizeWhatsappNumber(raw);
  if (!norm) return '';
  if (norm.startsWith('62')) {
    return `+62 ${norm.slice(2)}`;
  }
  return `+${norm}`;
}

export function buildAttendanceWhatsappMessage(params: {
  studentName: string;
  kelas: string;
  division: string;
  actionType: 'check_in' | 'check_out';
  status: string;
  attendanceDate: string;
  timeStr: string;
  tzLabel: string;
  checkInTime?: string;
  checkOutTime?: string;
  method: string;
  sessionTitle: string;
  recordedBy: string;
}): string {
  const dateLabel = formatDateID(params.attendanceDate);
  if (params.actionType === 'check_out') {
    const masuk = params.checkInTime || '-';
    const pulang = params.checkOutTime || params.timeStr;
    return [
      '*LAPORAN ABSENSI PULANG · NMC SMPN 2 CIAMIS*',
      '',
      `Assalamu'alaikum Wr. Wb.`,
      `Yth. Bapak/Ibu Orang Tua/Wali dari *${params.studentName}* (Kelas ${params.kelas} · Divisi ${params.division}).`,
      '',
      'Kami informasikan bahwa ananda telah selesai mengikuti kegiatan ekstrakurikuler Nedacis Media Center (NMC) dan telah melakukan *ABSEN PULANG*:',
      `- Tanggal: ${dateLabel}`,
      `- Jam Masuk: ${masuk} ${params.tzLabel}`,
      `- Jam Pulang: *${pulang} ${params.tzLabel}*`,
      `- Status Kehadiran: ${params.status}`,
      `- Kegiatan: ${params.sessionTitle}`,
      `- Metode Absen Pulang: ${params.method}`,
      `- Pencatat: ${params.recordedBy}`,
      '',
      'Mohon pendampingan kepulangan ananda menuju rumah. Terima kasih atas perhatian Bapak/Ibu.',
    ].join('\n');
  }

  const masuk = params.checkInTime || params.timeStr;
  return [
    '*LAPORAN ABSENSI MASUK · NMC SMPN 2 CIAMIS*',
    '',
    `Assalamu'alaikum Wr. Wb.`,
    `Yth. Bapak/Ibu Orang Tua/Wali dari *${params.studentName}* (Kelas ${params.kelas} · Divisi ${params.division}).`,
    '',
    'Kami informasikan bahwa ananda telah tiba dan melakukan *ABSEN MASUK* kegiatan ekstrakurikuler Nedacis Media Center (NMC):',
    `- Tanggal: ${dateLabel}`,
    `- Jam Masuk: *${masuk} ${params.tzLabel}*`,
    `- Status Kehadiran: *${params.status}*`,
    `- Kegiatan: ${params.sessionTitle}`,
    `- Metode Absen Masuk: ${params.method}`,
    `- Pencatat: ${params.recordedBy}`,
    '',
    'Terima kasih atas dukungan Bapak/Ibu terhadap kegiatan positif siswa di SMP Negeri 2 Ciamis.',
  ].join('\n');
}

export function buildMonthlyReportWhatsappMessage(params: {
  studentName: string;
  nis: string;
  kelas: string;
  division: string;
  month: string;
  totalSessions: number;
  hadirCount: number;
  terlambatCount: number;
  izinCount: number;
  alphaCount: number;
  pulangCount?: number;
  attendanceRate: number;
}): string {
  return [
    `*REKAP KEHADIRAN BULANAN (${params.month}) · NMC SMPN 2 CIAMIS*`,
    '',
    `Assalamu'alaikum Wr. Wb.`,
    `Yth. Bapak/Ibu Orang Tua/Wali dari *${params.studentName}*`,
    `NIS: ${params.nis || '-'} | Kelas: ${params.kelas} | Divisi: ${params.division}`,
    '',
    `Berikut ringkasan kehadiran kegiatan ekstrakurikuler Nedacis Media Center periode *${params.month}* (${params.totalSessions} pertemuan):`,
    `- Hadir: *${params.hadirCount}* kali`,
    `- Terlambat: ${params.terlambatCount} kali`,
    `- Izin: ${params.izinCount} kali`,
    `- Tanpa Keterangan (Alpha): ${params.alphaCount} kali`,
    ...(typeof params.pulangCount === 'number'
      ? [`- Tercatat Absen Pulang: ${params.pulangCount} kali`]
      : []),
    `- Persentase Kehadiran: *${params.attendanceRate}%*`,
    '',
    'Terima kasih atas kerja sama Bapak/Ibu dalam memantau keaktifan siswa di SMPN 2 Ciamis.',
  ].join('\n');
}

export function buildWhatsappUrl(rawPhone?: string | null, message?: string): string {
  const normalized = normalizeWhatsappNumber(rawPhone);
  if (!normalized) return '';
  if (!message) return `https://wa.me/${normalized}`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
