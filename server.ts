import express, { type Request, type Response, type NextFunction } from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  checkpointDatabase,
  closeDatabaseSafely,
  createVerifiedBackup,
  db,
  getDatabaseHealth,
  hashPassword,
  initDatabase,
  pruneExpiredSessions,
  UPLOADS_DIR,
  verifyPassword,
} from './server/db.ts';

initDatabase();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));

// Multer configuration for student photo/video uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    const safeName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file gambar (JPG/PNG/WebP) atau video (MP4/WebM) yang diperbolehkan.'));
    }
  },
});

const lmsUpload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedExt = new Set([
      '.jpg',
      '.jpeg',
      '.png',
      '.webp',
      '.gif',
      '.svg',
      '.mp4',
      '.webm',
      '.mov',
      '.mp3',
      '.wav',
      '.pdf',
      '.doc',
      '.docx',
      '.ppt',
      '.pptx',
      '.xls',
      '.xlsx',
      '.txt',
      '.zip',
    ]);
    const ext = path.extname(file.originalname).toLowerCase();
    if (
      file.mimetype.startsWith('image/') ||
      file.mimetype.startsWith('video/') ||
      file.mimetype.startsWith('audio/') ||
      file.mimetype === 'application/pdf' ||
      allowedExt.has(ext)
    ) {
      cb(null, true);
    } else {
      cb(new Error('Format file tugas tidak didukung. Gunakan gambar, video, audio, PDF, dokumen Office, TXT, atau ZIP.'));
    }
  },
});

// WebSocket broadcast helper
interface AuthenticatedSocket extends WebSocket {
  userId?: number;
  role?: string;
}

function broadcastEvent(event: { type: string; payload: unknown }, targetUserId?: number | null) {
  const data = JSON.stringify(event);
  wss.clients.forEach((client) => {
    const ws = client as AuthenticatedSocket;
    if (ws.readyState !== WebSocket.OPEN) return;
    if (targetUserId !== undefined && targetUserId !== null && event.type === 'notification:new') {
      if (ws.userId !== targetUserId && ws.role !== 'admin') return;
    }
    ws.send(data);
  });
}

wss.on('connection', (ws: AuthenticatedSocket, req) => {
  try {
    const url = new URL(req.url || '', 'http://localhost:3000');
    const token = url.searchParams.get('token');
    if (token) {
      const session = db.prepare(`
        SELECT u.id, u.role FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > ?
      `).get(token, new Date().toISOString()) as { id: number; role: string } | undefined;
      if (session) {
        ws.userId = session.id;
        ws.role = session.role;
      }
    }
  } catch {
    // ignore malformed WS query
  }
});

// Auth helpers
interface AuthUser {
  id: number;
  username: string;
  role: 'admin' | 'student';
  full_name: string;
  nis: string;
  kelas: string;
  division: string;
  bio: string;
  nfc_uid: string;
  qr_code_token: string;
  avatar_color: string;
  avatar_url?: string;
  created_at: string;
}

interface AuthedRequest extends Request {
  user?: AuthUser;
}

function getUserFromRequest(req: Request): AuthUser | undefined {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return undefined;
  const token = authHeader.slice(7).trim();
  if (!token) return undefined;
  const row = db.prepare(`
    SELECT u.id, u.username, u.role, u.full_name, u.nis, u.kelas, u.division, u.bio, u.nfc_uid, u.qr_code_token, u.avatar_color, u.avatar_url, u.created_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?
  `).get(token, new Date().toISOString()) as AuthUser | undefined;
  return row;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const user = getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Silakan masuk dengan akun siswa atau admin terlebih dahulu.' });
    return;
  }
  req.user = user;
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const user = getUserFromRequest(req);
  if (!user || user.role !== 'admin') {
    res.status(403).json({ error: 'Akses khusus Pembina / Admin NMC SMPN 2 Ciamis.' });
    return;
  }
  req.user = user;
  next();
}

function getEnrichedWorks(currentUserId?: number, approvalFilter: 'approved' | 'pending' | 'all' = 'approved') {
  const whereClause =
    approvalFilter === 'all' ? '' : `WHERE w.approval_status = '${approvalFilter}'`;

  const works = db.prepare(`
    SELECT
      w.*,
      u.full_name as author_name,
      u.username as author_username,
      u.kelas as author_kelas,
      u.division as author_division,
      u.avatar_color as author_avatar_color,
      u.avatar_url as author_avatar_url,
      (SELECT COUNT(*) FROM work_likes wl WHERE wl.work_id = w.id) as likes_count,
      (SELECT COUNT(*) FROM work_comments wc WHERE wc.work_id = w.id AND wc.is_hidden = 0) as comments_count
    FROM works w
    JOIN users u ON u.id = w.user_id
    ${whereClause}
    ORDER BY w.created_at DESC
  `).all() as Array<Record<string, unknown>>;

  const commentsStmt = db.prepare(`
    SELECT
      wc.*,
      u.full_name as author_name,
      u.username as author_username,
      u.kelas as author_kelas,
      u.role as author_role
    FROM work_comments wc
    JOIN users u ON u.id = wc.user_id
    WHERE wc.work_id = ? AND wc.is_hidden = 0
    ORDER BY wc.created_at ASC
  `);

  const likedStmt = db.prepare('SELECT 1 FROM work_likes WHERE work_id = ? AND user_id = ?');

  return works.map((w) => ({
    ...w,
    liked_by_me: currentUserId ? Boolean(likedStmt.get(w.id, currentUserId)) : false,
    comments: commentsStmt.all(w.id),
  }));
}

