import type { StudentProfile, UserRole } from '../types';

export interface MemberImportRowInput {
  rowNumber: number;
  username: string;
  full_name: string;
  role: UserRole;
  nis: string;
  kelas: string;
  division: string;
  bio: string;
  nfc_uid: string;
  qr_code_token: string;
  parent_whatsapp: string;
  avatar_color: string;
  show_in_members: boolean;
  password: string;
}

export interface ParsedMemberRow {
  rowNumber: number;
  data: MemberImportRowInput;
  action: 'create' | 'overwrite' | 'skip' | 'error';
  errors: string[];
  existingMember?: StudentProfile;
}

export interface MemberImportPreview {
  fileName: string;
  format: 'csv' | 'json';
  totalRows: number;
  createCount: number;
  overwriteCount: number;
  skipCount: number;
  errorCount: number;
  rows: ParsedMemberRow[];
}

export const MEMBER_EXPORT_COLUMNS = [
  'username',
  'full_name',
  'role',
  'nis',
  'kelas',
  'division',
  'nfc_uid',
  'qr_code_token',
  'parent_whatsapp',
  'bio',
  'avatar_color',
  'show_in_members',
  'password',
] as const;

const HEADER_ALIASES: Record<string, (typeof MEMBER_EXPORT_COLUMNS)[number]> = {
  username: 'username',
  user: 'username',
  nama_pengguna: 'username',
  id_login: 'username',
  full_name: 'full_name',
  fullname: 'full_name',
  nama: 'full_name',
  nama_lengkap: 'full_name',
  name: 'full_name',
  role: 'role',
  peran: 'role',
  status_akun: 'role',
  nis: 'nis',
  nip: 'nis',
  nis_nip: 'nis',
  kelas: 'kelas',
  class: 'kelas',
  division: 'division',
  divisi: 'division',
  nfc_uid: 'nfc_uid',
  nfc: 'nfc_uid',
  uid_nfc: 'nfc_uid',
  rfid: 'nfc_uid',
  uid_kartu: 'nfc_uid',
  qr_code_token: 'qr_code_token',
  qr_token: 'qr_code_token',
  token_qr: 'qr_code_token',
  qr: 'qr_code_token',
  parent_whatsapp: 'parent_whatsapp',
  no_wa_ortu: 'parent_whatsapp',
  no_wa_orang_tua: 'parent_whatsapp',
  wa_ortu: 'parent_whatsapp',
  wa_orang_tua: 'parent_whatsapp',
  whatsapp_ortu: 'parent_whatsapp',
  whatsapp_orang_tua: 'parent_whatsapp',
  no_hp_ortu: 'parent_whatsapp',
  hp_ortu: 'parent_whatsapp',
  bio: 'bio',
  deskripsi: 'bio',
  avatar_color: 'avatar_color',
  warna_avatar: 'avatar_color',
  show_in_members: 'show_in_members',
  tampil_di_anggota: 'show_in_members',
  tampil: 'show_in_members',
  password: 'password',
  kata_sandi: 'password',
  sandi: 'password',
};

