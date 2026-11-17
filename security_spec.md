# Security Specification — MMC SMPN 2 Ciamis Firestore

## 1. Data Invariants
1. **Strict Admin Gate**: Only verified admins (`/admins/{uid}` or verified bootstrap email `NedacisMC@gmail.com`) may modify `/site_settings/*`, `/news_articles/*`, `/schedules/*`, `/members_public/*`, `/members_private/*`, `/attendance_records/*`, `/lms_tasks/*`, `/blocked_words/*`, or approve/reject `/works/*` and `/lms_task_submissions/*`.
2. **PII Isolation**: Private identifiers (`nis`, `nfcUid`, `email`, `ownerUid`) live strictly in `/members_private/{memberId}` and `/users/{userId}` and are unreadable by unauthenticated visitors or other students. Public member cards (`/members_public/{memberId}`) never store PII.
3. **Authorship & Identity Integrity**: On document creation, user-authored entities (`/works`, `/works/{workId}/comments`, `/works/{workId}/likes`, `/lms_task_progress`, `/lms_task_submissions`) MUST bind `authorUid`/`userUid == request.auth.uid` and require `request.auth.token.email_verified == true`.
4. **Anti-Self-Escalation**: Standard users creating or updating `/users/{userId}` cannot set `role: 'admin'` and cannot write to `/admins/{adminId}`.
5. **Moderation & Terminal State Locking**: Non-admin users creating a `/works` item must submit `approvalStatus == 'pending'` with zero counters (`likesCount == 0`, `commentsCount == 0`, `sharesCount == 0`). Non-admin users submitting `/lms_task_submissions` must submit `status == 'submitted'` with `pointsAwarded == 0`, and cannot modify a submission once `status == 'approved'`.
6. **Temporal Integrity & Immutability**: Creation timestamps equal `request.time`; update timestamps equal `request.time`; immutable owner/creation fields (`authorUid`, `userUid`, `createdAt`, `taskId`, `workId`) cannot be altered on update.
7. **Master Gate & Bounded Payloads**: Subcollections (`/works/{workId}/comments`, `/works/{workId}/likes`, `/lms_tasks/{taskId}/stages`) verify parent existence/status via `get()`/`exists()`, and every string/list/ID enforces strict size and regex bounds.

## 2. "Dirty Dozen" Attack Payloads (All Must Return PERMISSION_DENIED)
1. **Self-Admin Registration**: Signed-in student creates `/users/{uid}` with `role: "admin"`.
2. **Admin Marker Forgery**: Signed-in student writes `/admins/{uid}` directly.
3. **Unverified Email Spoofing**: Token has `email: "NedacisMC@gmail.com"` with `email_verified: false` attempting admin write to `/site_settings/portal`.
4. **PII Snooping (`members_private`)**: Student A reads `/members_private/student_b` or lists `/members_private`.
5. **Pending Work Bypass**: Student creates `/works/{id}` with `approvalStatus: "approved"` or `likesCount: 999`.
6. **Ghost Field Shadow Update**: Student updates `/users/{uid}` including unexpected field `isSuperAdmin: true`.
7. **Author Impersonation**: Student A creates a `/works/{id}/comments/{cid}` with `authorUid: "student_b"`.
8. **LMS Point Tampering**: Student creates or updates `/lms_task_submissions/{id}` setting `pointsAwarded: 500` or `status: "approved"`.
9. **Terminal State Overwrite**: Student modifies `/lms_task_submissions/{id}` after admin already marked `status: "approved"`.
10. **ID Resource Poisoning**: Client writes `/works/<200-char-invalid-id!@#>` violating `isValidId()`.
11. **Timestamp Forgery**: Student creates `/works/{id}` with backdated `createdAt` instead of `request.time`.
12. **Cross-Tenant List Scraping**: Unauthenticated visitor or non-owner runs `list` on `/attendance_records` or `/lms_task_submissions`.