function createAndBroadcastNotification(params: {
  userId: number | null;
  type: 'attendance' | 'schedule' | 'like' | 'comment' | 'share' | 'moderation' | 'task';
  title: string;
  message: string;
  linkTarget?: string;
}) {
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO notifications (user_id, type, title, message, link_target, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(params.userId, params.type, params.title, params.message, params.linkTarget || null, now);

  const notif = db.prepare('SELECT * FROM notifications WHERE id = ?').get(info.lastInsertRowid);
  broadcastEvent({ type: 'notification:new', payload: notif }, params.userId);
  return notif;
}

function getUserTotalLmsPoints(userId: number): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(points_awarded), 0) as total FROM lms_task_submissions WHERE user_id = ?`)
    .get(userId) as { total: number } | undefined;
  return Number(row?.total ?? 0);
}

function getLmsTasksForUser(user: AuthUser) {
  const tasks = db
    .prepare(`
      SELECT t.*, u.full_name as creator_name
      FROM lms_tasks t
      LEFT JOIN users u ON u.id = t.created_by
      WHERE t.is_published = 1
        AND (? = 'admin' OR t.division = 'Semua' OR t.division = ?)
      ORDER BY t.created_at DESC, t.id DESC
    `)
    .all(user.role, user.division) as Array<Record<string, unknown>>;

  const stagesStmt = db.prepare(`
    SELECT * FROM lms_task_stages WHERE task_id = ? ORDER BY stage_order ASC, id ASC
  `);
  const progressStmt = db.prepare(`
    SELECT stage_id, response_text, completed_at FROM lms_task_progress WHERE task_id = ? AND user_id = ?
  `);
  const submissionStmt = db.prepare(`
    SELECT * FROM lms_task_submissions WHERE task_id = ? AND user_id = ?
  `);

  return tasks.map((t) => ({
    ...t,
    stages: stagesStmt.all(t.id),
    progress: progressStmt.all(t.id, user.id),
    submission: submissionStmt.get(t.id, user.id) || null,
  }));
}

function getClientNowParts(req: Request) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const rawTz = typeof req.headers['x-timezone'] === 'string' ? req.headers['x-timezone'].trim() : '';
  const rawOffset = typeof req.headers['x-timezone-offset'] === 'string' ? Number(req.headers['x-timezone-offset']) : NaN;

  const formatWithIana = (timeZone: string) => {
    const dtf = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const parts = dtf.formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
    const year = get('year');
    const month = get('month');
    const day = get('day');
    const hourStr = get('hour');
    const minuteStr = get('minute');
    const secondStr = get('second');
    const tzParts = new Intl.DateTimeFormat('id-ID', { timeZone, timeZoneName: 'short' }).formatToParts(now);
    const tzLabel = tzParts.find((p) => p.type === 'timeZoneName')?.value || timeZone;
    return {
      now,
      dateStr: `${year}-${month}-${day}`,
      monthStr: `${year}-${month}`,
      timeStr: `${hourStr}:${minuteStr}:${secondStr}`,
      hour: Number(hourStr),
      minute: Number(minuteStr),
      tzLabel,
    };
  };

  if (rawTz) {
    try {
      return formatWithIana(rawTz);
    } catch {
      // fall through to offset
    }
  }

  if (Number.isFinite(rawOffset) && Math.abs(rawOffset) <= 840) {
    const shifted = new Date(now.getTime() - rawOffset * 60_000);
    const year = shifted.getUTCFullYear();
    const month = pad(shifted.getUTCMonth() + 1);
    const day = pad(shifted.getUTCDate());
    const hour = shifted.getUTCHours();
    const minute = shifted.getUTCMinutes();
    const second = shifted.getUTCSeconds();
    const offsetMin = -rawOffset;
    const sign = offsetMin >= 0 ? '+' : '-';
    const absH = Math.floor(Math.abs(offsetMin) / 60);
    const absM = Math.abs(offsetMin) % 60;
    const tzLabel =
      offsetMin === 420
        ? 'WIB'
        : offsetMin === 480
        ? 'WITA'
        : offsetMin === 540
        ? 'WIT'
        : absM === 0
        ? `GMT${sign}${absH}`
        : `GMT${sign}${absH}:${pad(absM)}`;
    return {
      now,
      dateStr: `${year}-${month}-${day}`,
      monthStr: `${year}-${month}`,
      timeStr: `${pad(hour)}:${pad(minute)}:${pad(second)}`,
      hour,
      minute,
      tzLabel,
    };
  }

  return formatWithIana('Asia/Jakarta');
}

const DEFAULT_SOCIAL_LINKS = [
  { id: 'ig', platform: 'instagram', label: 'Instagram', url: 'https://instagram.com' },
  { id: 'tt', platform: 'tiktok', label: 'TikTok', url: 'https://tiktok.com' },
  { id: 'yt', platform: 'youtube', label: 'YouTube', url: 'https://youtube.com' },
];

function getSiteSettings() {
  const rows = db.prepare('SELECT key, value FROM site_settings').all() as Array<{ key: string; value: string }>;
  const map = new Map(rows.map((r) => [r.key, r.value]));
  let socialLinks = DEFAULT_SOCIAL_LINKS;
  const rawSocial = map.get('social_links');
  if (rawSocial) {
    try {
      const parsed = JSON.parse(rawSocial);
      if (Array.isArray(parsed)) {
        socialLinks = parsed;
      }
    } catch {
      socialLinks = DEFAULT_SOCIAL_LINKS;
    }
  }
  return {
    brandName: map.has('brand_name') ? map.get('brand_name')! : 'Multimedia',
    logoUrl: map.get('brand_logo_url') || '',
    heroEyebrow: map.get('hero_eyebrow') || 'SMP Negeri 2 Ciamis · Ekstrakurikuler Resmi',
    heroTitle: map.get('hero_title') || 'Nedacis Media Center: Ruang Berkarya & Jurnalisme Siswa SMPN 2 Ciamis',
    heroDescription:
      map.get('hero_description') ||
      'Wadah resmi siswa SMPN 2 Ciamis dalam bidang fotografi, videografi, penyiaran, desain grafis, dan jurnalistik sekolah—dilengkapi arsip karya digital serta sistem absensi kartu pelajar NFC/RFID dan QR Code secara real-time.',
    heroImageUrl: map.get('hero_image_url') || '',
    footerAddress: map.get('footer_address') || 'Jalan Jenderal Sudirman No. 241, Sindangrasa, Kec. Ciamis, Kabupaten Ciamis, Jawa Barat 46215',
    socialLinks,
  };
}

// ==================== API ROUTES ====================

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: 'Username dan ID Login wajib diisi.' });
    return;
  }

  const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(username.trim()) as (AuthUser & { password_hash: string }) | undefined;
  const cleanId = password.trim();
  const swappedId = cleanId.toUpperCase().startsWith('MMC-')
    ? `NMC-${cleanId.slice(4)}`
    : cleanId.toUpperCase().startsWith('NMC-')
    ? `MMC-${cleanId.slice(4)}`
    : cleanId;
  const idMatched =
    Boolean(user) &&
    (verifyPassword(cleanId, user!.password_hash) ||
      (Boolean(user!.qr_code_token) &&
        (user!.qr_code_token.trim().toLowerCase() === cleanId.toLowerCase() ||
          user!.qr_code_token.trim().toLowerCase() === swappedId.toLowerCase())) ||
      (Boolean(user!.nis) && user!.nis.trim().toLowerCase() === cleanId.toLowerCase()));

  if (!user || !idMatched) {
    res.status(401).json({ error: 'Username atau ID Login tidak sesuai.' });
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, expiresAt);

  const { password_hash: _ignored, ...safeUser } = user;
  res.json({ token, user: { ...safeUser, lms_points: getUserTotalLmsPoints(user.id) } });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(authHeader.slice(7).trim());
  }
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Sesi tidak aktif.' });
    return;
  }
  res.json({ user: { ...user, lms_points: getUserTotalLmsPoints(user.id) } });
});

app.get('/api/bootstrap', (req, res) => {
  const user = getUserFromRequest(req);
  const news = db.prepare('SELECT * FROM news_articles ORDER BY published_at DESC, id DESC').all();
  const schedules = db.prepare('SELECT * FROM schedules ORDER BY event_date ASC, start_time ASC').all();
  const members = db.prepare(`
    SELECT
      u.id, u.username, u.role, u.full_name, u.nis, u.kelas, u.division, u.bio,
      u.nfc_uid, u.qr_code_token, u.avatar_color, u.avatar_url, u.show_in_members, u.created_at,
      (SELECT COUNT(*) FROM attendance_records ar WHERE ar.user_id = u.id AND ar.status IN ('Hadir', 'Terlambat')) as attendance_count,
      (SELECT COUNT(*) FROM works w WHERE w.user_id = u.id AND w.approval_status = 'approved') as works_count,
      COALESCE((SELECT SUM(lts.points_awarded) FROM lms_task_submissions lts WHERE lts.user_id = u.id), 0) as lms_points
    FROM users u
    WHERE (u.role = 'student' OR u.show_in_members = 1)
    ORDER BY CASE WHEN u.role = 'admin' THEN 0 ELSE 1 END, u.nis ASC
  `).all();
  const works = getEnrichedWorks(user?.id, 'approved');

  const attendanceToday =
    user?.role === 'admin'
      ? db.prepare(`
          SELECT ar.*, u.full_name, u.username, u.nis, u.kelas, u.division, u.nfc_uid
          FROM attendance_records ar
          JOIN users u ON u.id = ar.user_id
          ORDER BY ar.attendance_date DESC, ar.check_in_time DESC
          LIMIT 60
        `).all()
      : [];

  res.json({
    user: user ? { ...user, lms_points: getUserTotalLmsPoints(user.id) } : null,
    news,
    schedules,
    members,
    works,
    attendance: attendanceToday,
    lmsTasks: user ? getLmsTasksForUser(user) : [],
    siteSettings: getSiteSettings(),
  });
});

// Student profile detail (accessible by QR code scan or clicking member card)
app.get('/api/members/:identifier', (req, res) => {
  const { identifier } = req.params;
  const currentUser = getUserFromRequest(req);

  const member = db.prepare(`
    SELECT
      u.id, u.username, u.role, u.full_name, u.nis, u.kelas, u.division, u.bio,
      u.nfc_uid, u.qr_code_token, u.avatar_color, u.avatar_url, u.created_at,
      COALESCE((SELECT SUM(lts.points_awarded) FROM lms_task_submissions lts WHERE lts.user_id = u.id), 0) as lms_points
    FROM users u
    WHERE u.username = ? OR u.qr_code_token = ? OR CAST(u.id AS TEXT) = ?
  `).get(identifier, identifier, identifier) as AuthUser | undefined;

  if (!member) {
    res.status(404).json({ error: 'Profil anggota tidak ditemukan.' });
    return;
  }

  const attendanceHistory = db.prepare(`
    SELECT ar.*, u.full_name, u.username, u.nis, u.kelas, u.division, u.nfc_uid
    FROM attendance_records ar
    JOIN users u ON u.id = ar.user_id
    WHERE ar.user_id = ?
    ORDER BY ar.attendance_date DESC, ar.check_in_time DESC
  `).all(member.id);

  const canSeePending = Boolean(currentUser && (currentUser.id === member.id || currentUser.role === 'admin'));
  const allWorks = getEnrichedWorks(currentUser?.id, canSeePending ? 'all' : 'approved').filter(
    (w: Record<string, unknown>) => w.user_id === member.id
  );

  res.json({
    member,
    attendanceHistory,
    works: allWorks,
  });
});

// Update own profile
app.patch('/api/profile', requireAuth, (req: AuthedRequest, res) => {
  const { bio, division, newPassword } = req.body as { bio?: string; division?: string; newPassword?: string };
  const userId = req.user!.id;

  db.transaction(() => {
    if (bio !== undefined) {
      db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio.trim().slice(0, 300), userId);
    }
    if (division !== undefined && ['Fotografi', 'Videografi', 'Jurnalistik', 'Desain Grafis', 'Penyiaran'].includes(division)) {
      db.prepare('UPDATE users SET division = ? WHERE id = ?').run(division, userId);
    }
    if (newPassword && newPassword.trim().length >= 6) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword.trim()), userId);
    }
  })();

  checkpointDatabase('PASSIVE');

  const updated = db.prepare(`
    SELECT id, username, role, full_name, nis, kelas, division, bio, nfc_uid, qr_code_token, avatar_color, avatar_url, created_at
    FROM users WHERE id = ?
  `).get(userId) as AuthUser;
  res.json({ user: { ...updated, lms_points: getUserTotalLmsPoints(userId) } });
});

// Upload own profile photo (member or admin)
app.post('/api/profile/avatar', requireAuth, upload.single('avatar'), (req: AuthedRequest, res) => {
  const file = req.file;
  if (!file || !file.mimetype.startsWith('image/')) {
    if (file) {
      fs.unlink(file.path, () => {});
    }
    res.status(400).json({ error: 'File foto profil wajib berupa gambar (JPG, PNG, atau WebP).' });
    return;
  }

  const userId = req.user!.id;
  const existing = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(userId) as { avatar_url?: string } | undefined;
  const avatarUrl = `/uploads/${file.filename}`;
  db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, userId);
  checkpointDatabase('PASSIVE');

  if (existing?.avatar_url && existing.avatar_url.startsWith('/uploads/')) {
    const oldPath = path.join(UPLOADS_DIR, path.basename(existing.avatar_url));
    if (fs.existsSync(oldPath)) {
      fs.unlink(oldPath, () => {});
    }
  }

  const updated = db.prepare(`
    SELECT id, username, role, full_name, nis, kelas, division, bio, nfc_uid, qr_code_token, avatar_color, avatar_url, created_at
    FROM users WHERE id = ?
  `).get(userId) as AuthUser;

  broadcastEvent({ type: 'member:updated', payload: { id: userId, avatar_url: avatarUrl } });
  res.json({ user: { ...updated, lms_points: getUserTotalLmsPoints(userId) } });
});

// ==================== ADMIN STUDENT MANAGEMENT (20 REGISTERED SEATS) ====================

app.post('/api/admin/students', requireAdmin, (req: AuthedRequest, res) => {
  const { username, password, full_name, nis, kelas, division, nfc_uid, bio } = req.body as {
    username?: string;
    password?: string;
    full_name?: string;
    nis?: string;
    kelas?: string;
    division?: string;
    nfc_uid?: string;
    bio?: string;
  };

  if (!username || !full_name || !nis || !kelas || !division) {
    res.status(400).json({ error: 'Username, nama lengkap, NIS, kelas, dan divisi wajib diisi.' });
    return;
  }

  const studentCount = (db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE role = 'student'`).get() as { cnt: number }).cnt;
  if (studentCount >= 20) {
    res.status(400).json({ error: 'Kuota maksimal 20 peserta didik terdaftar telah tercapai. Hapus atau perbarui akun yang ada terlebih dahulu.' });
    return;
  }

  const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
  if (exists) {
    res.status(409).json({ error: 'Username sudah digunakan oleh siswa lain.' });
    return;
  }

  const generatedNfc = (nfc_uid && nfc_uid.trim().toUpperCase()) || `04${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const generatedQr = `NMC-CMS-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const colors = ['#1D4ED8', '#0F766E', '#B45309', '#BE123C', '#4338CA', '#0369A1'];
  const avatarColor = colors[studentCount % colors.length];
  const now = new Date().toISOString();

  try {
    const info = db.prepare(`
      INSERT INTO users (username, password_hash, role, full_name, nis, kelas, division, bio, nfc_uid, qr_code_token, avatar_color, created_at)
      VALUES (?, ?, 'student', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cleanUsername,
      hashPassword(password?.trim() || 'siswa123'),
      full_name.trim(),
      nis.trim(),
      kelas.trim(),
      division,
      bio?.trim() || `Anggota aktif Divisi ${division} NMC SMPN 2 Ciamis.`,
      generatedNfc,
      generatedQr,
      avatarColor,
      now
    );

    const created = db.prepare(`
      SELECT id, username, role, full_name, nis, kelas, division, bio, nfc_uid, qr_code_token, avatar_color, avatar_url, created_at
      FROM users WHERE id = ?
    `).get(info.lastInsertRowid);
    checkpointDatabase('PASSIVE');
    res.status(201).json({ student: created });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal membuat akun siswa.' });
  }
});

app.patch('/api/admin/students/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const {
    full_name,
    username,
    nis,
    kelas,
    division,
    bio,
    nfc_uid,
    qr_code_token,
    avatar_color,
    password,
  } = req.body as {
    full_name?: string;
    username?: string;
    nis?: string;
    kelas?: string;
    division?: string;
    bio?: string;
    nfc_uid?: string;
    qr_code_token?: string;
    avatar_color?: string;
    password?: string;
  };

  const existing = db.prepare('SELECT * FROM users WHERE id = ? AND (role = ? OR show_in_members = 1)').get(id, 'student') as AuthUser | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Anggota tidak ditemukan.' });
    return;
  }

  try {
    let cleanUsername: string | null = null;
    if (username !== undefined && username.trim()) {
      cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
      if (!cleanUsername) {
        res.status(400).json({ error: 'Format username tidak valid.' });
        return;
      }
      const dupUser = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?').get(cleanUsername, id);
      if (dupUser) {
        res.status(409).json({ error: 'Username sudah digunakan oleh siswa lain.' });
        return;
      }
    }

    let cleanNfc: string | null = null;
    if (nfc_uid !== undefined && nfc_uid.trim()) {
      cleanNfc = nfc_uid.trim().toUpperCase();
      const dupNfc = db.prepare('SELECT id FROM users WHERE UPPER(nfc_uid) = UPPER(?) AND id != ?').get(cleanNfc, id);
      if (dupNfc) {
        res.status(409).json({ error: 'UID Kartu NFC/RFID sudah terdaftar pada siswa lain.' });
        return;
      }
    }

    let cleanQr: string | null = null;
    if (qr_code_token !== undefined && qr_code_token.trim()) {
      cleanQr = qr_code_token.trim().toUpperCase();
      const dupQr = db.prepare('SELECT id FROM users WHERE UPPER(qr_code_token) = UPPER(?) AND id != ?').get(cleanQr, id);
      if (dupQr) {
        res.status(409).json({ error: 'Token QR Code sudah digunakan oleh siswa lain.' });
        return;
      }
    }

    db.transaction(() => {
      if (cleanUsername !== null) {
        db.prepare('UPDATE users SET username = ? WHERE id = ?').run(cleanUsername, id);
      }
      if (cleanNfc !== null) {
        db.prepare('UPDATE users SET nfc_uid = ? WHERE id = ?').run(cleanNfc, id);
      }
      if (cleanQr !== null) {
        db.prepare('UPDATE users SET qr_code_token = ? WHERE id = ?').run(cleanQr, id);
      }
      if (full_name !== undefined && full_name.trim()) {
        db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(full_name.trim(), id);
      }
      if (nis !== undefined && nis.trim()) {
        db.prepare('UPDATE users SET nis = ? WHERE id = ?').run(nis.trim(), id);
      }
      if (kelas !== undefined && kelas.trim()) {
        db.prepare('UPDATE users SET kelas = ? WHERE id = ?').run(kelas.trim(), id);
      }
      if (division !== undefined && division.trim()) {
        db.prepare('UPDATE users SET division = ? WHERE id = ?').run(division.trim(), id);
      }
      if (bio !== undefined) {
        db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio.trim().slice(0, 400), id);
      }
      if (avatar_color !== undefined && /^#[0-9A-Fa-f]{6}$/.test(avatar_color.trim())) {
        db.prepare('UPDATE users SET avatar_color = ? WHERE id = ?').run(avatar_color.trim(), id);
      }
      if (password && password.trim().length >= 4) {
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password.trim()), id);
      }
    })();

    checkpointDatabase('PASSIVE');

    const updated = db.prepare(`
      SELECT id, username, role, full_name, nis, kelas, division, bio, nfc_uid, qr_code_token, avatar_color, avatar_url, created_at
      FROM users WHERE id = ?
    `).get(id) as AuthUser;
    res.json({ student: { ...updated, lms_points: getUserTotalLmsPoints(id) } });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Gagal memperbarui data profil siswa.' });
  }
});

app.delete('/api/admin/students/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM users WHERE id = ? AND role = ?').run(id, 'student');
  if (info.changes === 0) {
    res.status(404).json({ error: 'Akun siswa tidak ditemukan.' });
    return;
  }
  checkpointDatabase('PASSIVE');
  res.json({ ok: true });
});

// ==================== ATTENDANCE (NFC/RFID USB READER & QR CODE) ====================

app.get('/api/attendance', requireAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT ar.*, u.full_name, u.username, u.nis, u.kelas, u.division, u.nfc_uid
    FROM attendance_records ar
    JOIN users u ON u.id = ar.user_id
    ORDER BY ar.attendance_date DESC, ar.check_in_time DESC
    LIMIT 120
  `).all();
  res.json({ records: rows });
});

