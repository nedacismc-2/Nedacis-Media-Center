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
      status TEXT NOT NULL CHECK(status IN ('Hadir', 'Terlambat', 'Izin')),
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
    ensureSampleLmsTasks();
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
        'Modul pengantar wajib bagi anggota Multimedia Media Center sebelum turun meliput kegiatan resmi SMPN 2 Ciamis.',
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
      'Setiap anggota MMC membawa nama baik SMP Negeri 2 Ciamis saat bertugas:\n\n1. Selalu meminta izin dengan sopan sebelum merekam wawancara guru, tamu sekolah, maupun peserta didik lain.\n2. Hindari mengambil atau mempublikasikan foto yang merendahkan martabat subjek.\n3. Catat nama lengkap, kelas/jabatan narasumber, serta waktu kegiatan dengan tepat agar keterangan foto (caption) akurat.',
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
      bio: 'Pembina Ekstrakurikuler Multimedia Media Center (MMC) bidang produksi video, sinematografi, dan fotografi dokumentasi sekolah.',
      nfc_uid: '04PEMBINA01',
      qr_code_token: 'MMC-PEMBINA-01',
      avatar_color: '#B91C1C',
    },
    {
      username: 'pembina2',
      full_name: 'Rina Marlina, S.Pd.',
      nis: 'NIP-19860922',
      kelas: 'Pembina',
      division: 'Jurnalistik',
      bio: 'Pembina Ekstrakurikuler Multimedia Media Center (MMC) bidang jurnalistik pelajar, desain grafis, dan penyiaran radio sekolah.',
      nfc_uid: '04PEMBINA02',
      qr_code_token: 'MMC-PEMBINA-02',
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

function seedInitialData() {
  const now = new Date().toISOString();
  const adminHash = hashPassword('adminmmc');
  const studentHash = hashPassword('siswa123');

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
    'Pembina Ekstrakurikuler Multimedia Media Center (MMC) SMPN 2 Ciamis sekaligus koordinator dokumentasi dan jurnalistik sekolah.',
    '04ADMIN000',
    'MMC-PEMBINA-000',
    '#0F172A',
    now
  );

  // 20 Registered Students
  const studentsSeed = [
    ['ahmad.fauzan', 'Ahmad Fauzan Pratama', '242507001', '9A', 'Videografi', 'Ketua MMC periode 2026/2027. Fokus pada sinematografi dokumenter kegiatan sekolah.', '#1D4ED8'],
    ['siti.nurhaliza', 'Siti Nurhaliza Putri', '242507002', '9B', 'Fotografi', 'Fotografer utama liputan upacara, P5, dan dokumentasi prestasi siswa SMPN 2 Ciamis.', '#0F766E'],
    ['rizky.ramadhan', 'Rizky Ramadhan', '242507003', '9A', 'Jurnalistik', 'Pemimpin redaksi buletin digital sekolah dan penulis artikel berita mingguan.', '#B45309'],
    ['alya.azzahra', 'Alya Azzahra Dewi', '242507004', '9C', 'Desain Grafis', 'Desainer poster acara sekolah, majalah dinding digital, dan identitas visual MMC.', '#BE123C'],
    ['dimas.saputra', 'Dimas Aditya Saputra', '242507005', '8A', 'Penyiaran', 'Penyiar podcast suara siswa dan operator audio studio MMC SMPN 2 Ciamis.', '#4338CA'],
    ['nadia.khairunnisa', 'Nadia Khairunnisa', '242507006', '8B', 'Fotografi', 'Menyukai fotografi arsitektur sekolah dan potret candid kegiatan ekstrakurikuler.', '#0369A1'],
    ['fajar.nugraha', 'Fajar Nugraha', '242507007', '8C', 'Videografi', 'Editor video rekap acara sekolah dan motion graphic pengumuman resmi.', '#047857'],
    ['putri.ramadhani', 'Putri Rahma Ramadhani', '242507008', '8A', 'Jurnalistik', 'Reporter lapangan untuk liputan lomba OSN, O2SN, dan FLS2N tingkat kabupaten.', '#7C2D12'],
    ['bima.pangestu', 'Bima Satria Pangestu', '242507009', '8D', 'Desain Grafis', 'Ilustrator infografis edukasi dan layout buletin bulanan Nedacis.', '#1E40AF'],
    ['keisha.amelia', 'Keisha Amelia Putri', '242507010', '9D', 'Penyiaran', 'Host program wawancara guru inspiratif dan podcaster edisi literasi.', '#9F1239'],
    ['rehan.maulana', 'Rehan Maulana', '242507011', '7A', 'Fotografi', 'Anggota muda divisi fotografi dengan minat foto alam dan lingkungan hijau sekolah.', '#0D9488'],
    ['zahra.maulida', 'Zahra Maulida', '242507012', '7B', 'Jurnalistik', 'Penulis berita kegiatan kepramukaan dan dokumentasi hari besar nasional.', '#C2410C'],
    ['ilham.hidayat', 'Ilham Taufiq Hidayat', '242507013', '7C', 'Videografi', 'Kameramen lapangan untuk dokumentasi pertandingan olahraga antar kelas.', '#1D4ED8'],
    ['salma.fitriani', 'Salma Fitriani', '242507014', '8E', 'Desain Grafis', 'Pengolah tipografi dan template konten media sosial resmi SMPN 2 Ciamis.', '#6D28D9'],
    ['galih.permana', 'Galih Permana', '242507015', '9B', 'Penyiaran', 'Teknisi tata suara dan perekaman suara untuk produksi video profil sekolah.', '#334155'],
    ['tiara.anggraini', 'Tiara Anggraini', '242507016', '7D', 'Fotografi', 'Spesialis foto detail pameran karya siswa dan dokumentasi laboratorium.', '#0E7490'],
    ['rafi.akbar', 'Rafi Akbar Wijaya', '242507017', '8B', 'Videografi', 'Pengarah gaya dan kameramen proyek film pendek edukasi anti-perundungan.', '#15803D'],
    ['citra.lestari', 'Citra Ayu Lestari', '242507018', '7A', 'Jurnalistik', 'Pewawancara tamu sekolah dan penyusun catatan liputan kegiatan OSIS.', '#B91C1C'],
    ['bayu.krisna', 'Bayu Krisna Murti', '242507019', '9C', 'Desain Grafis', 'Desainer kartu pelajar digital dan materi publikasi penerimaan anggota baru.', '#1E3A8A'],
    ['intan.permata', 'Intan Permata Sari', '242507020', '8C', 'Penyiaran', 'Moderator diskusi panel siswa dan pembaca berita pagi radio sekolah.', '#86198F'],
  ] as const;

  const studentIds: number[] = [];
  studentsSeed.forEach((s, idx) => {
    const num = String(idx + 1).padStart(2, '0');
    const nfcUid = `04E2A100${num}`;
    const qrToken = `MMC-CMS-0${num}`;
    const info = insertUser.run(
      s[0],
      studentHash,
      'student',
      s[1],
      s[2],
      s[3],
      s[4],
      s[5],
      nfcUid,
      qrToken,
      s[6],
      now
    );
    studentIds.push(Number(info.lastInsertRowid));
  });

  // Seed news articles
  const insertArticle = db.prepare(`
    INSERT INTO news_articles (title, slug, category, summary, content, image_url, author_name, published_at, is_featured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertArticle.run(
    'Tim Liputan MMC Dokumentasikan Gebyar Pentas Seni & Budaya Sunda SMPN 2 Ciamis',
    'gebyar-pentas-seni-budaya-sunda-2026',
    'Liputan Sekolah',
    'Sebanyak 12 anggota aktif MMC turun langsung meliput jalannya Gebyar Pentas Seni dan Budaya Jawa Barat di lapangan utama sekolah dengan format multi-kamera.',
    `Lapangan utama SMPN 2 Ciamis dipadati ratusan siswa, guru, dan orang tua pada gelaran Gebyar Pentas Seni & Budaya Sunda tahun ajaran 2026/2027. Tim Multimedia Media Center (MMC) menurunkan personel gabungan dari divisi Fotografi, Videografi, dan Jurnalistik untuk memastikan setiap momen penting terdokumentasi secara profesional.\n\nDengan pembagian tiga titik kamera—panggung utama, area belakang panggung, dan sudut penonton—para siswa belajar menerapkan teknik pencahayaan alami pagi hari serta wawancara langsung bersama para penampil tari tradisional dan angklung.\n\nSeluruh hasil dokumentasi diolah di ruang studio MMC menggunakan alur penyuntingan kolaboratif sebelum dipublikasikan pada arsip berita resmi sekolah dan kanal informasi orang tua.`,
    'asset:news_liputan',
    'Rizky Ramadhan (9A)',
    '2026-11-12',
    1
  );

  insertArticle.run(
    'Podcast Suara Nedacis Episode 14: Mengulas Literasi Digital & Etika Bermedia',
    'podcast-suara-nedacis-literasi-digital',
    'Siaran',
    'Divisi Penyiaran MMC memproduksi episode terbaru Podcast Suara Nedacis bersama pembina OSIS membahas ruang diskusi sehat bagi pelajar.',
    `Ruang akustik Multimedia Media Center kembali beroperasi penuh untuk perekaman Podcast Suara Nedacis Episode 14. Kali ini, Dimas Aditya Saputra (8A) dan Keisha Amelia Putri (9D) memandu diskusi interaktif mengenai etika berkomentar di ruang digital dan cara memverifikasi informasi berita sekolah.\n\nProduksi episode ini memanfaatkan dua mikrofon kondensor studio dan pengolah audio multi-jalur sehingga menghasilkan kualitas suara jernih tanpa kebisingan latar.`,
    'asset:news_podcast',
    'Keisha Amelia Putri (9D)',
    '2026-11-09',
    0
  );

  insertArticle.run(
    'Workshop Penyuntingan Video Dokumenter & Color Grading Dasar bagi Anggota Kelas 7',
    'workshop-penyuntingan-video-dokumenter',
    'Workshop',
    'Anggota senior MMC membimbing siswa kelas 7 menyusun alur cerita dokumenter pendek mulai dari pemilahan klip hingga penyelarasan warna.',
    `Sebagai bagian dari pembinaan kaderisasi, divisi Videografi menyelenggarakan sesi praktik langsung penyuntingan video dokumenter di laboratorium multimedia sekolah. Sebanyak tujuh anggota baru dari kelas 7 mempelajari struktur narasi tiga babak, pemilihan musik latar bebas lisensi, serta teknik color grading dasar agar rekaman lapangan terlihat seragam.\n\nHasil karya latihan peserta langsung diunggah ke portal galeri MMC untuk mendapatkan umpan balik konstruktif dari sesama anggota dan pembina.`,
    'asset:work_editing',
    'Ahmad Fauzan Pratama (9A)',
    '2026-11-05',
    0
  );

  insertArticle.run(
    'Studio Produksi MMC Resmi Mengadopsi Sistem Absensi Kartu Pelajar NFC & QR Code',
    'adopsi-sistem-absensi-nfc-dan-qr-code',
    'Prestasi',
    'Transformasi tata kelola ekstrakurikuler SMPN 2 Ciamis melalui integrasi USB reader NFC/RFID dan QR Code profil siswa secara real-time.',
    `Mulai bulan November ini, setiap pertemuan rutin ekstrakurikuler MMC SMPN 2 Ciamis menggunakan pencatatan kehadiran terintegrasi berbasis kartu pelajar NFC/RFID dan pemindaian QR Code profil anggota.\n\nSiswa cukup menempelkan kartu pelajar pada USB reader di meja studio, dan catatan kehadiran langsung tampil transparan di profil masing-masing serta terekap otomatis dalam laporan bulanan pembina.`,
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
    'Lapangan Utama & Studio MMC',
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
    'Ruang Akustik Siaran MMC',
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

  // Seed initial works
  const insertWork = db.prepare(`
    INSERT INTO works (user_id, title, description, category, media_type, media_url, shares_count, comments_disabled, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const w1 = Number(insertWork.run(
    studentIds[1],
    'Sudut Pagi Lembah Ciamis dalam Bingkai Dokumenter',
    'Eksperimen fotografi lanskap pagi hari dengan teknik pencahayaan alami untuk proyek dokumenter lingkungan Jawa Barat.',
    'Fotografi',
    'image',
    'asset:work_ciamis',
    5,
    0,
    '2026-11-13T08:30:00.000Z'
  ).lastInsertRowid);

  const w2 = Number(insertWork.run(
    studentIds[0],
    'Di Balik Layar Penyuntingan Film Pendek Anti-Perundungan',
    'Proses color grading dan penyusunan linimasa audio untuk film pendek edukasi yang diproduksi oleh tim kelas 8 dan 9.',
    'Videografi',
    'image',
    'asset:work_editing',
    3,
    0,
    '2026-11-12T14:15:00.000Z'
  ).lastInsertRowid);

  const w3 = Number(insertWork.run(
    studentIds[2],
    'Arsip Foto Liputan Pentas Seni & Tari Tradisional',
    'Kumpulan bidikan monokromatik ekspresi penampil dan tim fotografer siswa saat acara Pentas Seni sekolah.',
    'Liputan',
    'image',
    'asset:news_liputan',
    7,
    0,
    '2026-11-11T10:00:00.000Z'
  ).lastInsertRowid);

  const w4 = Number(insertWork.run(
    studentIds[4],
    'Sesi Perekaman Podcast Suara Nedacis — Ruang Siaran',
    'Dokumentasi persiapan audio interface dan mikrofon studio sebelum siaran episode literasi digital dimulai.',
    'Desain Grafis',
    'image',
    'asset:news_podcast',
    2,
    0,
    '2026-11-10T11:45:00.000Z'
  ).lastInsertRowid);

  const w5 = Number(insertWork.run(
    studentIds[6],
    'Kolaborasi Tim Kamera Studio Produksi MMC',
    'Pengujian fokus lensa dan pemantauan monitor lapangan oleh tim produksi utama sebelum siaran langsung upacara.',
    'Videografi',
    'image',
    'asset:hero_studio',
    4,
    0,
    '2026-11-08T09:20:00.000Z'
  ).lastInsertRowid);

  // Seed likes & positive comments
  const insertLike = db.prepare('INSERT OR IGNORE INTO work_likes (work_id, user_id, created_at) VALUES (?, ?, ?)');
  [studentIds[0], studentIds[2], studentIds[3], studentIds[4], studentIds[5]].forEach(uid => insertLike.run(w1, uid, now));
  [studentIds[1], studentIds[3], studentIds[6]].forEach(uid => insertLike.run(w2, uid, now));
  [studentIds[0], studentIds[1], studentIds[7], studentIds[9]].forEach(uid => insertLike.run(w3, uid, now));
  [studentIds[0], studentIds[9]].forEach(uid => insertLike.run(w4, uid, now));
  [studentIds[1], studentIds[4], studentIds[12]].forEach(uid => insertLike.run(w5, uid, now));

  const insertComment = db.prepare(`
    INSERT INTO work_comments (work_id, user_id, content, is_hidden, flagged_reason, created_at)
    VALUES (?, ?, ?, 0, NULL, ?)
  `);
  insertComment.run(w1, studentIds[0], 'Komposisi kabut dan teraseringnya sangat rapi, pencahayaannya seimbang sekali!', '2026-11-13T09:10:00.000Z');
  insertComment.run(w1, studentIds[2], 'Cocok sekali untuk sampul majalah literasi sekolah edisi akhir semester.', '2026-11-13T10:05:00.000Z');
  insertComment.run(w2, studentIds[6], 'Pengaturan warna di monitor sudah konsisten, semangat tim editing!', '2026-11-12T15:30:00.000Z');
  insertComment.run(w3, studentIds[7], 'Foto hitam-putihnya kuat menangkap momen fokus para fotografer di lapangan.', '2026-11-11T13:20:00.000Z');

  // Seed negative word filter list
  const insertWord = db.prepare('INSERT OR IGNORE INTO blocked_words (word) VALUES (?)');
  ['bodoh', 'goblok', 'anjing', 'bego', 'jelek banget', 'tolol', 'sampah', 'norak', 'idiot', 'cacat', 'banci', 'kasar'].forEach(w => insertWord.run(w));

  // Seed realistic November 2026 attendance records across the 20 students
  const insertAtt = db.prepare(`
    INSERT OR IGNORE INTO attendance_records (user_id, attendance_date, check_in_time, method, status, session_title, recorded_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const pastDates = [
    { date: '2026-11-02', session: 'Sosialisasi Sistem NFC & QR MMC' },
    { date: '2026-11-05', session: 'Workshop Penyuntingan Video Dokumenter' },
    { date: '2026-11-09', session: 'Produksi Podcast Suara Nedacis' },
    { date: '2026-11-12', session: 'Liputan Gebyar Pentas Seni & Budaya' },
  ];

  studentIds.forEach((uid, idx) => {
    pastDates.forEach((sess, dIdx) => {
      // Deterministic realistic attendance pattern so monthly report shows varied data
      if ((idx + dIdx) % 9 === 0) return; // occasional absent
      const isLate = (idx + dIdx) % 7 === 0;
      const isIzin = (idx + dIdx) % 11 === 0;
      const status = isIzin ? 'Izin' : isLate ? 'Terlambat' : 'Hadir';
      const method = isIzin ? 'Manual Admin' : idx % 3 === 0 ? 'QR Scan' : 'NFC/RFID';
      const minute = isLate ? String(16 + (idx % 12)).padStart(2, '0') : String(50 + (idx % 9)).padStart(2, '0');
      const hour = isLate ? '15' : '14';
      const time = `${hour}:${minute}:${String((idx * 7) % 59).padStart(2, '0')}`;
      insertAtt.run(uid, sess.date, time, method, status, sess.session, 'Pembina MMC', `${sess.date}T${time}.000Z`);
    });
  });

  // Seed initial notifications
  const insertNotif = db.prepare(`
    INSERT INTO notifications (user_id, type, title, message, link_target, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `);
  insertNotif.run(
    null,
    'schedule',
    'Pengingat Jadwal: Praktik Lapangan Fotografi Jurnalistik',
    'Kegiatan dilaksanakan Senin, 16 November 2026 pukul 15:00 WIB di Lapangan Utama & Studio MMC. Harap membawa kartu pelajar NFC untuk absensi.',
    'jadwal',
    now
  );
  insertNotif.run(
    studentIds[1],
    'like',
    'Karya Anda Mendapat Apresiasi',
    '5 anggota menyukai karya "Sudut Pagi Lembah Ciamis dalam Bingkai Dokumenter".',
    'galeri',
    now
  );
}
