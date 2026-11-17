import { useEffect, useState, type FormEvent } from 'react';
import {
  Award,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Lock,
  PenLine,
  UploadCloud,
} from 'lucide-react';
import type { LmsTask, LmsTaskStage, StudentProfile } from '../types';
import { apiFetch, getStoredToken } from '../lib/api';
import { auth } from '../lib/firebase';
import { uploadFileToCloud } from '../lib/cloudFiles';
import { useFirebase } from '../context/FirebaseContext';
import { completeLmsStageInFirestore, submitLmsTaskInFirestore } from '../lib/firestoreSync';
import { formatDateID } from '../lib/mediaAssets';
import { CloudFileAttachment } from './CloudMedia';

interface LmsTasksSectionProps {
  currentUser: StudentProfile;
  tasks: LmsTask[];
  initialSelectedTaskId?: number | null;
  onTaskUpdated: (task: LmsTask, newTotalPoints?: number) => void;
  onToast: (message: string, variant?: 'success' | 'error' | 'info') => void;
}

export function LmsTasksSection({
  currentUser,
  tasks,
  initialSelectedTaskId = null,
  onTaskUpdated,
  onToast,
}: LmsTasksSectionProps) {
  const { firebaseUser, signInWithGoogle } = useFirebase();
  const [filter, setFilter] = useState<'all' | 'pending' | 'done'>('all');
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(
    initialSelectedTaskId ?? (tasks[0]?.id || null)
  );
  const [activeStageIdx, setActiveStageIdx] = useState<number>(0);
  const [connectingGoogle, setConnectingGoogle] = useState(false);

  // Practice stage input
  const [practiceNotes, setPracticeNotes] = useState<Record<number, string>>({});
  const [completingStageId, setCompletingStageId] = useState<number | null>(null);

  // Upload stage input
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);
  const [submissionNote, setSubmissionNote] = useState('');
  const [submittingTask, setSubmittingTask] = useState(false);

  useEffect(() => {
    if (initialSelectedTaskId && tasks.some((t) => t.id === initialSelectedTaskId)) {
      setSelectedTaskId(initialSelectedTaskId);
    } else if (!selectedTaskId || !tasks.some((t) => t.id === selectedTaskId)) {
      setSelectedTaskId(tasks[0]?.id ?? null);
    }
  }, [initialSelectedTaskId, tasks, selectedTaskId]);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || tasks[0] || null;

  // Determine first incomplete stage index whenever task changes
  useEffect(() => {
    if (!selectedTask) return;
    const completedIds = new Set(selectedTask.progress.map((p) => p.stage_id));
    const firstOpen = selectedTask.stages.findIndex((s) => !completedIds.has(s.id));
    setActiveStageIdx(firstOpen >= 0 ? firstOpen : Math.max(0, selectedTask.stages.length - 1));

    const nextNotes: Record<number, string> = {};
    for (const p of selectedTask.progress) {
      if (p.response_text) {
        nextNotes[p.stage_id] = p.response_text;
      }
    }
    setPracticeNotes(nextNotes);
    setSubmissionNote(selectedTask.submission?.submission_note || '');
    setUploadFile(null);
    if (uploadPreviewUrl) {
      URL.revokeObjectURL(uploadPreviewUrl);
      setUploadPreviewUrl(null);
    }
  }, [selectedTask?.id]);

  const completedTasksCount = tasks.filter(
    (t) => t.submission && t.submission.status !== 'revision'
  ).length;
  const pendingTasksCount = tasks.length - completedTasksCount;
  const totalPoints = tasks.reduce((sum, t) => sum + (t.submission?.points_awarded ?? 0), 0);

  const filteredTasks = tasks.filter((t) => {
    const isDone = Boolean(t.submission && t.submission.status !== 'revision');
    if (filter === 'pending') return !isDone;
    if (filter === 'done') return isDone;
    return true;
  });

  const handleSelectUploadFile = (file: File | null) => {
    setUploadFile(file);
    if (uploadPreviewUrl) {
      URL.revokeObjectURL(uploadPreviewUrl);
    }
    if (file && (file.type.startsWith('image/') || file.type.startsWith('video/'))) {
      setUploadPreviewUrl(URL.createObjectURL(file));
    } else {
      setUploadPreviewUrl(null);
    }
  };

  const handleCompleteStage = async (task: LmsTask, stage: LmsTaskStage) => {
    setCompletingStageId(stage.id);
    try {
      const responseText = practiceNotes[stage.id] || '';
      let updatedTask: LmsTask | null = null;

      if (auth.currentUser && task.firestoreId && stage.firestoreId) {
        await completeLmsStageInFirestore({
          taskId: task.firestoreId,
          stageId: stage.firestoreId,
          responseText,
          memberId: currentUser.firestoreId,
        });
        const nextProgress = [
          ...task.progress.filter((p) => p.stage_id !== stage.id),
          {
            stage_id: stage.id,
            stageFirestoreId: stage.firestoreId,
            response_text: responseText,
            completed_at: new Date().toISOString(),
          },
        ];
        updatedTask = { ...task, progress: nextProgress };
      }

      if (getStoredToken()) {
        try {
          const res = await apiFetch<{ task: LmsTask }>(`/api/tasks/${task.id}/stages/${stage.id}/complete`, {
            method: 'POST',
            body: JSON.stringify({ responseText }),
          });
          if (!updatedTask) updatedTask = res.task;
        } catch (err) {
          if (!updatedTask) throw err;
        }
      }

      if (updatedTask) {
        onTaskUpdated(updatedTask);
      }
      const nextIdx = task.stages.findIndex((s) => s.id === stage.id) + 1;
      if (nextIdx < task.stages.length) {
        setActiveStageIdx(nextIdx);
      }
      onToast(`Tahap "${stage.title}" selesai! Tahap berikutnya kini terbuka.`, 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menyelesaikan tahap ini.', 'error');
    } finally {
      setCompletingStageId(null);
    }
  };

  const handleSubmitFinalTask = async (e: FormEvent, task: LmsTask) => {
    e.preventDefault();
    if (!uploadFile && !task.submission?.file_url) {
      onToast('Silakan pilih file hasil tugas terlebih dahulu untuk diunggah.', 'error');
      return;
    }

    setSubmittingTask(true);
    try {
      let updatedTask: LmsTask | null = null;
      let nextTotalPoints: number | undefined;
      let fileUrl = task.submission?.file_url || '';
      let fileName = uploadFile?.name || task.submission?.file_name || 'tugas-siswa';
      let fileType = uploadFile?.type || task.submission?.file_type || '';

      if (uploadFile) {
        if (auth.currentUser) {
          const uploaded = await uploadFileToCloud(uploadFile, { isPublic: false });
          fileUrl = uploaded.cloudUrl;
          fileName = uploaded.fileName;
          fileType = uploaded.mimeType;
        } else if (getStoredToken()) {
          const formData = new FormData();
          formData.append('file', uploadFile);
          formData.append('submissionNote', submissionNote.trim());
          const res = await apiFetch<{ task: LmsTask; totalPoints: number }>(`/api/tasks/${task.id}/submit`, {
            method: 'POST',
            body: formData,
          });
          updatedTask = res.task;
          nextTotalPoints = res.totalPoints;
          if (res.task.submission?.file_url) {
            fileUrl = res.task.submission.file_url;
            fileName = res.task.submission.file_name || fileName;
          }
        } else {
          throw new Error(
            'Hubungkan akun Google terlebih dahulu agar file tugas dapat diunggah dan tersinkron di semua perangkat.'
          );
        }
      }

      if (auth.currentUser && task.firestoreId) {
        const subId = await submitLmsTaskInFirestore({
          taskId: task.firestoreId,
          fileUrl,
          fileName,
          fileType,
          submissionNote: submissionNote.trim(),
          memberId: currentUser.firestoreId,
          fullName: currentUser.full_name,
          username: currentUser.username,
          kelas: currentUser.kelas,
          division: currentUser.division,
        });
        updatedTask = {
          ...task,
          submission: {
            id: Date.now(),
            firestoreId: subId,
            userUid: auth.currentUser.uid,
            task_id: task.id,
            user_id: currentUser.id,
            file_url: fileUrl,
            file_name: fileName,
            file_type: fileType,
            submission_note: submissionNote.trim(),
            status: 'submitted',
            points_awarded: 0,
            admin_feedback: '',
            submitted_at: new Date().toISOString(),
            reviewed_at: '',
          },
        };

        if (getStoredToken()) {
          const mirrorForm = new FormData();
          if (uploadFile) mirrorForm.append('file', uploadFile);
          mirrorForm.append('submissionNote', submissionNote.trim());
          void apiFetch(`/api/tasks/${task.id}/submit`, { method: 'POST', body: mirrorForm }).catch(() => {});
        }
      } else if (!updatedTask && getStoredToken()) {
        const formData = new FormData();
        formData.append('submissionNote', submissionNote.trim());
        const res = await apiFetch<{ task: LmsTask; totalPoints: number }>(`/api/tasks/${task.id}/submit`, {
          method: 'POST',
          body: formData,
        });
        updatedTask = res.task;
        nextTotalPoints = res.totalPoints;
      }

      if (updatedTask) {
        onTaskUpdated(updatedTask, nextTotalPoints);
      }
      handleSelectUploadFile(null);
      onToast(
        nextTotalPoints !== undefined
          ? `Tugas "${task.title}" berhasil diunggah! Anda memperoleh +${task.points_reward} Poin.`
          : `Tugas "${task.title}" terkirim ke Cloud Firestore dan menunggu verifikasi poin Pembina.`,
        'success'
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal mengunggah tugas akhir.', 'error');
    } finally {
      setSubmittingTask(false);
    }
  };

  const stageTypeLabel = (type: LmsTaskStage['stage_type']) => {
    if (type === 'reading') return 'Materi Bacaan';
    if (type === 'practice') return 'Pemahaman / Praktik';
    return 'Upload Tugas Akhir';
  };

  return (
    <section className="space-y-8">
      {/* Header + Member Points Summary */}
      <div className="border-b border-slate-200 pb-6 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#B91C1C]">
            Pembelajaran &amp; Penugasan · {currentUser.full_name}
          </p>
          <h1 className="font-serif text-3xl font-semibold text-slate-900">
            Tugas Belajar Anggota (LMS)
          </h1>
          <p className="text-sm text-slate-600 max-w-2xl">
            Ikuti setiap tahapan secara berurutan mulai dari membaca materi hingga mengunggah hasil tugas akhir untuk mengumpulkan poin keaktifan.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 sm:gap-4 shrink-0">
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
            <p className="text-[11px] font-medium text-slate-500">Total Poin Saya</p>
            <p className="mt-1 text-xl font-semibold text-[#1D4ED8] font-mono tabular-nums flex items-center gap-1.5">
              <Award className="w-4 h-4 text-[#CA8A04]" />
              {Math.max(currentUser.lms_points ?? 0, totalPoints)}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
            <p className="text-[11px] font-medium text-slate-500">Perlu Dikerjakan</p>
            <p className="mt-1 text-xl font-semibold text-[#B91C1C] font-mono tabular-nums">
              {pendingTasksCount}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3">
            <p className="text-[11px] font-medium text-slate-500">Tugas Selesai</p>
            <p className="mt-1 text-xl font-semibold text-emerald-700 font-mono tabular-nums">
              {completedTasksCount}
            </p>
          </div>
        </div>
      </div>

      {/* Filter Controls */}
      <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl w-fit">
        {(
          [
            ['all', `Semua Tugas (${tasks.length})`],
            ['pending', `Belum Selesai (${pendingTasksCount})`],
            ['done', `Selesai (${completedTasksCount})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 min-h-[38px] ${
              filter === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tasks.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center space-y-2">
          <BookOpen className="w-8 h-8 text-slate-400 mx-auto" />
          <p className="text-sm font-medium text-slate-800">Belum ada tugas LMS tersedia</p>
          <p className="text-xs text-slate-500">
            Pembina atau admin belum menerbitkan modul tugas untuk divisi Anda saat ini.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Zone: Task List */}
          <div className="lg:col-span-4 space-y-3">
            {filteredTasks.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-xs text-slate-500">
                Tidak ada tugas pada kategori filter ini.
              </div>
            ) : (
              filteredTasks.map((t) => {
                const completedSet = new Set(t.progress.map((p) => p.stage_id));
                const doneStages = t.stages.filter((s) => completedSet.has(s.id)).length;
                const totalStages = Math.max(t.stages.length, 1);
                const pct = Math.round((doneStages / totalStages) * 100);
                const isSelected = selectedTask?.id === t.id;
                const subStatus = t.submission?.status;

                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTaskId(t.id)}
                    className={`w-full text-left rounded-2xl p-4 border transition-colors space-y-3 ${
                      isSelected
                        ? 'bg-white border-[#1D4ED8] ring-1 ring-[#1D4ED8]/20'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[11px] font-medium text-slate-500">
                        {t.division === 'Semua' ? 'Semua Divisi' : `Divisi ${t.division}`} ·{' '}
                        <span className="font-mono font-semibold text-[#1D4ED8] tabular-nums">
                          +{t.points_reward} Poin
                        </span>
                      </p>
                      <ChevronRight
                        className={`w-4 h-4 shrink-0 ${isSelected ? 'text-[#1D4ED8]' : 'text-slate-400'}`}
                      />
                    </div>

                    <h2 className="text-sm font-semibold text-slate-900 leading-snug">{t.title}</h2>

                    <div className="space-y-1.5">
                      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            subStatus === 'approved' || subStatus === 'submitted'
                              ? 'bg-emerald-600'
                              : subStatus === 'revision'
                              ? 'bg-amber-500'
                              : 'bg-[#1D4ED8]'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums">
                        <span>
                          Tahap {doneStages}/{t.stages.length}
                        </span>
                        <span
                          className={
                            subStatus === 'approved'
                              ? 'text-emerald-700 font-semibold'
                              : subStatus === 'submitted'
                              ? 'text-emerald-700 font-medium'
                              : subStatus === 'revision'
                              ? 'text-amber-700 font-semibold'
                              : 'text-slate-500'
                          }
                        >
                          {subStatus === 'approved'
                            ? `Disetujui (+${t.submission?.points_awarded ?? 0} poin)`
                            : subStatus === 'submitted'
                            ? `Terkirim (+${t.submission?.points_awarded ?? 0} poin)`
                            : subStatus === 'revision'
                            ? 'Perlu Revisi'
                            : doneStages > 0
                            ? 'Dalam Proses'
                            : 'Belum Dimulai'}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Right Zone: Active Multi-Stage LMS Stepper & Workspace */}
          {selectedTask && (
            <div className="lg:col-span-8 bg-white border border-slate-200 rounded-2xl overflow-hidden">
              {/* Task Header */}
              <div className="p-6 border-b border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>
                    {selectedTask.division === 'Semua'
                      ? 'Seluruh Anggota NMC'
                      : `Divisi ${selectedTask.division}`}
                    {selectedTask.creator_name ? ` · Oleh ${selectedTask.creator_name}` : ''}
                  </span>
                  <div className="flex items-center gap-3 font-mono tabular-nums">
                    {selectedTask.due_date && (
                      <span className="inline-flex items-center gap-1 text-slate-600">
                        <Calendar className="w-3.5 h-3.5" />
                        Batas: {formatDateID(selectedTask.due_date)}
                      </span>
                    )}
                    <span className="font-semibold text-[#1D4ED8]">
                      +{selectedTask.points_reward} Poin
                    </span>
                  </div>
                </div>

                <h2 className="font-serif text-xl sm:text-2xl font-semibold text-slate-900">
                  {selectedTask.title}
                </h2>
                {selectedTask.description && (
                  <p className="text-sm text-slate-600 leading-relaxed">{selectedTask.description}</p>
                )}

                {/* Sequential Stage Stepper */}
                <div className="pt-3 flex items-center gap-2 overflow-x-auto pb-1">
                  {selectedTask.stages.map((st, idx) => {
                    const completedIds = new Set(selectedTask.progress.map((p) => p.stage_id));
                    const isCompleted = completedIds.has(st.id);
                    const allPriorCompleted = selectedTask.stages
                      .slice(0, idx)
                      .every((prev) => completedIds.has(prev.id));
                    const isUnlocked = idx === 0 || allPriorCompleted;
                    const isCurrent = activeStageIdx === idx;

                    return (
                      <button
                        key={st.id}
                        type="button"
                        disabled={!isUnlocked}
                        onClick={() => isUnlocked && setActiveStageIdx(idx)}
                        className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                          isCurrent
                            ? 'bg-[#1D4ED8] text-white border-[#1D4ED8]'
                            : isCompleted
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                            : isUnlocked
                            ? 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                            : 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed'
                        }`}
                      >
                        {isCompleted ? (
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        ) : !isUnlocked ? (
                          <Lock className="w-3.5 h-3.5 shrink-0" />
                        ) : (
                          <span className="font-mono font-semibold">{idx + 1}.</span>
                        )}
                        <span>
                          Tahap {idx + 1}:{' '}
                          {st.stage_type === 'reading'
                            ? 'Materi'
                            : st.stage_type === 'practice'
                            ? 'Praktik'
                            : 'Upload Tugas'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Active Stage Body */}
              {(() => {
                const stage = selectedTask.stages[activeStageIdx];
                if (!stage) {
                  return (
                    <div className="p-8 text-center text-sm text-slate-500">
                      Tahapan pembelajaran belum tersedia.
                    </div>
                  );
                }

                const completedIds = new Set(selectedTask.progress.map((p) => p.stage_id));
                const isStageCompleted = completedIds.has(stage.id);

                return (
                  <div className="p-6 sm:p-8 space-y-6">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                      <div className="space-y-1">
                        <p className="text-xs font-semibold uppercase tracking-wider text-[#B91C1C]">
                          Tahap {activeStageIdx + 1} dari {selectedTask.stages.length} ·{' '}
                          {stageTypeLabel(stage.stage_type)}
                        </p>
                        <h3 className="text-lg sm:text-xl font-semibold text-slate-900">
                          {stage.title}
                        </h3>
                      </div>

                      {isStageCompleted && (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                          <CheckCircle2 className="w-4 h-4" />
                          Tahap Selesai
                        </span>
                      )}
                    </div>

                    {/* Stage Content (Reading / Practice / Upload instructions) */}
                    {stage.content && (
                      <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-5 space-y-3 text-sm sm:text-[15px] leading-relaxed text-slate-700">
                        {stage.content.split('\n').map((line, i) =>
                          line.trim() ? <p key={i}>{line}</p> : <div key={i} className="h-1" />
                        )}
                      </div>
                    )}

                    {/* Optional Material Attachment from Admin */}
                    {stage.attachment_url && (
                      <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-3">
                        <p className="text-xs font-semibold text-slate-700">Lampiran Materi Pembina</p>
                        <CloudFileAttachment
                          url={stage.attachment_url}
                          title={stage.title}
                          linkLabel={
                            <>
                              <FileText className="w-4 h-4" />
                              Buka / Unduh Lampiran Materi
                            </>
                          }
                          className="inline-flex items-center gap-2 text-xs font-semibold text-[#1D4ED8] hover:underline"
                        />
                      </div>
                    )}

                    {/* Stage Action Controls */}
                    {stage.stage_type === 'reading' && (
                      <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs text-slate-500">
                          Pastikan Anda telah membaca seluruh materi di atas sebelum melanjutkan ke tahap berikutnya.
                        </p>
                        {isStageCompleted ? (
                          activeStageIdx + 1 < selectedTask.stages.length && (
                            <button
                              type="button"
                              onClick={() => setActiveStageIdx(activeStageIdx + 1)}
                              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-xl min-h-[44px]"
                            >
                              Lanjut ke Tahap Berikutnya
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          )
                        ) : (
                          <button
                            type="button"
                            disabled={completingStageId === stage.id}
                            onClick={() => handleCompleteStage(selectedTask, stage)}
                            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-60 rounded-xl min-h-[44px]"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            {completingStageId === stage.id
                              ? 'Menyimpan...'
                              : 'Selesai Membaca & Lanjut'}
                          </button>
                        )}
                      </div>
                    )}

                    {stage.stage_type === 'practice' && (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                            <PenLine className="w-3.5 h-3.5 text-[#1D4ED8]" />
                            Catatan / Jawaban Pemahaman Anggota
                          </label>
                          <textarea
                            rows={3}
                            value={practiceNotes[stage.id] || ''}
                            onChange={(e) =>
                              setPracticeNotes((prev) => ({ ...prev, [stage.id]: e.target.value }))
                            }
                            placeholder="Tuliskan ringkasan materi atau rencana pengerjaan tugas Anda..."
                            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                          />
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-3">
                          <button
                            type="button"
                            disabled={completingStageId === stage.id}
                            onClick={() => handleCompleteStage(selectedTask, stage)}
                            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-60 rounded-xl min-h-[44px]"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            {completingStageId === stage.id
                              ? 'Menyimpan...'
                              : isStageCompleted
                              ? 'Perbarui Catatan & Lanjut'
                              : 'Simpan & Lanjut ke Tahap Berikutnya'}
                          </button>
                        </div>
                      </div>
                    )}

                    {stage.stage_type === 'upload' && (
                      <div className="space-y-5">
                        {selectedTask.submission && (
                          <div
                            className={`rounded-xl border p-4 space-y-2 ${
                              selectedTask.submission.status === 'revision'
                                ? 'bg-amber-50/70 border-amber-200'
                                : 'bg-emerald-50/70 border-emerald-200'
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span
                                className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                                  selectedTask.submission.status === 'revision'
                                    ? 'text-amber-800'
                                    : 'text-emerald-800'
                                }`}
                              >
                                {selectedTask.submission.status === 'revision' ? (
                                  <Clock className="w-4 h-4" />
                                ) : (
                                  <CheckCircle2 className="w-4 h-4" />
                                )}
                                {selectedTask.submission.status === 'approved'
                                  ? 'Tugas Disetujui Pembina'
                                  : selectedTask.submission.status === 'revision'
                                  ? 'Perlu Revisi / Unggah Ulang'
                                  : 'Tugas Berhasil Diunggah'}
                              </span>
                              <span className="text-xs font-mono font-semibold text-[#1D4ED8] tabular-nums">
                                Poin Diperoleh: +{selectedTask.submission.points_awarded}
                              </span>
                            </div>

                            {selectedTask.submission.admin_feedback && (
                              <p className="text-xs text-slate-700">
                                <strong>Catatan Pembina:</strong> {selectedTask.submission.admin_feedback}
                              </p>
                            )}

                            {selectedTask.submission.file_url && (
                              <div className="pt-1">
                                <CloudFileAttachment
                                  url={selectedTask.submission.file_url}
                                  fileName={selectedTask.submission.file_name}
                                  fileType={selectedTask.submission.file_type}
                                  linkLabel={
                                    <>
                                      <FileText className="w-3.5 h-3.5" />
                                      File Terkirim: {selectedTask.submission.file_name || 'Lihat / Unduh File Tugas'}
                                    </>
                                  }
                                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1D4ED8] hover:underline"
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {!firebaseUser && (
                          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                            <p className="text-xs text-amber-900 leading-relaxed">
                              Hubungkan akun Google terlebih dahulu agar file hasil tugas dapat diunggah dan tersimpan ke Cloud.
                            </p>
                            <button
                              type="button"
                              disabled={connectingGoogle}
                              onClick={async () => {
                                setConnectingGoogle(true);
                                try {
                                  await signInWithGoogle();
                                  onToast('Akun Google terhubung! Anda siap mengunggah file tugas.', 'success');
                                } catch (err) {
                                  onToast(err instanceof Error ? err.message : 'Gagal menghubungkan Google.', 'error');
                                } finally {
                                  setConnectingGoogle(false);
                                }
                              }}
                              className="px-3 py-2 text-xs font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-lg whitespace-nowrap shrink-0"
                            >
                              {connectingGoogle ? 'Menghubungkan...' : 'Hubungkan Google untuk Upload'}
                            </button>
                          </div>
                        )}

                        <form onSubmit={(e) => handleSubmitFinalTask(e, selectedTask)} className="space-y-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                              {selectedTask.submission
                                ? 'Ganti / Unggah Ulang File Hasil Tugas (maks 15MB)'
                                : 'Upload File Hasil Tugas (Foto, Video, PDF, Dokumen, Audio, atau ZIP · maks 15MB)'}
                            </label>
                            <label className="flex flex-col items-center justify-center gap-2 border border-dashed border-slate-300 rounded-xl p-6 cursor-pointer hover:bg-slate-50 transition-colors">
                              <UploadCloud className="w-6 h-6 text-[#1D4ED8]" />
                              <span className="text-xs font-medium text-slate-700 text-center">
                                {uploadFile
                                  ? `${uploadFile.name} (${Math.max(1, Math.round(uploadFile.size / 1024))} KB)`
                                  : 'Klik untuk memilih file hasil pengerjaan tugas'}
                              </span>
                              <input
                                type="file"
                                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.zip"
                                className="hidden"
                                onChange={(e) => handleSelectUploadFile(e.target.files?.[0] || null)}
                              />
                            </label>

                            {uploadPreviewUrl && uploadFile && (
                              <div className="mt-3 rounded-xl overflow-hidden border border-slate-200 bg-slate-100 max-h-52">
                                {uploadFile.type.startsWith('video/') ? (
                                  <video src={uploadPreviewUrl} controls className="w-full max-h-52 object-contain" />
                                ) : (
                                  <img src={uploadPreviewUrl} alt="Pratinjau tugas" className="w-full max-h-52 object-cover" />
                                )}
                              </div>
                            )}
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                              Keterangan Pengerjaan Tugas (Opsional)
                            </label>
                            <textarea
                              rows={3}
                              value={submissionNote}
                              onChange={(e) => setSubmissionNote(e.target.value)}
                              placeholder="Tambahkan catatan singkat atau penjelasan karya/tugas yang Anda unggah..."
                              className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                            />
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                            <p className="text-xs text-slate-500">
                              Mengunggah tugas akhir otomatis mencatat penyelesaian dan menambahkan{' '}
                              <strong className="text-slate-800">+{selectedTask.points_reward} poin</strong>.
                            </p>
                            <button
                              type="submit"
                              disabled={submittingTask}
                              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-xl min-h-[44px]"
                            >
                              <UploadCloud className="w-4 h-4" />
                              {submittingTask
                                ? 'Mengunggah Tugas...'
                                : selectedTask.submission
                                ? 'Kirim Pembaruan Tugas'
                                : `Upload & Selesaikan (+${selectedTask.points_reward} Poin)`}
                            </button>
                          </div>
                        </form>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