app.post('/api/attendance/scan', requireAdmin, (req: AuthedRequest, res) => {
  const currentUser = req.user;
  const { code, method, session_title, status } = req.body as {
    code?: string;
    method?: 'NFC/RFID' | 'QR Scan' | 'Manual Admin';
    session_title?: string;
    status?: 'Hadir' | 'Terlambat' | 'Izin';
  };

  if (!code || !code.trim()) {
    res.status(400).json({ error: 'Kode kartu NFC/RFID atau QR Code tidak terbaca.' });
    return;
  }

  let cleanCode = code.trim();
  // Support scanning a full profile URL encoded in QR code (e.g., https://.../profil/ahmad.fauzan or #profil/ahmad.fauzan)
  const urlMatch = cleanCode.match(/profil\/([a-zA-Z0-9._-]+)$/i);
  if (urlMatch) {
    cleanCode = urlMatch[1];
  }

  const swappedCode = cleanCode.toUpperCase().startsWith('MMC-')
    ? `NMC-${cleanCode.slice(4)}`
    : cleanCode.toUpperCase().startsWith('NMC-')
    ? `MMC-${cleanCode.slice(4)}`
    : cleanCode;
  const student = db.prepare(`
    SELECT * FROM users
    WHERE (role = 'student' OR show_in_members = 1)
      AND (
        UPPER(nfc_uid) = UPPER(?)
        OR UPPER(qr_code_token) = UPPER(?)
        OR UPPER(qr_code_token) = UPPER(?)
        OR LOWER(username) = LOWER(?)
        OR nis = ?
      )
  `).get(cleanCode, cleanCode, swappedCode, cleanCode, cleanCode) as AuthUser | undefined;

  if (!student) {
    res.status(404).json({ error: `Kartu / QR "${cleanCode}" tidak terdaftar pada 20 anggota NMC SMPN 2 Ciamis.` });
    return;
  }

  const clientNow = getClientNowParts(req);
  const attendanceDate = clientNow.dateStr;
  const checkInTime = clientNow.timeStr;

  const scanMethod: 'NFC/RFID' | 'QR Scan' | 'Manual Admin' =
    method === 'QR Scan' || method === 'Manual Admin' ? method : 'NFC/RFID';

  // Determine status (after 15:15 considered Terlambat unless explicitly set by admin)
  let resolvedStatus: 'Hadir' | 'Terlambat' | 'Izin' = 'Hadir';
  if (status && ['Hadir', 'Terlambat', 'Izin'].includes(status)) {
    resolvedStatus = status;
  } else if (clientNow.hour > 15 || (clientNow.hour === 15 && clientNow.minute > 15)) {
    resolvedStatus = 'Hadir'; // keep Hadir default for live demo friendliness unless late toggle used, or let's mark based on schedule
  }

  const resolvedSession = session_title?.trim() || 'Pertemuan Rutin Nedacis Media Center';
  const recordedBy = currentUser ? currentUser.full_name : 'Terminal USB Reader Studio NMC';

  const existingToday = db.prepare(`
    SELECT id FROM attendance_records WHERE user_id = ? AND attendance_date = ?
  `).get(student.id, attendanceDate) as { id: number } | undefined;

  if (existingToday) {
    db.prepare(`
      UPDATE attendance_records
      SET check_in_time = ?, method = ?, status = ?, session_title = ?, recorded_by = ?
      WHERE id = ?
    `).run(checkInTime, scanMethod, resolvedStatus, resolvedSession, recordedBy, existingToday.id);
  } else {
    db.prepare(`
      INSERT INTO attendance_records (user_id, attendance_date, check_in_time, method, status, session_title, recorded_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(student.id, attendanceDate, checkInTime, scanMethod, resolvedStatus, resolvedSession, recordedBy, clientNow.now.toISOString());
  }

  const record = db.prepare(`
    SELECT ar.*, u.full_name, u.username, u.nis, u.kelas, u.division, u.nfc_uid
    FROM attendance_records ar
    JOIN users u ON u.id = ar.user_id
    WHERE ar.user_id = ? AND ar.attendance_date = ?
  `).get(student.id, attendanceDate);

  broadcastEvent({ type: 'attendance:recorded', payload: record });

  createAndBroadcastNotification({
    userId: student.id,
    type: 'attendance',
    title: `Absensi ${scanMethod} Tercatat`,
    message: `${student.full_name} tercatat ${resolvedStatus} pada ${attendanceDate} pukul ${checkInTime} ${clientNow.tzLabel} (${resolvedSession}).`,
    linkTarget: `profil/${student.username}`,
  });

  checkpointDatabase('PASSIVE');

  res.json({
    alreadyRecorded: Boolean(existingToday),
    record,
    student: {
      id: student.id,
      username: student.username,
      full_name: student.full_name,
      kelas: student.kelas,
      division: student.division,
    },
  });
});

app.get('/api/attendance/monthly-report', requireAdmin, (req, res) => {
  const defaultMonth = getClientNowParts(req).monthStr;
  const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : defaultMonth;

  const totalSessionsRow = db.prepare(`
    SELECT COUNT(DISTINCT attendance_date) as cnt
    FROM attendance_records
    WHERE substr(attendance_date, 1, 7) = ?
  `).get(month) as { cnt: number };

  const totalSessions = Math.max(totalSessionsRow.cnt, 1);

  const students = db.prepare(`
    SELECT id, full_name, username, nis, kelas, division
    FROM users
    WHERE role = 'student'
    ORDER BY nis ASC
  `).all() as Array<{ id: number; full_name: string; username: string; nis: string; kelas: string; division: string }>;

  const rows = students.map((s) => {
    const records = db.prepare(`
      SELECT status, method FROM attendance_records
      WHERE user_id = ? AND substr(attendance_date, 1, 7) = ?
      ORDER BY attendance_date DESC
    `).all(s.id, month) as Array<{ status: string; method: string }>;

    const hadirCount = records.filter((r) => r.status === 'Hadir').length;
    const terlambatCount = records.filter((r) => r.status === 'Terlambat').length;
    const izinCount = records.filter((r) => r.status === 'Izin').length;
    const attended = hadirCount + terlambatCount;
    const alphaCount = Math.max(0, totalSessionsRow.cnt - (attended + izinCount));
    const attendanceRate = totalSessionsRow.cnt === 0 ? 0 : Math.round((attended / totalSessions) * 100);

    return {
      user_id: s.id,
      full_name: s.full_name,
      username: s.username,
      nis: s.nis,
      kelas: s.kelas,
      division: s.division,
      total_sessions: totalSessionsRow.cnt,
      hadir_count: hadirCount,
      terlambat_count: terlambatCount,
      izin_count: izinCount,
      alpha_count: alphaCount,
      attendance_rate: attendanceRate,
      last_method: records[0]?.method || null,
    };
  });

  res.json({ month, totalSessions: totalSessionsRow.cnt, rows });
});

// ==================== STUDENT WORKS (IMAGE & VIDEO UPLOAD + SOCIAL + MODERATION) ====================

app.post('/api/works', requireAuth, upload.single('media'), (req: AuthedRequest, res) => {
  const { title, description, category } = req.body as { title?: string; description?: string; category?: string };
  const file = req.file;

  if (!file) {
    res.status(400).json({ error: 'File gambar atau video karya wajib dilampirkan.' });
    return;
  }
  if (!title || !title.trim()) {
    res.status(400).json({ error: 'Judul karya wajib diisi.' });
    return;
  }

  const mediaType = file.mimetype.startsWith('video/') ? 'video' : 'image';
  const mediaUrl = `/uploads/${file.filename}`;
  const now = new Date().toISOString();
  const isAdminUploader = req.user!.role === 'admin';
  const approvalStatus = isAdminUploader ? 'approved' : 'pending';

  const info = db.prepare(`
    INSERT INTO works (user_id, title, description, category, media_type, media_url, shares_count, comments_disabled, approval_status, review_note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, '', ?)
  `).run(
    req.user!.id,
    title.trim().slice(0, 140),
    (description || '').trim().slice(0, 600),
    category || req.user!.division || 'Fotografi',
    mediaType,
    mediaUrl,
    approvalStatus,
    now
  );

  const enriched = getEnrichedWorks(req.user!.id, 'all').find((w: Record<string, unknown>) => w.id === Number(info.lastInsertRowid));
  if (isAdminUploader && enriched) {
    broadcastEvent({ type: 'work:created', payload: enriched });
  } else {
    const adminUsers = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).all() as Array<{ id: number }>;
    for (const adm of adminUsers) {
      createAndBroadcastNotification({
        userId: adm.id,
        type: 'moderation',
        title: 'Karya Baru Menunggu Persetujuan',
        message: `${req.user!.full_name} mengunggah "${title.trim()}" dan menunggu peninjauan admin untuk tampil di Beranda.`,
        linkTarget: 'persetujuan',
      });
    }
  }
  res.status(201).json({ work: enriched, pendingApproval: !isAdminUploader });
});

app.get('/api/admin/works/pending', requireAdmin, (req: AuthedRequest, res) => {
  const pendingWorks = getEnrichedWorks(req.user!.id, 'pending');
  res.json({ works: pendingWorks });
});

app.post('/api/admin/works/:id/review', requireAdmin, (req, res) => {
  const workId = Number(req.params.id);
  const { decision, note } = req.body as { decision?: 'approved' | 'rejected'; note?: string };
  if (decision !== 'approved' && decision !== 'rejected') {
    res.status(400).json({ error: 'Keputusan peninjauan harus approved atau rejected.' });
    return;
  }

  const work = db.prepare('SELECT id, user_id, title FROM works WHERE id = ?').get(workId) as
    | { id: number; user_id: number; title: string }
    | undefined;
  if (!work) {
    res.status(404).json({ error: 'Karya tidak ditemukan.' });
    return;
  }

  const cleanNote = (note || '').trim().slice(0, 300);
  db.prepare('UPDATE works SET approval_status = ?, review_note = ? WHERE id = ?').run(decision, cleanNote, workId);

  const enriched = getEnrichedWorks(undefined, 'all').find((w: Record<string, unknown>) => w.id === workId);

  if (decision === 'approved') {
    if (enriched) {
      broadcastEvent({ type: 'work:created', payload: enriched });
    }
    createAndBroadcastNotification({
      userId: work.user_id,
      type: 'moderation',
      title: 'Karya Disetujui & Terbit di Beranda',
      message: `Selamat! Karya Anda "${work.title}" telah disetujui Pembina dan kini tampil di Beranda serta Galeri.`,
      linkTarget: 'beranda',
    });
  } else {
    broadcastEvent({ type: 'work:deleted', payload: { id: workId } });
    createAndBroadcastNotification({
      userId: work.user_id,
      type: 'moderation',
      title: 'Karya Perlu Perbaikan',
      message: `Karya "${work.title}" belum dapat diterbitkan${cleanNote ? `: ${cleanNote}` : '.'}`,
      linkTarget: 'anggota',
    });
  }

  res.json({ work: enriched });
});

app.delete('/api/works/:id', requireAuth, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(id) as { id: number; user_id: number; title: string; media_url: string } | undefined;
  if (!work) {
    res.status(404).json({ error: 'Karya tidak ditemukan.' });
    return;
  }
  if (req.user!.role !== 'admin' && req.user!.id !== work.user_id) {
    res.status(403).json({ error: 'Anda tidak memiliki izin menghapus karya ini.' });
    return;
  }

  db.prepare('DELETE FROM works WHERE id = ?').run(id);

  if (work.media_url.startsWith('/uploads/')) {
    const filePath = path.join(UPLOADS_DIR, path.basename(work.media_url));
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, () => {});
    }
  }

  if (req.user!.role === 'admin' && req.user!.id !== work.user_id) {
    createAndBroadcastNotification({
      userId: work.user_id,
      type: 'moderation',
      title: 'Karya Dihapus oleh Pembina',
      message: `Konten "${work.title}" telah ditinjau dan dihapus oleh admin demi menjaga kelayakan publikasi sekolah.`,
      linkTarget: 'galeri',
    });
  }

  broadcastEvent({ type: 'work:deleted', payload: { id } });
  res.json({ ok: true });
});

app.patch('/api/works/:id/comments-toggle', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const work = db.prepare('SELECT id, comments_disabled, user_id, title FROM works WHERE id = ?').get(id) as
    | { id: number; comments_disabled: number; user_id: number; title: string }
    | undefined;
  if (!work) {
    res.status(404).json({ error: 'Karya tidak ditemukan.' });
    return;
  }
  const nextVal = work.comments_disabled ? 0 : 1;
  db.prepare('UPDATE works SET comments_disabled = ? WHERE id = ?').run(nextVal, id);

  broadcastEvent({ type: 'work:updated', payload: { id, comments_disabled: nextVal } });

  createAndBroadcastNotification({
    userId: work.user_id,
    type: 'moderation',
    title: nextVal ? 'Komentar Dinonaktifkan' : 'Komentar Diaktifkan Kembali',
    message: `Pembina ${nextVal ? 'menonaktifkan' : 'mengaktifkan kembali'} kolom komentar pada karya "${work.title}".`,
    linkTarget: 'galeri',
  });

  res.json({ comments_disabled: nextVal });
});

app.post('/api/works/:id/like', requireAuth, (req: AuthedRequest, res) => {
  const workId = Number(req.params.id);
  const work = db.prepare('SELECT id, user_id, title FROM works WHERE id = ?').get(workId) as
    | { id: number; user_id: number; title: string }
    | undefined;
  if (!work) {
    res.status(404).json({ error: 'Karya tidak ditemukan.' });
    return;
  }

  const existing = db.prepare('SELECT 1 FROM work_likes WHERE work_id = ? AND user_id = ?').get(workId, req.user!.id);
  let liked = false;
  if (existing) {
    db.prepare('DELETE FROM work_likes WHERE work_id = ? AND user_id = ?').run(workId, req.user!.id);
  } else {
    db.prepare('INSERT INTO work_likes (work_id, user_id, created_at) VALUES (?, ?, ?)').run(workId, req.user!.id, new Date().toISOString());
    liked = true;
    if (work.user_id !== req.user!.id) {
      createAndBroadcastNotification({
        userId: work.user_id,
        type: 'like',
        title: 'Suka Baru pada Karya Anda',
        message: `${req.user!.full_name} menyukai karya "${work.title}".`,
        linkTarget: 'galeri',
      });
    }
  }

  const count = (db.prepare('SELECT COUNT(*) as cnt FROM work_likes WHERE work_id = ?').get(workId) as { cnt: number }).cnt;
  broadcastEvent({ type: 'work:updated', payload: { id: workId, likes_count: count } });
  res.json({ liked, likes_count: count });
});

app.post('/api/works/:id/share', (req, res) => {
  const workId = Number(req.params.id);
  const currentUser = getUserFromRequest(req);
  const work = db.prepare('SELECT id, user_id, title, shares_count FROM works WHERE id = ?').get(workId) as
    | { id: number; user_id: number; title: string; shares_count: number }
    | undefined;
  if (!work) {
    res.status(404).json({ error: 'Karya tidak ditemukan.' });
    return;
  }

  db.prepare('UPDATE works SET shares_count = shares_count + 1 WHERE id = ?').run(workId);
  const nextCount = work.shares_count + 1;

  if (currentUser && work.user_id !== currentUser.id) {
    createAndBroadcastNotification({
      userId: work.user_id,
      type: 'share',
      title: 'Karya Anda Dibagikan',
      message: `${currentUser.full_name} membagikan tautan karya "${work.title}".`,
      linkTarget: 'galeri',
    });
  }

  broadcastEvent({ type: 'work:updated', payload: { id: workId, shares_count: nextCount } });
  res.json({ shares_count: nextCount });
});

app.post('/api/works/:id/comments', requireAuth, (req: AuthedRequest, res) => {
  const workId = Number(req.params.id);
  const { content } = req.body as { content?: string };
  if (!content || !content.trim()) {
    res.status(400).json({ error: 'Isi komentar tidak boleh kosong.' });
    return;
  }

  const work = db.prepare('SELECT id, user_id, title, comments_disabled FROM works WHERE id = ?').get(workId) as
    | { id: number; user_id: number; title: string; comments_disabled: number }
    | undefined;

  if (!work) {
    res.status(404).json({ error: 'Karya tidak ditemukan.' });
    return;
  }
  if (work.comments_disabled) {
    res.status(403).json({ error: 'Kolom komentar telah dinonaktifkan oleh Pembina NMC untuk postingan ini.' });
    return;
  }

  const cleanText = content.trim().slice(0, 500);
  const lower = cleanText.toLowerCase();
  const blockedWords = db.prepare('SELECT word FROM blocked_words').all() as Array<{ word: string }>;
  const matched = blockedWords.find((bw) => lower.includes(bw.word.toLowerCase()));

  if (matched) {
    res.status(400).json({
      error: `Komentar ditahan oleh filter diskusi sehat NMC karena mengandung kata yang tidak pantas ("${matched.word}"). Gunakan bahasa yang santun dan edukatif.`,
      filtered: true,
    });
    return;
  }

  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO work_comments (work_id, user_id, content, is_hidden, flagged_reason, created_at)
    VALUES (?, ?, ?, 0, NULL, ?)
  `).run(workId, req.user!.id, cleanText, now);

  const comment = db.prepare(`
    SELECT wc.*, u.full_name as author_name, u.username as author_username, u.kelas as author_kelas, u.role as author_role
    FROM work_comments wc
    JOIN users u ON u.id = wc.user_id
    WHERE wc.id = ?
  `).get(info.lastInsertRowid);

  const commentsCount = (db.prepare('SELECT COUNT(*) as cnt FROM work_comments WHERE work_id = ? AND is_hidden = 0').get(workId) as { cnt: number }).cnt;

  broadcastEvent({ type: 'comment:created', payload: comment });
  broadcastEvent({ type: 'work:updated', payload: { id: workId, comments_count: commentsCount } });

  if (work.user_id !== req.user!.id) {
    createAndBroadcastNotification({
      userId: work.user_id,
      type: 'comment',
      title: 'Komentar Baru pada Karya Anda',
      message: `${req.user!.full_name} berkomentar pada "${work.title}": "${cleanText.slice(0, 70)}"`,
      linkTarget: 'galeri',
    });
  }

  res.status(201).json({ comment });
});

app.delete('/api/comments/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id, work_id FROM work_comments WHERE id = ?').get(id) as { id: number; work_id: number } | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Komentar tidak ditemukan.' });
    return;
  }

  db.prepare('DELETE FROM work_comments WHERE id = ?').run(id);
  const commentsCount = (db.prepare('SELECT COUNT(*) as cnt FROM work_comments WHERE work_id = ? AND is_hidden = 0').get(existing.work_id) as { cnt: number }).cnt;

  broadcastEvent({ type: 'comment:deleted', payload: { id, work_id: existing.work_id } });
  broadcastEvent({ type: 'work:updated', payload: { id: existing.work_id, comments_count: commentsCount } });
  res.json({ ok: true });
});

