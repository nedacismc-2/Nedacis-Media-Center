import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

export const UPLOADS_DIR = path.join(PROJECT_ROOT, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export const DB_PATH = path.join(DATA_DIR, 'mmc_smpn2_ciamis.db');
export const LATEST_BACKUP_PATH = path.join(BACKUPS_DIR, 'mmc_backup_latest.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = FULL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');
db.pragma('temp_store = MEMORY');
db.pragma('wal_autocheckpoint = 100');

let isDbClosed = false;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(derived, 'hex'));
}

export function checkpointDatabase(mode: 'PASSIVE' | 'TRUNCATE' = 'PASSIVE') {
  if (isDbClosed) return;
  try {
    db.pragma(`wal_checkpoint(${mode})`);
  } catch (err) {
    console.error('SQLite WAL checkpoint warning:', err);
  }
}

export async function createVerifiedBackup(): Promise<string | null> {
  if (isDbClosed) return null;
  try {
    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }
    const tempPath = path.join(BACKUPS_DIR, `mmc_backup_tmp_${Date.now()}.db`);
    await db.backup(tempPath);
    fs.renameSync(tempPath, LATEST_BACKUP_PATH);
    return LATEST_BACKUP_PATH;
  } catch (err) {
    console.error('SQLite backup error:', err);
    return null;
  }
}

export function getDatabaseHealth() {
  const integrityRow = db.pragma('integrity_check', { simple: true }) as string;
  const journalMode = db.pragma('journal_mode', { simple: true }) as string;
  const synchronousMode = db.pragma('synchronous', { simple: true }) as number;

  const safeSize = (filePath: string) => {
    try {
      return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    } catch {
      return 0;
    }
  };

  let lastBackupAt: string | null = null;
  let lastBackupBytes = 0;
  try {
    if (fs.existsSync(LATEST_BACKUP_PATH)) {
      const stat = fs.statSync(LATEST_BACKUP_PATH);
      lastBackupAt = new Date(stat.mtimeMs).toISOString();
      lastBackupBytes = stat.size;
    }
  } catch {
    // ignore
  }

  const count = (table: string) =>
    Number((db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number }).cnt || 0);

  return {
    integrity: integrityRow,
    journalMode,
    synchronous: synchronousMode === 2 ? 'FULL' : synchronousMode === 1 ? 'NORMAL' : String(synchronousMode),
    dbBytes: safeSize(DB_PATH),
    walBytes: safeSize(`${DB_PATH}-wal`),
    shmBytes: safeSize(`${DB_PATH}-shm`),
    lastBackupAt,
    lastBackupBytes,
    counts: {
      users: count('users'),
      works: count('works'),
      attendance_records: count('attendance_records'),
      lms_tasks: count('lms_tasks'),
      lms_task_submissions: count('lms_task_submissions'),
      news_articles: count('news_articles'),
      schedules: count('schedules'),
      notifications: count('notifications'),
      site_settings: count('site_settings'),
    },
  };
}

export function pruneExpiredSessions() {
  if (isDbClosed) return;
  try {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
  } catch {
    // ignore
  }
}

