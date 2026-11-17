/**
 * Phase 0 Security Rules Verification Specification (Dirty Dozen TDD)
 * Run against Firebase Emulator Suite (`@firebase/rules-unit-testing`) when testing locally.
 */
export interface DirtyDozenCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  expected: 'PERMISSION_DENIED';
  payload?: Record<string, unknown>;
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Self-Admin Registration in /users/{uid}',
    collectionPath: 'users/student_1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { uid: 'student_1', email: 's@smpn2.sch.id', displayName: 'Student', role: 'admin' },
  },
  {
    id: 2,
    name: 'Admin Marker Forgery in /admins/{uid}',
    collectionPath: 'admins/student_1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { uid: 'student_1', email: 's@smpn2.sch.id', grantedBy: 'student_1' },
  },
  {
    id: 3,
    name: 'Unverified Admin Email Spoof on /site_settings/portal',
    collectionPath: 'site_settings/portal',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: { brandName: 'Hacked' },
  },
  {
    id: 4,
    name: 'PII Snooping on /members_private',
    collectionPath: 'members_private/student_2',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Pending Work Moderation Bypass',
    collectionPath: 'works/work_fake',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { authorUid: 'student_1', approvalStatus: 'approved', likesCount: 999 },
  },
  {
    id: 6,
    name: 'Ghost Field Shadow Update on /users/{uid}',
    collectionPath: 'users/student_1',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: { displayName: 'Student', isSuperAdmin: true },
  },
  {
    id: 7,
    name: 'Comment Author Impersonation',
    collectionPath: 'works/work_1/comments/c_1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { workId: 'work_1', authorUid: 'other_uid', content: 'Spoofed' },
  },
  {
    id: 8,
    name: 'LMS Submission Points & Approval Tampering',
    collectionPath: 'lms_task_submissions/sub_1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { taskId: 'task_1', userUid: 'student_1', status: 'approved', pointsAwarded: 500 },
  },
  {
    id: 9,
    name: 'Terminal State Overwrite on Approved LMS Submission',
    collectionPath: 'lms_task_submissions/sub_approved',
    operation: 'update',
    expected: 'PERMISSION_DENIED',
    payload: { fileUrl: 'https://example.com/new.pdf' },
  },
  {
    id: 10,
    name: 'ID Resource Poisoning (>128 chars or invalid chars)',
    collectionPath: 'works/invalid id with spaces!@#',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Client Timestamp Forgery on /works/{id}',
    collectionPath: 'works/work_time_spoof',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
    payload: { createdAt: '1999-01-01T00:00:00Z' },
  },
  {
    id: 12,
    name: 'Unauthorized Collection List on /attendance_records',
    collectionPath: 'attendance_records',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
  },
];