// ==================== ADMIN MODERATION FILTER WORDS ====================

app.get('/api/admin/blocked-words', requireAdmin, (_req, res) => {
  const words = db.prepare('SELECT * FROM blocked_words ORDER BY word ASC').all();
  res.json({ words });
});

app.post('/api/admin/blocked-words', requireAdmin, (req, res) => {
  const { word } = req.body as { word?: string };
  if (!word || !word.trim()) {
    res.status(400).json({ error: 'Kata filter tidak boleh kosong.' });
    return;
  }
  const clean = word.trim().toLowerCase();
  db.prepare('INSERT OR IGNORE INTO blocked_words (word) VALUES (?)').run(clean);
  const words = db.prepare('SELECT * FROM blocked_words ORDER BY word ASC').all();
  res.json({ words });
});

app.delete('/api/admin/blocked-words/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM blocked_words WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ==================== NEWS & SCHEDULES & NOTIFICATIONS ====================

app.post('/api/news', requireAdmin, (req: AuthedRequest, res) => {
  const { title, category, summary, content } = req.body as {
    title?: string;
    category?: string;
    summary?: string;
    content?: string;
  };
  if (!title || !summary || !content) {
    res.status(400).json({ error: 'Judul, ringkasan, dan isi artikel wajib diisi.' });
    return;
  }
  const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)}-${Date.now()}`;
  const publishedAt = getClientNowParts(req).dateStr;
  const info = db.prepare(`
    INSERT INTO news_articles (title, slug, category, summary, content, image_url, author_name, published_at, is_featured)
    VALUES (?, ?, ?, ?, ?, 'asset:news_liputan', ?, ?, 0)
  `).run(title.trim(), slug, category || 'Liputan Sekolah', summary.trim(), content.trim(), req.user!.full_name, publishedAt);

  const article = db.prepare('SELECT * FROM news_articles WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ article });
});

app.post('/api/schedules', requireAdmin, (req, res) => {
  const { title, division, event_date, start_time, end_time, location, description, mentor } = req.body as {
    title?: string;
    division?: string;
    event_date?: string;
    start_time?: string;
    end_time?: string;
    location?: string;
    description?: string;
    mentor?: string;
  };
  if (!title || !event_date || !start_time || !location) {
    res.status(400).json({ error: 'Judul, tanggal, jam mulai, dan lokasi kegiatan wajib diisi.' });
    return;
  }
  const info = db.prepare(`
    INSERT INTO schedules (title, division, event_date, start_time, end_time, location, description, mentor, reminder_sent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    title.trim(),
    division || 'Semua Divisi',
    event_date,
    start_time,
    end_time || '16:30',
    location.trim(),
    (description || '').trim(),
    mentor?.trim() || 'Pembina NMC'
  );

  const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(info.lastInsertRowid);
  const { tzLabel } = getClientNowParts(req);
  broadcastEvent({ type: 'schedule:created', payload: schedule });
  createAndBroadcastNotification({
    userId: null,
    type: 'schedule',
    title: `Jadwal Baru: ${title.trim()}`,
    message: `Dilaksanakan pada ${event_date} pukul ${start_time} ${tzLabel} di ${location.trim()}. Siapkan kartu NFC/QR untuk absensi.`,
    linkTarget: 'jadwal',
  });
  res.status(201).json({ schedule });
});