function escapeCsvCell(value: unknown): string {
  const str = String(value ?? '');
  if (/[",\r\n;]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildMembersCsv(members: StudentProfile[]): string {
  const header = MEMBER_EXPORT_COLUMNS.join(',');
  const lines = members.map((m) =>
    [
      m.username,
      m.full_name,
      m.role || 'student',
      m.nis || '',
      m.kelas || '',
      m.division || '',
      m.nfc_uid || '',
      m.qr_code_token || '',
      m.parent_whatsapp || '',
      m.bio || '',
      m.avatar_color || '#1D4ED8',
      m.show_in_members === 0 ? '0' : '1',
      '',
    ]
      .map(escapeCsvCell)
      .join(',')
  );
  return `\uFEFF${[header, ...lines].join('\r\n')}`;
}

export function buildMembersTemplateCsv(): string {
  const header = MEMBER_EXPORT_COLUMNS.join(',');
  const examples = [
    [
      'budi.santoso',
      'Budi Santoso',
      'student',
      '242507025',
      '8A',
      'Fotografi',
      '04A1B2C3D4',
      'NMC-BUDI01',
      '6281234567890',
      'Anggota aktif Divisi Fotografi NMC SMPN 2 Ciamis.',
      '#1D4ED8',
      '1',
      'siswa123',
    ],
    [
      'pembina.media',
      'Pembina Media Baru',
      'admin',
      '198501012010011001',
      'Pembina',
      'Jurnalistik',
      '04E5F60718',
      'NMC-PEMBINA02',
      '',
      'Pembina Ekstrakurikuler Nedacis Media Center SMPN 2 Ciamis.',
      '#B91C1C',
      '1',
      'pembina123',
    ],
  ]
    .map((row) => row.map(escapeCsvCell).join(','))
    .join('\r\n');
  return `\uFEFF${header}\r\n${examples}`;
}

export function buildMembersJson(members: StudentProfile[]): string {
  const payload = {
    exportedAt: new Date().toISOString(),
    organization: 'Nedacis Media Center (NMC) SMPN 2 Ciamis',
    total: members.length,
    members: members.map((m) => ({
      username: m.username,
      full_name: m.full_name,
      role: m.role || 'student',
      nis: m.nis || '',
      kelas: m.kelas || '',
      division: m.division || '',
      nfc_uid: m.nfc_uid || '',
      qr_code_token: m.qr_code_token || '',
      parent_whatsapp: m.parent_whatsapp || '',
      bio: m.bio || '',
      avatar_color: m.avatar_color || '#1D4ED8',
      show_in_members: m.show_in_members !== 0,
      password: '',
    })),
  };
  return JSON.stringify(payload, null, 2);
}

export function triggerTextFileDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function detectCsvDelimiter(firstLine: string): ',' | ';' | '\t' {
  let commas = 0;
  let semis = 0;
  let tabs = 0;
  let inQuotes = false;
  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (ch === ',') commas++;
      else if (ch === ';') semis++;
      else if (ch === '\t') tabs++;
    }
  }
  if (tabs > commas && tabs > semis) return '\t';
  if (semis > commas) return ';';
  return ',';
}

function parseCsvMatrix(rawText: string): string[][] {
  const text = rawText.replace(/^\uFEFF/, '');
  const firstNewline = text.search(/\r?\n/);
  const firstLine = firstNewline >= 0 ? text.slice(0, firstNewline) : text;
  const delimiter = detectCsvDelimiter(firstLine);

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell.trim());
      cell = '';
      if (row.some((v) => v.length > 0)) {
        rows.push(row);
      }
      row = [];
    } else {
      cell += ch;
    }
  }

  row.push(cell.trim());
  if (row.some((v) => v.length > 0)) {
    rows.push(row);
  }
  return rows;
}

function normalizeHeaderKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s/()-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseBoolFlag(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  const str = String(raw ?? '').trim().toLowerCase();
  if (!str) return fallback;
  if (['0', 'false', 'no', 'tidak', 'n', 'off'].includes(str)) return false;
  if (['1', 'true', 'yes', 'ya', 'y', 'on'].includes(str)) return true;
  return fallback;
}

function normalizeRole(raw: unknown, fallback: UserRole): UserRole {
  const str = String(raw ?? '').trim().toLowerCase();
  if (str === 'admin' || str === 'pembina') return 'admin';
  if (str === 'student' || str === 'siswa' || str === 'anggota') return 'student';
  return fallback;
}

function normalizeColor(raw: unknown, fallback: string): string {
  const str = String(raw ?? '').trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(str)) return str.toUpperCase();
  return fallback;
}