export function closeDatabaseSafely() {
  if (isDbClosed) return;
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // ignore
  }
  try {
    db.close();
  } catch {
    // ignore
  } finally {
    isDbClosed = true;
  }
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'student')),
      full_name TEXT NOT NULL,
      nis TEXT NOT NULL,
      kelas TEXT NOT NULL,
      division TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      nfc_uid TEXT UNIQUE NOT NULL,
      qr_code_token TEXT UNIQUE NOT NULL,
      avatar_color TEXT NOT NULL DEFAULT '#1D4ED8',
      avatar_url TEXT NOT NULL DEFAULT '',
      show_in_members INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS news_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL,
      summary TEXT NOT NULL,
      content TEXT NOT NULL,
      image_url TEXT NOT NULL,
      author_name TEXT NOT NULL,
      published_at TEXT NOT NULL,
      is_featured INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      division TEXT NOT NULL,
      event_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      location TEXT NOT NULL,
      description TEXT NOT NULL,
      mentor TEXT NOT NULL,
      reminder_sent INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS works (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      media_type TEXT NOT NULL CHECK(media_type IN ('image', 'video')),
      media_url TEXT NOT NULL,
      shares_count INTEGER NOT NULL DEFAULT 0,
      comments_disabled INTEGER NOT NULL DEFAULT 0,
      approval_status TEXT NOT NULL DEFAULT 'approved' CHECK(approval_status IN ('pending', 'approved', 'rejected')),
      review_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_likes (
      work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (work_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS work_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      flagged_reason TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blocked_words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      attendance_date TEXT NOT NULL,
      check_in_time TEXT NOT NULL,
      method TEXT NOT NULL CHECK(method IN ('NFC/RFID', 'QR Scan', 'Manual Admin')),
      status TEXT NOT NULL CHECK(status IN ('Hadir', 'Terlambat', 'Izin', 'Tanpa Keterangan')),
      session_title TEXT NOT NULL,
      recorded_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, attendance_date)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link_target TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lms_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      division TEXT NOT NULL DEFAULT 'Semua',
      points_reward INTEGER NOT NULL DEFAULT 100,
      due_date TEXT NOT NULL DEFAULT '',
      is_published INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lms_task_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES lms_tasks(id) ON DELETE CASCADE,
      stage_order INTEGER NOT NULL,
      stage_type TEXT NOT NULL CHECK(stage_type IN ('reading', 'practice', 'upload')),
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      attachment_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lms_task_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES lms_tasks(id) ON DELETE CASCADE,
      stage_id INTEGER NOT NULL REFERENCES lms_task_stages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      response_text TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL,
      UNIQUE (stage_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS lms_task_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES lms_tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      file_url TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      file_type TEXT NOT NULL DEFAULT '',
      submission_note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted', 'approved', 'revision')),
      points_awarded INTEGER NOT NULL DEFAULT 0,
      admin_feedback TEXT NOT NULL DEFAULT '',
      submitted_at TEXT NOT NULL,
      reviewed_at TEXT NOT NULL DEFAULT '',
      UNIQUE (task_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_works_status_created ON works(approval_status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(attendance_date);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lms_progress_task_user ON lms_task_progress(task_id, user_id);
  `);

  // Safe migrations for existing SQLite databases
  const userCols = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
  if (!userCols.some((c) => c.name === 'avatar_url')) {
    db.exec(`ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''`);
  }
  if (!userCols.some((c) => c.name === 'show_in_members')) {
    db.exec(`ALTER TABLE users ADD COLUMN show_in_members INTEGER NOT NULL DEFAULT 0`);
  }
  if (!userCols.some((c) => c.name === 'parent_whatsapp')) {
    db.exec(`ALTER TABLE users ADD COLUMN parent_whatsapp TEXT NOT NULL DEFAULT ''`);
  }
  if (!userCols.some((c) => c.name === 'auth_hashes')) {
    db.exec(`ALTER TABLE users ADD COLUMN auth_hashes TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!userCols.some((c) => c.name === 'pending_cloud_sync')) {
    db.exec(`ALTER TABLE users ADD COLUMN pending_cloud_sync INTEGER NOT NULL DEFAULT 0`);
  }
  if (!userCols.some((c) => c.name === 'previous_username')) {
    db.exec(`ALTER TABLE users ADD COLUMN previous_username TEXT NOT NULL DEFAULT ''`);
  }
  if (!userCols.some((c) => c.name === 'updated_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_cloud_member_deletions (
      username TEXT PRIMARY KEY,
      firestore_id TEXT NOT NULL DEFAULT '',
      deleted_at TEXT NOT NULL
    );
  `);
  const attCols = db.prepare(`PRAGMA table_info(attendance_records)`).all() as Array<{ name: string }>;
  if (!attCols.some((c) => c.name === 'check_out_time')) {
    db.exec(`ALTER TABLE attendance_records ADD COLUMN check_out_time TEXT NOT NULL DEFAULT ''`);
  }
  if (!attCols.some((c) => c.name === 'check_out_method')) {
    db.exec(`ALTER TABLE attendance_records ADD COLUMN check_out_method TEXT NOT NULL DEFAULT ''`);
  }
  if (!attCols.some((c) => c.name === 'wa_notified_in')) {
    db.exec(`ALTER TABLE attendance_records ADD COLUMN wa_notified_in INTEGER NOT NULL DEFAULT 0`);
  }
  if (!attCols.some((c) => c.name === 'wa_notified_out')) {
    db.exec(`ALTER TABLE attendance_records ADD COLUMN wa_notified_out INTEGER NOT NULL DEFAULT 0`);
  }
  const attSchemaRow = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'attendance_records'`)
    .get() as { sql?: string } | undefined;
  if (attSchemaRow?.sql && !attSchemaRow.sql.includes('Tanpa Keterangan')) {
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(`
          ALTER TABLE attendance_records RENAME TO attendance_records_legacy_status;
          CREATE TABLE attendance_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            attendance_date TEXT NOT NULL,
            check_in_time TEXT NOT NULL,
            method TEXT NOT NULL CHECK(method IN ('NFC/RFID', 'QR Scan', 'Manual Admin')),
            status TEXT NOT NULL CHECK(status IN ('Hadir', 'Terlambat', 'Izin', 'Tanpa Keterangan')),
            session_title TEXT NOT NULL,
            recorded_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            check_out_time TEXT NOT NULL DEFAULT '',
            check_out_method TEXT NOT NULL DEFAULT '',
            wa_notified_in INTEGER NOT NULL DEFAULT 0,
            wa_notified_out INTEGER NOT NULL DEFAULT 0,
            UNIQUE (user_id, attendance_date)
          );
          INSERT INTO attendance_records (
            id, user_id, attendance_date, check_in_time, method, status,
            session_title, recorded_by, created_at,
            check_out_time, check_out_method, wa_notified_in, wa_notified_out
          )
          SELECT
            id, user_id, attendance_date, check_in_time, method, status,
            session_title, recorded_by, created_at,
            check_out_time, check_out_method, wa_notified_in, wa_notified_out
          FROM attendance_records_legacy_status;
          DROP TABLE attendance_records_legacy_status;
          CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(attendance_date);
        `);
      })();
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
  const workCols = db.prepare(`PRAGMA table_info(works)`).all() as Array<{ name: string }>;
  if (!workCols.some((c) => c.name === 'approval_status')) {
    db.exec(`ALTER TABLE works ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'`);
  }
  if (!workCols.some((c) => c.name === 'review_note')) {
    db.exec(`ALTER TABLE works ADD COLUMN review_note TEXT NOT NULL DEFAULT ''`);
  }

  const nowInit = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO site_settings (key, value, updated_at) VALUES ('brand_name', 'Multimedia', ?)`).run(nowInit);
    db.prepare(`INSERT OR IGNORE INTO site_settings (key, value, updated_at) VALUES ('brand_logo_url', '', ?)`).run(nowInit);
    db.prepare(`INSERT OR IGNORE INTO site_settings (key, value, updated_at) VALUES ('hero_eyebrow', 'SMP Negeri 2 Ciamis · Ekstrakurikuler Resmi', ?)`).run(nowInit);
    db.prepare(`INSERT OR IGNORE INTO site_settings (key, value, updated_at) VALUES ('hero_title', 'Nedacis Media Center: Ruang Berkarya & Jurnalisme Siswa SMPN 2 Ciamis', ?)`).run(nowInit);
    db.prepare(`INSERT OR IGNORE INTO site_settings (key, value, updated_at) VALUES ('hero_description', 'Wadah resmi siswa SMPN 2 Ciamis dalam bidang fotografi, videografi, penyiaran, desain grafis, dan jurnalistik sekolah—dilengkapi arsip karya digital serta sistem absensi kartu pelajar NFC/RFID dan QR Code secara real-time.', ?)`).run(nowInit);
    db.prepare(`INSERT OR IGNORE INTO site_settings (key, value, updated_at) VALUES ('hero_image_url', '', ?)`).run(nowInit);
    db.prepare(`INSERT OR IGNORE INTO site_settings (key, value, updated_at) VALUES ('footer_address', 'Jalan Jenderal Sudirman No. 241, Sindangrasa, Kec. Ciamis, Kabupaten Ciamis, Jawa Barat 46215', ?)`).run(nowInit);
    db.prepare(`INSERT OR IGNORE INTO site_settings (key, value, updated_at) VALUES ('social_links', ?, ?)`).run(
      JSON.stringify([
        { id: 'ig', platform: 'instagram', label: 'Instagram', url: 'https://instagram.com' },
        { id: 'tt', platform: 'tiktok', label: 'TikTok', url: 'https://tiktok.com' },
        { id: 'yt', platform: 'youtube', label: 'YouTube', url: 'https://youtube.com' },
      ]),
      nowInit
    );

    db.prepare(`UPDATE site_settings SET value = 'Multimedia', updated_at = ? WHERE key = 'brand_name' AND value = 'NMC SMPN 2 Ciamis'`).run(nowInit);
    db.prepare(`UPDATE site_settings SET value = 'Nedacis Media Center: Ruang Berkarya & Jurnalisme Siswa SMPN 2 Ciamis', updated_at = ? WHERE key = 'hero_title' AND value = 'Multimedia Media Center: Ruang Berkarya & Jurnalisme Pelajar'`).run(nowInit);
    db.prepare(`UPDATE site_settings SET value = 'Jalan Jenderal Sudirman No. 241, Sindangrasa, Kec. Ciamis, Kabupaten Ciamis, Jawa Barat 46215', updated_at = ? WHERE key = 'footer_address' AND value = 'Jalan Mr. Iwa Kusumasomantri, Kab. Ciamis, Jawa Barat'`).run(nowInit);

    const userCount = (db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }).cnt;
    if (userCount === 0) {
      seedInitialData();
    }

    ensurePembinaMemberAccounts();
    ensureDefaultStudentsRemoved(nowInit);
    ensureSampleLmsTasks();
    ensureNmcRebrandMigration(nowInit);
  })();

  pruneExpiredSessions();
  const quickCheck = db.pragma('quick_check', { simple: true });
  if (quickCheck !== 'ok') {
    console.error('SQLite quick_check warning:', quickCheck);
  }
  checkpointDatabase('PASSIVE');
}

function ensureSampleLmsTasks() {
  const seededFlag = db.prepare(`SELECT value FROM site_settings WHERE key = 'lms_seeded'`).get() as
    | { value: string }
    | undefined;
  if (seededFlag?.value === '1') return;

  const existingCount = (db.prepare('SELECT COUNT(*) as cnt FROM lms_tasks').get() as { cnt: number }).cnt;
  const adminRow = db.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`).get() as
    | { id: number }
    | undefined;

  if (existingCount === 0 && adminRow) {
    const now = new Date().toISOString();
    const insertTask = db.prepare(`
      INSERT INTO lms_tasks (title, description, division, points_reward, due_date, is_published, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `);
    const insertStage = db.prepare(`
      INSERT INTO lms_task_stages (task_id, stage_order, stage_type, title, content, attachment_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const t1 = Number(
      insertTask.run(
        'Dasar Komposisi Visual & Etika Liputan Sekolah',
        'Modul pengantar wajib bagi anggota Nedacis Media Center sebelum turun meliput kegiatan resmi SMPN 2 Ciamis.',
        'Semua',
        100,
        '2026-11-28',
        adminRow.id,
        now
      ).lastInsertRowid
    );

    insertStage.run(
      t1,
      1,
      'reading',
      'Membaca Materi: Komposisi Rule of Thirds & Angle Kamera',
      'Dalam dokumentasi kegiatan sekolah, pembingkaian (framing) menentukan kekuatan cerita visual.\n\n1. Rule of Thirds: Tempatkan subjek utama pada sepertiga kiri atau kanan bidang foto/video agar komposisi terasa seimbang dan dinamis.\n2. Eye-Level & Low Angle: Gunakan sudut sejajar mata untuk wawancara narasumber, dan sudut sedikit rendah saat memotret aksi panggung atau upacara.\n3. Headroom & Pencahayaan: Sisakan ruang wajar di atas kepala subjek dan hindari membelakangi sumber cahaya matahari langsung tanpa kompensasi eksposur.',
      '',
      now
    );
    insertStage.run(
      t1,
      2,
      'reading',
      'Membaca Materi: Etika Dokumentasi & Jurnalistik Pelajar',
      'Setiap anggota NMC membawa nama baik SMP Negeri 2 Ciamis saat bertugas:\n\n1. Selalu meminta izin dengan sopan sebelum merekam wawancara guru, tamu sekolah, maupun peserta didik lain.\n2. Hindari mengambil atau mempublikasikan foto yang merendahkan martabat subjek.\n3. Catat nama lengkap, kelas/jabatan narasumber, serta waktu kegiatan dengan tepat agar keterangan foto (caption) akurat.',
      '',
      now
    );
    insertStage.run(
      t1,
      3,
      'practice',
      'Refleksi Pemahaman Sebelum Praktik',
      'Tuliskan secara singkat (1–2 kalimat) poin penting komposisi atau etika liputan yang akan Anda terapkan saat mengambil gambar di lingkungan sekolah.',
      '',
      now
    );
    insertStage.run(
      t1,
      4,
      'upload',
      'Upload Hasil Praktik Foto / Video Pendek',
      'Ambil 1 foto atau video berdurasi singkat di area sekolah menggunakan prinsip Rule of Thirds, lalu unggah file hasil bidikan beserta keterangan lokasi dan teknik yang dipakai.',
      '',
      now
    );

    const t2 = Number(
      insertTask.run(
        'Menyusun Lead Berita 5W+1H & Publikasi Media Nedacis',
        'Pelatihan penulisan teras berita (lead) piramida terbalik serta pengunggahan draf naskah atau desain poster informasi sekolah.',
        'Semua',
        75,
        '2026-11-30',
        adminRow.id,
        now
      ).lastInsertRowid
    );

    insertStage.run(
      t2,
      1,
      'reading',
      'Membaca Materi: Struktur Piramida Terbalik & 5W+1H',
      'Berita kegiatan sekolah yang efektif langsung menjawab unsur Apa, Siapa, Kapan, Di mana, Mengapa, dan Bagaimana pada paragraf pertama.\n\nTips penulisan:\n- Gunakan kalimat aktif yang ringkas dan jelas.\n- Sertakan minimal satu kutipan langsung dari pembina, ketua panitia, atau siswa peserta kegiatan.\n- Pastikan ejaan nama orang dan gelar sesuai EYD terbaru.',
      '',
      now
    );
    insertStage.run(
      t2,
      2,
      'upload',
      'Upload Draf Naskah Berita atau Poster Informasi',
      'Unggah dokumen naskah (PDF/DOCX/TXT) atau file gambar desain poster pengumuman kegiatan sekolah hasil buatan Anda pada formulir di bawah ini.',
      '',
      now
    );
  }

  db.prepare(`INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('lms_seeded', '1', ?)`).run(
    new Date().toISOString()
  );
}

function ensurePembinaMemberAccounts() {
  const seededFlag = db.prepare(`SELECT value FROM site_settings WHERE key = 'pembina_seeded'`).get() as
    | { value: string }
    | undefined;
  if (seededFlag?.value === '1') return;

  const now = new Date().toISOString();
  const pembinaHash = hashPassword('pembina123');
  const pembinaAccounts = [
    {
      username: 'pembina1',
      full_name: 'Drs. Dedi Kurniawan, M.Pd.',
      nis: 'NIP-19780514',
      kelas: 'Pembina',
      division: 'Videografi',
      bio: 'Pembina Ekstrakurikuler Nedacis Media Center (NMC) bidang produksi video, sinematografi, dan fotografi dokumentasi sekolah.',
      nfc_uid: '04PEMBINA01',
      qr_code_token: 'NMC-PEMBINA-01',
      avatar_color: '#B91C1C',
    },
    {
      username: 'pembina2',
      full_name: 'Rina Marlina, S.Pd.',
      nis: 'NIP-19860922',
      kelas: 'Pembina',
      division: 'Jurnalistik',
      bio: 'Pembina Ekstrakurikuler Nedacis Media Center (NMC) bidang jurnalistik pelajar, desain grafis, dan penyiaran radio sekolah.',
      nfc_uid: '04PEMBINA02',
      qr_code_token: 'NMC-PEMBINA-02',
      avatar_color: '#1D4ED8',
    },
  ];

  const findStmt = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)');
  const insertStmt = db.prepare(`
    INSERT INTO users (username, password_hash, role, full_name, nis, kelas, division, bio, nfc_uid, qr_code_token, avatar_color, show_in_members, created_at)
    VALUES (?, ?, 'admin', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);

  for (const p of pembinaAccounts) {
    const exists = findStmt.get(p.username);
    if (!exists) {
      insertStmt.run(
        p.username,
        pembinaHash,
        p.full_name,
        p.nis,
        p.kelas,
        p.division,
        p.bio,
        p.nfc_uid,
        p.qr_code_token,
        p.avatar_color,
        now
      );
    } else {
      db.prepare(`UPDATE users SET show_in_members = 1 WHERE LOWER(username) = LOWER(?)`).run(p.username);
    }
  }

  db.prepare(`INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('pembina_seeded', '1', ?)`).run(now);
}

export const DEFAULT_SEED_STUDENT_USERNAMES = [
  'ahmad.fauzan',
  'siti.nurhaliza',
  'rizky.ramadhan',
  'alya.azzahra',
  'dimas.saputra',
  'nadia.khairunnisa',
  'fajar.nugraha',
  'putri.ramadhani',
  'bima.pangestu',
  'keisha.amelia',
  'rehan.maulana',
  'zahra.maulida',
  'ilham.hidayat',
  'salma.fitriani',
  'galih.permana',
  'tiara.anggraini',
  'rafi.akbar',
  'citra.lestari',
  'bayu.krisna',
  'intan.permata',
] as const;

function ensureDefaultStudentsRemoved(nowIso: string) {
  const cleanedFlag = db.prepare(`SELECT value FROM site_settings WHERE key = 'default_students_removed_v1'`).get() as
    | { value: string }
    | undefined;
  if (cleanedFlag?.value === '1') return;

  const placeholders = DEFAULT_SEED_STUDENT_USERNAMES.map(() => '?').join(', ');
  db.prepare(
    `DELETE FROM users WHERE role = 'student' AND LOWER(username) IN (${placeholders})`
  ).run(...DEFAULT_SEED_STUDENT_USERNAMES);

  db.prepare(
    `DELETE FROM notifications WHERE user_id IS NULL AND link_target = 'galeri' AND message LIKE '%Sudut Pagi Lembah Ciamis%'`
  ).run();

  db.prepare(
    `INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('default_students_removed_v1', '1', ?)`
  ).run(nowIso);
}

function seedInitialData() {
  const now = new Date().toISOString();
  const adminHash = hashPassword('adminmmc');

  const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, role, full_name, nis, kelas, division, bio, nfc_uid, qr_code_token, avatar_color, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 1 Admin / Pembina
  insertUser.run(
    'admin',
    adminHash,
    'admin',
    'Hendra Kusuma, S.Pd.',
    'NIP-19890412',
    'Pembina',
    'Penyiaran',
    'Pembina Ekstrakurikuler Nedacis Media Center (NMC) SMPN 2 Ciamis sekaligus koordinator dokumentasi dan jurnalistik sekolah.',
    '04ADMIN000',
    'NMC-PEMBINA-000',
    '#0F172A',
    now
  );

  // Seed news articles
  const insertArticle = db.prepare(`
    INSERT INTO news_articles (title, slug, category, summary, content, image_url, author_name, published_at, is_featured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertArticle.run(
    'Tim Liputan NMC Dokumentasikan Gebyar Pentas Seni & Budaya Sunda SMPN 2 Ciamis',
    'gebyar-pentas-seni-budaya-sunda-2026',
    'Liputan Sekolah',
    'Sebanyak 12 anggota aktif NMC turun langsung meliput jalannya Gebyar Pentas Seni dan Budaya Jawa Barat di lapangan utama sekolah dengan format multi-kamera.',
    `Lapangan utama SMPN 2 Ciamis dipadati ratusan siswa, guru, dan orang tua pada gelaran Gebyar Pentas Seni & Budaya Sunda tahun ajaran 2026/2027. Tim Nedacis Media Center (NMC) menurunkan personel gabungan dari divisi Fotografi, Videografi, dan Jurnalistik untuk memastikan setiap momen penting terdokumentasi secara profesional.\n\nDengan pembagian tiga titik kamera—panggung utama, area belakang panggung, dan sudut penonton—para siswa belajar menerapkan teknik pencahayaan alami pagi hari serta wawancara langsung bersama para penampil tari tradisional dan angklung.\n\nSeluruh hasil dokumentasi diolah di ruang studio NMC menggunakan alur penyuntingan kolaboratif sebelum dipublikasikan pada arsip berita resmi sekolah dan kanal informasi orang tua.`,
    'asset:news_liputan',
    'Rizky Ramadhan (9A)',
    '2026-11-12',
    1
  );

  insertArticle.run(
    'Podcast Suara Nedacis Episode 14: Mengulas Literasi Digital & Etika Bermedia',
    'podcast-suara-nedacis-literasi-digital',
    'Siaran',
    'Divisi Penyiaran NMC memproduksi episode terbaru Podcast Suara Nedacis bersama pembina OSIS membahas ruang diskusi sehat bagi pelajar.',
    `Ruang akustik Nedacis Media Center kembali beroperasi penuh untuk perekaman Podcast Suara Nedacis Episode 14. Kali ini, Dimas Aditya Saputra (8A) dan Keisha Amelia Putri (9D) memandu diskusi interaktif mengenai etika berkomentar di ruang digital dan cara memverifikasi informasi berita sekolah.\n\nProduksi episode ini memanfaatkan dua mikrofon kondensor studio dan pengolah audio multi-jalur sehingga menghasilkan kualitas suara jernih tanpa kebisingan latar.`,
    'asset:news_podcast',
    'Keisha Amelia Putri (9D)',
    '2026-11-09',
    0
  );

  insertArticle.run(
    'Workshop Penyuntingan Video Dokumenter & Color Grading Dasar bagi Anggota Kelas 7',
    'workshop-penyuntingan-video-dokumenter',
    'Workshop',
    'Anggota senior NMC membimbing siswa kelas 7 menyusun alur cerita dokumenter pendek mulai dari pemilahan klip hingga penyelarasan warna.',
    `Sebagai bagian dari pembinaan kaderisasi, divisi Videografi menyelenggarakan sesi praktik langsung penyuntingan video dokumenter di laboratorium multimedia sekolah. Sebanyak tujuh anggota baru dari kelas 7 mempelajari struktur narasi tiga babak, pemilihan musik latar bebas lisensi, serta teknik color grading dasar agar rekaman lapangan terlihat seragam.\n\nHasil karya latihan peserta langsung diunggah ke portal galeri NMC untuk mendapatkan umpan balik konstruktif dari sesama anggota dan pembina.`,
    'asset:work_editing',
    'Ahmad Fauzan Pratama (9A)',
    '2026-11-05',
    0
  );

  insertArticle.run(
    'Studio Produksi NMC Resmi Mengadopsi Sistem Absensi Kartu Pelajar NFC & QR Code',
    'adopsi-sistem-absensi-nfc-dan-qr-code',
    'Prestasi',
    'Transformasi tata kelola ekstrakurikuler SMPN 2 Ciamis melalui integrasi USB reader NFC/RFID dan QR Code profil siswa secara real-time.',
    `Mulai bulan November ini, setiap pertemuan rutin ekstrakurikuler NMC SMPN 2 Ciamis menggunakan pencatatan kehadiran terintegrasi berbasis kartu pelajar NFC/RFID dan pemindaian QR Code profil anggota.\n\nSiswa cukup menempelkan kartu pelajar pada USB reader di meja studio, dan catatan kehadiran langsung tampil transparan di profil masing-masing serta terekap otomatis dalam laporan bulanan pembina.`,
    'asset:hero_studio',
    'Hendra Kusuma, S.Pd.',
    '2026-11-02',
    0
  );

  // Seed schedules
  const insertSchedule = db.prepare(`
    INSERT INTO schedules (title, division, event_date, start_time, end_time, location, description, mentor, reminder_sent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertSchedule.run(
    'Praktik Lapangan Fotografi Jurnalistik & Liputan Upacara',
    'Fotografi',
    '2026-11-16',
    '15:00',
    '16:45',
    'Lapangan Utama & Studio NMC',
    'Pelatihan komposisi rule of thirds, kecepatan rana untuk momen bergerak, serta kurasi foto berita.',
    'Hendra Kusuma, S.Pd.',
    1
  );
  insertSchedule.run(
    'Produksi Video Profil Ekstrakurikuler SMPN 2 Ciamis',
    'Videografi',
    '2026-11-18',
    '15:00',
    '17:00',
    'Ruang Studio Multimedia Lt. 2',
    'Pengambilan gambar B-roll ruang kelas, wawancara narasumber, dan pencatatan shot list produksi.',
    'Ahmad Fauzan & Pembina',
    0
  );
  insertSchedule.run(
    'Rekaman Podcast Suara Nedacis Edisi Hari Guru',
    'Penyiaran',
    '2026-11-20',
    '14:30',
    '16:15',
    'Ruang Akustik Siaran NMC',
    'Persiapan naskah wawancara guru berprestasi, uji mikrofon kondensor, dan mixing audio siaran.',
    'Keisha Amelia & Pembina',
    0
  );
  insertSchedule.run(
    'Klinik Desain Poster Digital & Tata Letak Majalah Sekolah',
    'Desain Grafis',
    '2026-11-23',
    '15:00',
    '16:30',
    'Lab Komputer Timur',
    'Penerapan hierarki tipografi, grid editorial, dan ekspor materi publikasi cetak maupun media sosial.',
    'Alya Azzahra & Pembina',
    0
  );

  // Seed negative word filter list
  const insertWord = db.prepare('INSERT OR IGNORE INTO blocked_words (word) VALUES (?)');
  ['bodoh', 'goblok', 'anjing', 'bego', 'jelek banget', 'tolol', 'sampah', 'norak', 'idiot', 'cacat', 'banci', 'kasar'].forEach(w => insertWord.run(w));

  // Seed initial notifications
  const insertNotif = db.prepare(`
    INSERT INTO notifications (user_id, type, title, message, link_target, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `);
  insertNotif.run(
    null,
    'schedule',
    'Pengingat Jadwal: Praktik Lapangan Fotografi Jurnalistik',
    'Kegiatan dilaksanakan Senin, 16 November 2026 pukul 15:00 WIB di Lapangan Utama & Studio NMC. Harap membawa kartu pelajar NFC untuk absensi.',
    'jadwal',
    now
  );
}

function ensureNmcRebrandMigration(nowIso: string) {
  const migrated = db.prepare(`SELECT value FROM site_settings WHERE key = 'rebrand_nmc_v1'`).get() as
    | { value: string }
    | undefined;
  if (migrated?.value === '1') return;

  const replaceText = (sqlTable: string, col: string) => {
    db.prepare(
      `UPDATE ${sqlTable}
       SET ${col} = REPLACE(REPLACE(REPLACE(REPLACE(${col}, 'Multimedia Media Center (MMC)', 'Nedacis Media Center (NMC)'), 'Multimedia Media Center', 'Nedacis Media Center'), 'MMC-', 'NMC-'), 'MMC', 'NMC')
       WHERE ${col} LIKE '%MMC%' OR ${col} LIKE '%Multimedia Media Center%'`
    ).run();
  };

  replaceText('users', 'bio');
  replaceText('users', 'qr_code_token');
  replaceText('news_articles', 'title');
  replaceText('news_articles', 'summary');
  replaceText('news_articles', 'content');
  replaceText('news_articles', 'author_name');
  replaceText('schedules', 'title');
  replaceText('schedules', 'location');
  replaceText('schedules', 'description');
  replaceText('schedules', 'mentor');
  replaceText('works', 'title');
  replaceText('works', 'description');
  replaceText('lms_tasks', 'title');
  replaceText('lms_tasks', 'description');
  replaceText('lms_task_stages', 'title');
  replaceText('lms_task_stages', 'content');
  replaceText('attendance_records', 'session_title');
  replaceText('attendance_records', 'recorded_by');
  replaceText('notifications', 'title');
  replaceText('notifications', 'message');

  db.prepare(`INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES ('rebrand_nmc_v1', '1', ?)`).run(
    nowIso
  );
}