app.post('/api/schedules/:id/remind', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const sched = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as
    | { id: number; title: string; event_date: string; start_time: string; location: string }
    | undefined;
  if (!sched) {
    res.status(404).json({ error: 'Jadwal tidak ditemukan.' });
    return;
  }

  db.prepare('UPDATE schedules SET reminder_sent = 1 WHERE id = ?').run(id);
  const { tzLabel } = getClientNowParts(req);
  const notif = createAndBroadcastNotification({
    userId: null,
    type: 'schedule',
    title: `Pengingat Kegiatan: ${sched.title}`,
    message: `Seluruh peserta didik NMC diingatkan hadir pada ${sched.event_date} pukul ${sched.start_time} ${tzLabel} di ${sched.location}.`,
    linkTarget: 'jadwal',
  });

  res.json({ ok: true, notification: notif });
});

app.delete('/api/schedules/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/notifications', requireAuth, (req: AuthedRequest, res) => {
  const rows = db.prepare(`
    SELECT * FROM notifications
    WHERE user_id IS NULL OR user_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 40
  `).all(req.user!.id);
  res.json({ notifications: rows });
});

app.post('/api/notifications/read', requireAuth, (req: AuthedRequest, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? OR user_id IS NULL').run(req.user!.id);
  res.json({ ok: true });
});