function normalizeRawRecord(
  record: Record<string, unknown>,
  rowNumber: number,
  existingByUsername: Map<string, StudentProfile>
): MemberImportRowInput {
  const rawUsername = String(record.username ?? '').trim().toLowerCase().replace(/\s+/g, '.');
  const existing = existingByUsername.get(rawUsername);

  const role = normalizeRole(record.role, existing?.role || 'student');
  const fullName = String(record.full_name ?? '').trim() || existing?.full_name || '';
  const nis = String(record.nis ?? '').trim() || existing?.nis || '';
  const kelas = String(record.kelas ?? '').trim() || existing?.kelas || (role === 'admin' ? 'Pembina' : '8A');
  const division = String(record.division ?? '').trim() || existing?.division || 'Fotografi';
  const nfcUid = String(record.nfc_uid ?? '').trim().toUpperCase() || existing?.nfc_uid || '';
  const qrToken = String(record.qr_code_token ?? '').trim().toUpperCase() || existing?.qr_code_token || '';
  const parentWhatsapp =
    record.parent_whatsapp !== undefined && String(record.parent_whatsapp).trim() !== ''
      ? String(record.parent_whatsapp).trim().slice(0, 30)
      : existing?.parent_whatsapp || '';
  const bio =
    record.bio !== undefined && String(record.bio).trim() !== ''
      ? String(record.bio).trim().slice(0, 400)
      : existing?.bio || `Anggota aktif Divisi ${division} NMC SMPN 2 Ciamis.`;
  const avatarColor = normalizeColor(record.avatar_color, existing?.avatar_color || '#1D4ED8');
  const showInMembers = parseBoolFlag(
    record.show_in_members,
    existing ? existing.show_in_members !== 0 : true
  );
  const password = String(record.password ?? '').trim();

  return {
    rowNumber,
    username: rawUsername,
    full_name: fullName,
    role,
    nis,
    kelas,
    division,
    bio,
    nfc_uid: nfcUid,
    qr_code_token: qrToken,
    parent_whatsapp: parentWhatsapp,
    avatar_color: avatarColor,
    show_in_members: showInMembers,
    password,
  };
}

