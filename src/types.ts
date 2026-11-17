export type UserRole = 'admin' | 'student';

export type Division =
  | 'Fotografi'
  | 'Videografi'
  | 'Jurnalistik'
  | 'Desain Grafis'
  | 'Penyiaran';

export interface StudentProfile {
  id: number;
  firestoreId?: string;
  username: string;
  role: UserRole;
  full_name: string;
  nis: string;
  kelas: string;
  division: Division | string;
  bio: string;
  nfc_uid: string;
  qr_code_token: string;
  avatar_color: string;
  avatar_url?: string;
  show_in_members?: number;
  created_at: string;
  attendance_count?: number;
  works_count?: number;
  lms_points?: number;
}

export interface NewsArticle {
  id: number;
  firestoreId?: string;
  title: string;
  slug: string;
  category: string;
  summary: string;
  content: string;
  image_url: string;
  author_name: string;
  published_at: string;
  is_featured: number;
}

export interface ScheduleItem {
  id: number;
  firestoreId?: string;
  title: string;
  division: string;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string;
  description: string;
  mentor: string;
  reminder_sent: number;
}

export interface WorkComment {
  id: number;
  firestoreId?: string;
  work_id: number;
  user_id: number;
  author_name: string;
  author_username: string;
  author_kelas: string;
  author_role: UserRole;
  content: string;
  is_hidden: number;
  flagged_reason: string | null;
  created_at: string;
}

export interface StudentWork {
  id: number;
  firestoreId?: string;
  authorUid?: string;
  user_id: number;
  author_name: string;
  author_username: string;
  author_kelas: string;
  author_division: string;
  author_avatar_color: string;
  author_avatar_url?: string;
  title: string;
  description: string;
  category: string;
  media_type: 'image' | 'video';
  media_url: string;
  shares_count: number;
  comments_disabled: number;
  approval_status?: 'pending' | 'approved' | 'rejected';
  review_note?: string;
  created_at: string;
  likes_count: number;
  comments_count: number;
  liked_by_me: boolean;
  comments?: WorkComment[];
}

export interface AttendanceRecord {
  id: number;
  firestoreId?: string;
  user_id: number;
  full_name: string;
  username: string;
  nis: string;
  kelas: string;
  division: string;
  nfc_uid: string;
  attendance_date: string;
  check_in_time: string;
  method: 'NFC/RFID' | 'QR Scan' | 'Manual Admin';
  status: 'Hadir' | 'Terlambat' | 'Izin';
  session_title: string;
  recorded_by: string;
  created_at: string;
}

export interface NotificationItem {
  id: number;
  firestoreId?: string;
  user_id: number | null;
  type: 'attendance' | 'schedule' | 'like' | 'comment' | 'share' | 'moderation' | 'task';
  title: string;
  message: string;
  link_target: string | null;
  is_read: number;
  created_at: string;
}

export interface MonthlyReportRow {
  user_id: number;
  full_name: string;
  username: string;
  nis: string;
  kelas: string;
  division: string;
  total_sessions: number;
  hadir_count: number;
  terlambat_count: number;
  izin_count: number;
  alpha_count: number;
  attendance_rate: number;
  last_method: string | null;
}

export type SocialPlatform = 'instagram' | 'tiktok' | 'youtube' | 'facebook' | 'x' | 'website' | 'custom';

export interface SocialLinkItem {
  id: string;
  platform: SocialPlatform;
  label: string;
  url: string;
  customIconUrl?: string;
}

export interface SiteBranding {
  brandName: string;
  logoUrl: string;
  heroEyebrow?: string;
  heroTitle?: string;
  heroDescription?: string;
  heroImageUrl?: string;
  footerAddress?: string;
  socialLinks?: SocialLinkItem[];
}

export type LmsStageType = 'reading' | 'practice' | 'upload';

export interface LmsTaskStage {
  id: number;
  firestoreId?: string;
  task_id: number;
  stage_order: number;
  stage_type: LmsStageType;
  title: string;
  content: string;
  attachment_url: string;
  created_at: string;
}

export interface LmsTaskProgress {
  stage_id: number;
  stageFirestoreId?: string;
  response_text: string;
  completed_at: string;
}

export interface LmsTaskSubmission {
  id: number;
  firestoreId?: string;
  userUid?: string;
  task_id: number;
  user_id: number;
  file_url: string;
  file_name: string;
  file_type: string;
  submission_note: string;
  status: 'submitted' | 'approved' | 'revision';
  points_awarded: number;
  admin_feedback: string;
  submitted_at: string;
  reviewed_at: string;
}

export interface LmsTask {
  id: number;
  firestoreId?: string;
  title: string;
  description: string;
  division: string;
  points_reward: number;
  due_date: string;
  is_published: number;
  created_by: number;
  creator_name?: string;
  created_at: string;
  stages: LmsTaskStage[];
  progress: LmsTaskProgress[];
  submission: LmsTaskSubmission | null;
}

export interface AdminLmsSubmission extends LmsTaskSubmission {
  full_name: string;
  username: string;
  kelas: string;
  division: string;
  nis: string;
}

export interface AdminLmsTask extends Omit<LmsTask, 'progress' | 'submission'> {
  submissions: AdminLmsSubmission[];
}

export type WSEvent =
  | { type: 'attendance:recorded'; payload: AttendanceRecord }
  | { type: 'notification:new'; payload: NotificationItem }
  | { type: 'work:created'; payload: StudentWork }
  | { type: 'work:deleted'; payload: { id: number } }
  | { type: 'work:updated'; payload: { id: number; likes_count?: number; shares_count?: number; comments_disabled?: number; comments_count?: number } }
  | { type: 'comment:created'; payload: WorkComment }
  | { type: 'comment:deleted'; payload: { id: number; work_id: number } }
  | { type: 'schedule:created'; payload: ScheduleItem }
  | { type: 'settings:updated'; payload: SiteBranding }
  | { type: 'member:updated'; payload: { id: number; avatar_url: string } }
  | { type: 'task:created'; payload: unknown }
  | { type: 'task:deleted'; payload: { id: number } }
  | { type: 'task:submitted'; payload: { taskId: number; userId: number } }
  | { type: 'task:reviewed'; payload: { taskId: number; userId: number; status: string; points_awarded: number; admin_feedback: string } }
  | { type: 'member:points_updated'; payload: { id: number; lms_points: number } };