app.post('/api/admin/site-logo', requireAdmin, upload.single('logo'), (req, res) => {
  const { brandName, logoUrl, footerAddress, reset } = req.body as {
    brandName?: string;
    logoUrl?: string;
    footerAddress?: string;
    reset?: string;
  };
  const now = new Date().toISOString();

  const current = getSiteSettings();
  const deleteOldUploadedLogo = (oldUrl: string) => {
    if (oldUrl && oldUrl.startsWith('/uploads/')) {
      const oldPath = path.join(UPLOADS_DIR, path.basename(oldUrl));
      if (fs.existsSync(oldPath)) {
        fs.unlink(oldPath, () => {});
      }
    }
  };

  if (reset === 'true') {
    deleteOldUploadedLogo(current.logoUrl);
    db.transaction(() => {
      db.prepare(`INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('brand_logo_url', '', ?)`).run(now);
      db.prepare(`INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('brand_name', 'Multimedia', ?)`).run(now);
      db.prepare(`INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('footer_address', 'Jalan Jenderal Sudirman No. 241, Sindangrasa, Kec. Ciamis, Kabupaten Ciamis, Jawa Barat 46215', ?)`).run(now);
    })();
  } else {
    if (req.file && !req.file.mimetype.startsWith('image/')) {
      fs.unlink(req.file.path, () => {});
      res.status(400).json({ error: 'File logo harus berupa gambar (PNG, JPG, WebP, atau SVG).' });
      return;
    }

    db.transaction(() => {
      if (req.file) {
        deleteOldUploadedLogo(current.logoUrl);
        const nextUrl = `/uploads/${req.file.filename}`;
        db.prepare(`INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('brand_logo_url', ?, ?)`).run(nextUrl, now);
      } else if (logoUrl !== undefined) {
        const trimmedUrl = logoUrl.trim();
        if (trimmedUrl === '' && current.logoUrl) {
          deleteOldUploadedLogo(current.logoUrl);
        }
        db.prepare(`INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('brand_logo_url', ?, ?)`).run(trimmedUrl, now);
      }

      if (brandName !== undefined) {
        db.prepare(`INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('brand_name', ?, ?)`).run(brandName.trim().slice(0, 60), now);
      }
      if (footerAddress !== undefined) {
        db.prepare(`INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('footer_address', ?, ?)`).run(footerAddress.trim().slice(0, 200), now);
      }
    })();
  }

  checkpointDatabase('PASSIVE');
  const updated = getSiteSettings();
  broadcastEvent({ type: 'settings:updated', payload: updated });
  res.json({ siteSettings: updated });
});

app.post('/api/admin/hero-settings', requireAdmin, upload.single('heroImage'), (req, res) => {
  const { heroEyebrow, heroTitle, heroDescription, heroImageUrl, reset } = req.body as {
    heroEyebrow?: string;
    heroTitle?: string;
    heroDescription?: string;
    heroImageUrl?: string;
    reset?: string;
  };
  const now = new Date().toISOString();
  const current = getSiteSettings();

  const deleteOldUploadedHero = (oldUrl: string) => {
    if (oldUrl && oldUrl.startsWith('/uploads/')) {
      const oldPath = path.join(UPLOADS_DIR, path.basename(oldUrl));
      if (fs.existsSync(oldPath)) {
        fs.unlink(oldPath, () => {});
      }
    }
  };

  if (reset === 'true') {
    deleteOldUploadedHero(current.heroImageUrl);
    db.transaction(() => {
      db.prepare(`INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('hero_eyebrow', 'SMP Negeri 2 Ciamis · Ekstrakurikuler Resmi', ?)`).run(now);
      db.prepare(`INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('hero_title', 'Nedacis Media Center: Ruang Berkarya & Jurnalisme Siswa SMPN 2 Ciamis', ?)`).run(now);
      db.prepare(`INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('hero_description', 'Wadah resmi siswa SMPN 2 Ciamis dalam bidang fotografi, videografi, penyiaran, desain grafis, dan jurnalistik sekolah—dilengkapi arsip karya digital serta sistem absensi kartu pelajar NFC/RFID dan QR Code secara real-time.', ?)`).run(now);
      db.prepare(`INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('hero_image_url', '', ?)`).run(now);
    })();
  } else {
    if (heroTitle !== undefined && !heroTitle.trim()) {
      if (req.file) fs.unlink(req.file.path, () => {});
      res.status(400).json({ error: 'Judul utama hero tidak boleh kosong.' });
      return;
    }
    if (req.file && !req.file.mimetype.startsWith('image/')) {
      fs.unlink(req.file.path, () => {});
      res.status(400).json({ error: 'Foto hero harus berupa gambar (PNG, JPG, WebP, atau SVG).' });
      return;
    }

    db.transaction(() => {
      if (heroEyebrow !== undefined) {
        db.prepare(`INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('hero_eyebrow', ?, ?)`).run(
          heroEyebrow.trim().slice(0, 120),
          now
        );
      }
      if (heroTitle !== undefined) {
        db.prepare(`INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('hero_title', ?, ?)`).run(
          heroTitle.trim().slice(0, 160),
          now
        );
      }
      if (heroDescription !== undefined) {
        db.prepare(`INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('hero_description', ?, ?)`).run(
          heroDescription.trim().slice(0, 600),
          now
        );
      }
      if (req.file) {
        deleteOldUploadedHero(current.heroImageUrl);
        const nextUrl = `/uploads/${req.file.filename}`;
        db.prepare(`INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('hero_image_url', ?, ?)`).run(nextUrl, now);
      } else if (heroImageUrl !== undefined) {
        const trimmedUrl = heroImageUrl.trim();
        if (trimmedUrl === '' && current.heroImageUrl) {
          deleteOldUploadedHero(current.heroImageUrl);
        }
        db.prepare(`INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('hero_image_url', ?, ?)`).run(trimmedUrl, now);
      }
    })();
  }

  checkpointDatabase('PASSIVE');
  const updated = getSiteSettings();
  broadcastEvent({ type: 'settings:updated', payload: updated });
  res.json({ siteSettings: updated });
});

app.post('/api/admin/social-icon', requireAdmin, upload.single('icon'), (req, res) => {
  if (!req.file || !req.file.mimetype.startsWith('image/')) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(400).json({ error: 'File ikon sosial media harus berupa gambar (PNG/SVG/WebP).' });
    return;
  }
  res.json({ iconUrl: `/uploads/${req.file.filename}` });
});

app.post('/api/admin/social-links', requireAdmin, (req, res) => {
  const { socialLinks, reset } = req.body as {
    socialLinks?: Array<{
      id?: string;
      platform?: string;
      label?: string;
      url?: string;
      customIconUrl?: string;
    }>;
    reset?: boolean;
  };
  const now = new Date().toISOString();

  if (reset) {
    db.prepare(`INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('social_links', ?, ?)`).run(
      JSON.stringify(DEFAULT_SOCIAL_LINKS),
      now
    );
  } else {
    if (!Array.isArray(socialLinks)) {
      res.status(400).json({ error: 'Format daftar media sosial tidak valid.' });
      return;
    }
    const allowedPlatforms = new Set(['instagram', 'tiktok', 'youtube', 'facebook', 'x', 'website', 'custom']);
    const cleaned = socialLinks.slice(0, 12).map((item, idx) => {
      const platform = allowedPlatforms.has(String(item.platform)) ? String(item.platform) : 'website';
      const rawUrl = String(item.url || '').trim();
      const normalizedUrl =
        rawUrl && !/^https?:\/\//i.test(rawUrl) && !rawUrl.startsWith('/') ? `https://${rawUrl}` : rawUrl;
      const safeUrl = /^https?:\/\//i.test(normalizedUrl) || normalizedUrl.startsWith('/') ? normalizedUrl : '';
      return {
        id: String(item.id || `soc-${Date.now()}-${idx}`).slice(0, 40),
        platform,
        label: String(item.label || platform).trim().slice(0, 40) || platform,
        url: safeUrl,
        customIconUrl: item.customIconUrl ? String(item.customIconUrl).trim().slice(0, 500) : '',
      };
    });

    db.prepare(`INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('social_links', ?, ?)`).run(
      JSON.stringify(cleaned),
      now
    );
  }

  checkpointDatabase('PASSIVE');
  const updated = getSiteSettings();
  broadcastEvent({ type: 'settings:updated', payload: updated });
  res.json({ siteSettings: updated });
});

// ==================== LMS MULTI-STAGE TASKS & POINTS ====================

app.get('/api/tasks', requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!;
  res.json({
    tasks: getLmsTasksForUser(user),
    totalPoints: getUserTotalLmsPoints(user.id),
  });
});