export function parseAndValidateMemberImport(
  fileName: string,
  rawText: string,
  existingMembers: StudentProfile[],
  overwrite: boolean
): MemberImportPreview {
  const existingByUsername = new Map<string, StudentProfile>();
  const existingByNfc = new Map<string, StudentProfile>();
  const existingByQr = new Map<string, StudentProfile>();

  for (const m of existingMembers) {
    existingByUsername.set(m.username.trim().toLowerCase(), m);
    if (m.nfc_uid) existingByNfc.set(m.nfc_uid.trim().toUpperCase(), m);
    if (m.qr_code_token) existingByQr.set(m.qr_code_token.trim().toUpperCase(), m);
  }

  const trimmed = rawText.trim();
  const isJson = fileName.toLowerCase().endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[');
  const rawInputs: MemberImportRowInput[] = [];

  if (isJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed.replace(/^\uFEFF/, ''));
    } catch {
      throw new Error('Format file JSON tidak valid. Pastikan file JSON dapat dibaca dengan benar.');
    }

    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { members?: unknown[] }).members)
      ? (parsed as { members: unknown[] }).members
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown[] }).data)
      ? (parsed as { data: unknown[] }).data
      : null;

    if (!list) {
      throw new Error('File JSON harus berupa array anggota atau objek dengan properti "members".');
    }

    list.forEach((item, idx) => {
      if (!item || typeof item !== 'object') return;
      const mapped: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        const canonical = HEADER_ALIASES[normalizeHeaderKey(k)];
        if (canonical) mapped[canonical] = v;
      }
      rawInputs.push(normalizeRawRecord(mapped, idx + 1, existingByUsername));
    });
  } else {
    const matrix = parseCsvMatrix(rawText);
    if (matrix.length < 2) {
      throw new Error('File CSV kosong atau tidak memiliki baris data setelah header.');
    }

    const headerRow = matrix[0];
    const columnMap = headerRow.map((h) => HEADER_ALIASES[normalizeHeaderKey(h)] || null);
    if (!columnMap.includes('username') || !columnMap.includes('full_name')) {
      throw new Error(
        'Header CSV wajib memiliki kolom "username" dan "full_name" (atau gunakan Template CSV resmi).'
      );
    }

    for (let r = 1; r < matrix.length; r++) {
      const cells = matrix[r];
      const mapped: Record<string, unknown> = {};
      columnMap.forEach((col, cIdx) => {
        if (col) mapped[col] = cells[cIdx] ?? '';
      });
      rawInputs.push(normalizeRawRecord(mapped, r + 1, existingByUsername));
    }
  }

  if (rawInputs.length === 0) {
    throw new Error('Tidak ada baris data anggota yang ditemukan di dalam file.');
  }

  const seenUsernames = new Map<string, number>();
  const seenNfc = new Map<string, number>();
  const seenQr = new Map<string, number>();

  const rows: ParsedMemberRow[] = rawInputs.map((input) => {
    const errors: string[] = [];
    const existingMember = existingByUsername.get(input.username);

    if (!input.username || input.username.length < 2 || input.username.length > 60) {
      errors.push('Username wajib 2–60 karakter.');
    } else if (!/^[a-zA-Z0-9._-]+$/.test(input.username)) {
      errors.push('Username hanya boleh huruf, angka, titik, underscore, atau tanda minus.');
    }

    if (!input.full_name || input.full_name.length > 120) {
      errors.push('Nama lengkap wajib diisi (maks 120 karakter).');
    }

    if (input.password && input.password.length < 4) {
      errors.push('Password minimal 4 karakter jika diisi.');
    }

    const prevUserRow = seenUsernames.get(input.username);
    if (input.username && prevUserRow !== undefined) {
      errors.push(`Username duplikat dengan baris ${prevUserRow}.`);
    } else if (input.username) {
      seenUsernames.set(input.username, input.rowNumber);
    }

    if (input.nfc_uid) {
      const prevNfcRow = seenNfc.get(input.nfc_uid);
      if (prevNfcRow !== undefined) {
        errors.push(`UID NFC ${input.nfc_uid} duplikat dengan baris ${prevNfcRow}.`);
      } else {
        seenNfc.set(input.nfc_uid, input.rowNumber);
      }

      const ownerNfc = existingByNfc.get(input.nfc_uid);
      if (ownerNfc && ownerNfc.username.toLowerCase() !== input.username) {
        errors.push(`UID NFC ${input.nfc_uid} sudah dipakai oleh ${ownerNfc.username}.`);
      }
    }

    if (input.qr_code_token) {
      const prevQrRow = seenQr.get(input.qr_code_token);
      if (prevQrRow !== undefined) {
        errors.push(`Token QR ${input.qr_code_token} duplikat dengan baris ${prevQrRow}.`);
      } else {
        seenQr.set(input.qr_code_token, input.rowNumber);
      }

      const ownerQr = existingByQr.get(input.qr_code_token);
      if (ownerQr && ownerQr.username.toLowerCase() !== input.username) {
        errors.push(`Token QR ${input.qr_code_token} sudah dipakai oleh ${ownerQr.username}.`);
      }
    }

    let action: ParsedMemberRow['action'];
    if (errors.length > 0) {
      action = 'error';
    } else if (existingMember) {
      action = overwrite ? 'overwrite' : 'skip';
    } else {
      action = 'create';
    }

    return {
      rowNumber: input.rowNumber,
      data: input,
      action,
      errors,
      existingMember,
    };
  });

  return {
    fileName,
    format: isJson ? 'json' : 'csv',
    totalRows: rows.length,
    createCount: rows.filter((r) => r.action === 'create').length,
    overwriteCount: rows.filter((r) => r.action === 'overwrite').length,
    skipCount: rows.filter((r) => r.action === 'skip').length,
    errorCount: rows.filter((r) => r.action === 'error').length,
    rows,
  };
}