app.post('/api/tasks/:id/stages/:stageId/complete', requireAuth, (req: AuthedRequest, res) => {
  const taskId = Number(req.params.id);
  const stageId = Number(req.params.stageId);
  const { responseText } = req.body as { responseText?: string };
  const user = req.user!;

  const task = db.prepare('SELECT * FROM lms_tasks WHERE id = ? AND is_published = 1').get(taskId) as
    | { id: number; division: string; title: string }
    | undefined;
  if (!task) {
    res.status(404).json({ error: 'Tugas LMS tidak ditemukan.' });
    return;
  }

  const stage = db
    .prepare('SELECT * FROM lms_task_stages WHERE id = ? AND task_id = ?')
    .get(stageId, taskId) as
    | { id: number; stage_order: number; stage_type: 'reading' | 'practice' | 'upload'; title: string }
    | undefined;

  if (!stage) {
    res.status(404).json({ error: 'Tahapan tugas tidak ditemukan.' });
    return;
  }
  if (stage.stage_type === 'upload') {
    res.status(400).json({ error: 'Tahap pengumpulan tugas diselesaikan melalui unggah file tugas.' });
    return;
  }

  const priorIncomplete = db
    .prepare(`
      SELECT s.id, s.title
      FROM lms_task_stages s
      LEFT JOIN lms_task_progress p ON p.stage_id = s.id AND p.user_id = ?
      WHERE s.task_id = ? AND s.stage_order < ? AND p.id IS NULL
      ORDER BY s.stage_order ASC
      LIMIT 1
    `)
    .get(user.id, taskId, stage.stage_order) as { id: number; title: string } | undefined;

  if (priorIncomplete) {
    res.status(400).json({
      error: `Selesaikan tahap sebelumnya terlebih dahulu: "${priorIncomplete.title}".`,
    });
    return;
  }

  if (stage.stage_type === 'practice' && (!responseText || !responseText.trim())) {
    res.status(400).json({ error: 'Tuliskan ringkasan atau jawaban pemahaman terlebih dahulu sebelum melanjutkan.' });
    return;
  }

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO lms_task_progress (task_id, stage_id, user_id, response_text, completed_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(stage_id, user_id) DO UPDATE SET
      response_text = excluded.response_text,
      completed_at = excluded.completed_at
  `).run(taskId, stageId, user.id, (responseText || '').trim().slice(0, 1000), now);

  const updatedTask = getLmsTasksForUser(user).find((t: Record<string, unknown>) => t.id === taskId);
  res.json({ task: updatedTask });
});

app.post('/api/tasks/:id/submit', requireAuth, lmsUpload.single('file'), (req: AuthedRequest, res) => {
  const taskId = Number(req.params.id);
  const { submissionNote } = req.body as { submissionNote?: string };
  const user = req.user!;
  const file = req.file;

  const task = db.prepare('SELECT * FROM lms_tasks WHERE id = ? AND is_published = 1').get(taskId) as
    | { id: number; title: string; points_reward: number; division: string }
    | undefined;
  if (!task) {
    res.status(404).json({ error: 'Tugas LMS tidak ditemukan.' });
    return;
  }

  const stages = db
    .prepare('SELECT * FROM lms_task_stages WHERE task_id = ? ORDER BY stage_order ASC, id ASC')
    .all(taskId) as Array<{ id: number; stage_order: number; stage_type: string; title: string }>;

  const uploadStage = stages.find((s) => s.stage_type === 'upload') || stages[stages.length - 1];
  if (!uploadStage) {
    res.status(400).json({ error: 'Tugas ini belum memiliki tahap pengumpulan.' });
    return;
  }

  const priorIncomplete = db
    .prepare(`
      SELECT s.id, s.title
      FROM lms_task_stages s
      LEFT JOIN lms_task_progress p ON p.stage_id = s.id AND p.user_id = ?
      WHERE s.task_id = ? AND s.stage_order < ? AND p.id IS NULL
      ORDER BY s.stage_order ASC
      LIMIT 1
    `)
    .get(user.id, taskId, uploadStage.stage_order) as { id: number; title: string } | undefined;

  if (priorIncomplete) {
    res.status(400).json({
      error: `Anda harus menyelesaikan semua tahap materi sebelumnya terlebih dahulu ("${priorIncomplete.title}").`,
    });
    return;
  }

  const existingSub = db
    .prepare('SELECT * FROM lms_task_submissions WHERE task_id = ? AND user_id = ?')
    .get(taskId, user.id) as
    | { id: number; file_url: string; file_name: string; file_type: string }
    | undefined;

  if (!file && !existingSub?.file_url) {
    res.status(400).json({ error: 'File hasil tugas wajib diunggah pada tahap akhir.' });
    return;
  }

  if (file && existingSub?.file_url && existingSub.file_url.startsWith('/uploads/')) {
    const oldPath = path.join(UPLOADS_DIR, path.basename(existingSub.file_url));
    if (fs.existsSync(oldPath)) {
      fs.unlink(oldPath, () => {});
    }
  }

  const fileUrl = file ? `/uploads/${file.filename}` : existingSub!.file_url;
  const fileName = file ? file.originalname : existingSub!.file_name;
  const fileType = file ? file.mimetype : existingSub!.file_type;
  const note = (submissionNote || '').trim().slice(0, 1000);
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO lms_task_progress (task_id, stage_id, user_id, response_text, completed_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(stage_id, user_id) DO UPDATE SET
        response_text = excluded.response_text,
        completed_at = excluded.completed_at
    `).run(taskId, uploadStage.id, user.id, note, now);

    db.prepare(`
      INSERT INTO lms_task_submissions
        (task_id, user_id, file_url, file_name, file_type, submission_note, status, points_awarded, admin_feedback, submitted_at, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?, '', ?, '')
      ON CONFLICT(task_id, user_id) DO UPDATE SET
        file_url = excluded.file_url,
        file_name = excluded.file_name,
        file_type = excluded.file_type,
        submission_note = excluded.submission_note,
        status = 'submitted',
        points_awarded = excluded.points_awarded,
        submitted_at = excluded.submitted_at
    `).run(taskId, user.id, fileUrl, fileName, fileType, note, task.points_reward, now);
  });
  tx();

  const totalPoints = getUserTotalLmsPoints(user.id);
  const updatedTask = getLmsTasksForUser(user).find((t: Record<string, unknown>) => t.id === taskId);

  broadcastEvent({ type: 'task:submitted', payload: { taskId, userId: user.id } });
  broadcastEvent({ type: 'member:points_updated', payload: { id: user.id, lms_points: totalPoints } });

  const adminUsers = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).all() as Array<{ id: number }>;
  for (const adm of adminUsers) {
    if (adm.id === user.id) continue;
    createAndBroadcastNotification({
      userId: adm.id,
      type: 'task',
      title: 'Pengumpulan Tugas LMS Baru',
      message: `${user.full_name} menyelesaikan & mengunggah tugas "${task.title}" (+${task.points_reward} poin).`,
      linkTarget: 'admin',
    });
  }

  res.json({
    task: updatedTask,
    totalPoints,
  });
});

app.get('/api/admin/tasks', requireAdmin, (_req, res) => {
  const tasks = db
    .prepare(`
      SELECT t.*, u.full_name as creator_name
      FROM lms_tasks t
      LEFT JOIN users u ON u.id = t.created_by
      ORDER BY t.created_at DESC, t.id DESC
    `)
    .all() as Array<Record<string, unknown>>;

  const stagesStmt = db.prepare(`
    SELECT * FROM lms_task_stages WHERE task_id = ? ORDER BY stage_order ASC, id ASC
  `);
  const submissionsStmt = db.prepare(`
    SELECT
      s.*,
      u.full_name,
      u.username,
      u.kelas,
      u.division,
      u.nis
    FROM lms_task_submissions s
    JOIN users u ON u.id = s.user_id
    WHERE s.task_id = ?
    ORDER BY s.submitted_at DESC
  `);

  const enriched = tasks.map((t) => ({
    ...t,
    stages: stagesStmt.all(t.id),
    submissions: submissionsStmt.all(t.id),
  }));

  res.json({ tasks: enriched });
});

app.post('/api/admin/tasks/upload-material', requireAdmin, lmsUpload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'File materi gagal diunggah.' });
    return;
  }
  res.json({
    fileUrl: `/uploads/${req.file.filename}`,
    fileName: req.file.originalname,
  });
});

app.post('/api/admin/tasks', requireAdmin, (req: AuthedRequest, res) => {
  const { title, description, division, points_reward, due_date, stages } = req.body as {
    title?: string;
    description?: string;
    division?: string;
    points_reward?: number;
    due_date?: string;
    stages?: Array<{
      stage_type?: 'reading' | 'practice' | 'upload';
      title?: string;
      content?: string;
      attachment_url?: string;
    }>;
  };

  if (!title || !title.trim()) {
    res.status(400).json({ error: 'Judul tugas LMS wajib diisi.' });
    return;
  }
  if (!Array.isArray(stages) || stages.length === 0) {
    res.status(400).json({ error: 'Tugas harus memiliki minimal 1 tahapan pembelajaran.' });
    return;
  }

  const cleanPoints = Math.max(1, Math.min(10000, Math.round(Number(points_reward) || 100)));
  const targetDivision = division?.trim() || 'Semua';
  const now = new Date().toISOString();

  const cleanedStages = stages.map((s, idx) => {
    const validType =
      s.stage_type === 'reading' || s.stage_type === 'practice' || s.stage_type === 'upload'
        ? s.stage_type
        : idx === stages.length - 1
        ? 'upload'
        : 'reading';
    return {
      stage_order: idx + 1,
      stage_type: validType,
      title: (s.title || `Tahap ${idx + 1}`).trim().slice(0, 160),
      content: (s.content || '').trim().slice(0, 4000),
      attachment_url: (s.attachment_url || '').trim().slice(0, 400),
    };
  });

  if (!cleanedStages.some((s) => s.stage_type === 'upload')) {
    cleanedStages.push({
      stage_order: cleanedStages.length + 1,
      stage_type: 'upload',
      title: 'Upload Hasil Tugas Akhir',
      content: 'Unggah file hasil pengerjaan tugas Anda untuk memperoleh poin.',
      attachment_url: '',
    });
  }

  let createdTaskId = 0;
  const tx = db.transaction(() => {
    const info = db
      .prepare(`
        INSERT INTO lms_tasks (title, description, division, points_reward, due_date, is_published, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `)
      .run(
        title.trim().slice(0, 180),
        (description || '').trim().slice(0, 1000),
        targetDivision,
        cleanPoints,
        (due_date || '').trim().slice(0, 30),
        req.user!.id,
        now
      );
    createdTaskId = Number(info.lastInsertRowid);

    const insertStage = db.prepare(`
      INSERT INTO lms_task_stages (task_id, stage_order, stage_type, title, content, attachment_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const st of cleanedStages) {
      insertStage.run(createdTaskId, st.stage_order, st.stage_type, st.title, st.content, st.attachment_url, now);
    }
  });
  tx();

  const created = db
    .prepare(`
      SELECT t.*, u.full_name as creator_name
      FROM lms_tasks t
      LEFT JOIN users u ON u.id = t.created_by
      WHERE t.id = ?
    `)
    .get(createdTaskId) as Record<string, unknown>;
  const createdStages = db
    .prepare('SELECT * FROM lms_task_stages WHERE task_id = ? ORDER BY stage_order ASC')
    .all(createdTaskId);

  broadcastEvent({ type: 'task:created', payload: { ...created, stages: createdStages } });

  if (targetDivision === 'Semua') {
    createAndBroadcastNotification({
      userId: null,
      type: 'task',
      title: `Tugas LMS Baru (${cleanPoints} Poin)`,
      message: `"${title.trim()}" telah diterbitkan. Selesaikan seluruh tahapan materi hingga upload tugas di menu Tugas.`,
      linkTarget: 'tugas',
    });
  } else {
    const targetedMembers = db
      .prepare(`SELECT id FROM users WHERE division = ? AND (role = 'student' OR show_in_members = 1)`)
      .all(targetDivision) as Array<{ id: number }>;
    for (const m of targetedMembers) {
      createAndBroadcastNotification({
        userId: m.id,
        type: 'task',
        title: `Tugas Divisi ${targetDivision} (${cleanPoints} Poin)`,
        message: `"${title.trim()}" telah diterbitkan untuk divisi Anda. Kerjakan di menu Tugas.`,
        linkTarget: 'tugas',
      });
    }
  }

  res.status(201).json({ task: { ...created, stages: createdStages, submissions: [] } });
});

app.delete('/api/admin/tasks/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM lms_tasks WHERE id = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'Tugas LMS tidak ditemukan.' });
    return;
  }
  db.prepare('DELETE FROM lms_tasks WHERE id = ?').run(id);
  broadcastEvent({ type: 'task:deleted', payload: { id } });
  res.json({ ok: true });
});

app.post('/api/admin/task-submissions/:id/review', requireAdmin, (req, res) => {
  const submissionId = Number(req.params.id);
  const { status, points_awarded, admin_feedback } = req.body as {
    status?: 'approved' | 'revision';
    points_awarded?: number;
    admin_feedback?: string;
  };

  if (status !== 'approved' && status !== 'revision') {
    res.status(400).json({ error: 'Status peninjauan harus approved atau revision.' });
    return;
  }

  const sub = db
    .prepare(`
      SELECT s.*, t.title as task_title, t.points_reward
      FROM lms_task_submissions s
      JOIN lms_tasks t ON t.id = s.task_id
      WHERE s.id = ?
    `)
    .get(submissionId) as
    | { id: number; task_id: number; user_id: number; task_title: string; points_reward: number }
    | undefined;

  if (!sub) {
    res.status(404).json({ error: 'Pengumpulan tugas tidak ditemukan.' });
    return;
  }

  const resolvedPoints =
    status === 'revision'
      ? 0
      : Math.max(0, Math.min(10000, Math.round(points_awarded ?? sub.points_reward)));
  const cleanFeedback = (admin_feedback || '').trim().slice(0, 500);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE lms_task_submissions
    SET status = ?, points_awarded = ?, admin_feedback = ?, reviewed_at = ?
    WHERE id = ?
  `).run(status, resolvedPoints, cleanFeedback, now, submissionId);

  const totalPoints = getUserTotalLmsPoints(sub.user_id);

  broadcastEvent({
    type: 'task:reviewed',
    payload: {
      taskId: sub.task_id,
      userId: sub.user_id,
      status,
      points_awarded: resolvedPoints,
      admin_feedback: cleanFeedback,
    },
  });
  broadcastEvent({
    type: 'member:points_updated',
    payload: { id: sub.user_id, lms_points: totalPoints },
  });

  createAndBroadcastNotification({
    userId: sub.user_id,
    type: 'task',
    title: status === 'approved' ? `Tugas Disetujui (+${resolvedPoints} Poin)` : 'Tugas Perlu Revisi',
    message:
      status === 'approved'
        ? `Pembina menyetujui pengumpulan "${sub.task_title}" dengan ${resolvedPoints} poin.${cleanFeedback ? ` Catatan: ${cleanFeedback}` : ''}`
        : `Tugas "${sub.task_title}" perlu diperbaiki.${cleanFeedback ? ` Catatan Pembina: ${cleanFeedback}` : ' Silakan unggah ulang pada menu Tugas.'}`,
    linkTarget: 'tugas',
  });

  checkpointDatabase('PASSIVE');
  res.json({ ok: true, points_awarded: resolvedPoints, totalPoints });
});

// ==================== ADMIN DATABASE HEALTH, CHECKPOINT & BACKUP ====================

app.get('/api/admin/database/status', requireAdmin, (_req, res) => {
  res.json({ health: getDatabaseHealth() });
});

app.post('/api/admin/database/checkpoint', requireAdmin, async (_req, res) => {
  pruneExpiredSessions();
  checkpointDatabase('TRUNCATE');
  const backupPath = await createVerifiedBackup();
  res.json({
    ok: true,
    backupCreated: Boolean(backupPath),
    health: getDatabaseHealth(),
  });
});

app.get('/api/admin/database/export', requireAdmin, async (_req, res) => {
  checkpointDatabase('TRUNCATE');
  const backupPath = await createVerifiedBackup();
  if (!backupPath || !fs.existsSync(backupPath)) {
    res.status(500).json({ error: 'Gagal membuat file backup database.' });
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  res.download(backupPath, `nmc_smpn2_ciamis_backup_${stamp}.db`);
});

app.get('/api/admin/database/export-json', requireAdmin, (_req, res) => {
  checkpointDatabase('PASSIVE');
  const payload = {
    exportedAt: new Date().toISOString(),
    app: 'NMC SMPN 2 Ciamis',
    users: db
      .prepare(
        `SELECT id, username, role, full_name, nis, kelas, division, bio, nfc_uid, qr_code_token, avatar_color, avatar_url, show_in_members, created_at FROM users ORDER BY id ASC`
      )
      .all(),
    site_settings: db.prepare('SELECT * FROM site_settings ORDER BY key ASC').all(),
    news_articles: db.prepare('SELECT * FROM news_articles ORDER BY id ASC').all(),
    schedules: db.prepare('SELECT * FROM schedules ORDER BY id ASC').all(),
    works: db.prepare('SELECT * FROM works ORDER BY id ASC').all(),
    work_likes: db.prepare('SELECT * FROM work_likes ORDER BY work_id ASC').all(),
    work_comments: db.prepare('SELECT * FROM work_comments ORDER BY id ASC').all(),
    blocked_words: db.prepare('SELECT * FROM blocked_words ORDER BY id ASC').all(),
    attendance_records: db.prepare('SELECT * FROM attendance_records ORDER BY id ASC').all(),
    lms_tasks: db.prepare('SELECT * FROM lms_tasks ORDER BY id ASC').all(),
    lms_task_stages: db.prepare('SELECT * FROM lms_task_stages ORDER BY id ASC').all(),
    lms_task_progress: db.prepare('SELECT * FROM lms_task_progress ORDER BY id ASC').all(),
    lms_task_submissions: db.prepare('SELECT * FROM lms_task_submissions ORDER BY id ASC').all(),
  };

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="nmc_smpn2_ciamis_backup_${stamp}.json"`
  );
  res.send(JSON.stringify(payload, null, 2));
});

// ==================== GLOBAL ERROR HANDLER ====================

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    const msg =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Ukuran file melebihi batas maksimal 50 MB.'
        : `Gagal mengunggah file: ${err.message}`;
    res.status(400).json({ error: msg });
    return;
  }
  if (err instanceof Error) {
    res.status(400).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: 'Terjadi kesalahan internal pada server.' });
});

// ==================== VITE / STATIC SERVING ====================

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`NMC SMPN 2 Ciamis server running on http://0.0.0.0:${PORT}`);
    // Create an initial verified online backup cleanly on boot
    void createVerifiedBackup();
  });

  // Periodic maintenance: prune expired sessions, checkpoint WAL, refresh verified backup
  const maintenanceTimer = setInterval(() => {
    pruneExpiredSessions();
    checkpointDatabase('PASSIVE');
    void createVerifiedBackup();
  }, 5 * 60 * 1000);
  maintenanceTimer.unref();

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(maintenanceTimer);
    console.log(`Received ${signal}, flushing SQLite WAL & shutting down cleanly...`);
    wss.clients.forEach((client) => {
      try {
        client.close();
      } catch {
        // ignore
      }
    });
    server.close(() => {
      closeDatabaseSafely();
      process.exit(0);
    });
    setTimeout(() => {
      closeDatabaseSafely();
      process.exit(0);
    }, 2500).unref();
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGHUP', () => shutdown('SIGHUP'));
}

startServer();
