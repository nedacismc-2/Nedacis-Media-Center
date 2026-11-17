import { useState, type FormEvent } from 'react';
import { BellRing, Calendar, Clock, MapPin, Plus, Trash2, UserCheck, X } from 'lucide-react';
import type { ScheduleItem, StudentProfile } from '../types';
import { apiFetch, getStoredToken } from '../lib/api';
import { auth } from '../lib/firebase';
import {
  createScheduleInFirestore,
  deleteScheduleInFirestore,
  remindScheduleInFirestore,
} from '../lib/firestoreSync';
import { formatDateID, getLocalTimeZoneLabel } from '../lib/mediaAssets';

interface ScheduleSectionProps {
  schedules: ScheduleItem[];
  currentUser: StudentProfile | null;
  onScheduleAdded: (schedule: ScheduleItem) => void;
  onScheduleDeleted: (id: number) => void;
  onToast: (message: string, variant?: 'success' | 'error' | 'info') => void;
}

export function ScheduleSection({
  schedules,
  currentUser,
  onScheduleAdded,
  onScheduleDeleted,
  onToast,
}: ScheduleSectionProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [title, setTitle] = useState('');
  const [division, setDivision] = useState('Semua Divisi');
  const [eventDate, setEventDate] = useState('2026-11-25');
  const [startTime, setStartTime] = useState('15:00');
  const [endTime, setEndTime] = useState('16:45');
  const [location, setLocation] = useState('Studio MMC SMPN 2 Ciamis');
  const [mentor, setMentor] = useState('Hendra Kusuma, S.Pd.');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreateSchedule = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      let createdSchedule: ScheduleItem | null = null;

      if (auth.currentUser) {
        const firestoreId = await createScheduleInFirestore({
          title,
          division,
          event_date: eventDate,
          start_time: startTime,
          end_time: endTime,
          location,
          mentor,
          description,
        });
        createdSchedule = {
          id: Date.now(),
          firestoreId,
          title,
          division,
          event_date: eventDate,
          start_time: startTime,
          end_time: endTime,
          location,
          mentor,
          description,
          reminder_sent: 1,
        };
      }

      if (getStoredToken()) {
        try {
          const res = await apiFetch<{ schedule: ScheduleItem }>('/api/schedules', {
            method: 'POST',
            body: JSON.stringify({
              title,
              division,
              event_date: eventDate,
              start_time: startTime,
              end_time: endTime,
              location,
              mentor,
              description,
            }),
          });
          if (!createdSchedule) createdSchedule = res.schedule;
        } catch {
          if (!createdSchedule) throw new Error('Gagal menambah jadwal.');
        }
      }

      if (!createdSchedule) {
        throw new Error('Masuk sebagai Admin atau hubungkan akun Google Firebase terlebih dahulu.');
      }

      onScheduleAdded(createdSchedule);
      setShowAddModal(false);
      setTitle('');
      setDescription('');
      onToast('Jadwal baru ditambahkan dan tersinkronisasi untuk seluruh siswa.', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menambah jadwal.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSendReminder = async (schedule: ScheduleItem) => {
    try {
      if (auth.currentUser && schedule.firestoreId) {
        await remindScheduleInFirestore(schedule.firestoreId);
      }
      if (getStoredToken()) {
        await apiFetch(`/api/schedules/${schedule.id}/remind`, { method: 'POST' }).catch(() => {});
      }
      onToast(`Pengingat jadwal "${schedule.title}" dikirim real-time ke seluruh peserta didik.`, 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal mengirim pengingat.', 'error');
    }
  };

  const handleDelete = async (schedule: ScheduleItem) => {
    try {
      if (auth.currentUser && schedule.firestoreId) {
        await deleteScheduleInFirestore(schedule.firestoreId);
      }
      if (getStoredToken()) {
        await apiFetch(`/api/schedules/${schedule.id}`, { method: 'DELETE' }).catch(() => {});
      }
      onScheduleDeleted(schedule.id);
      onToast('Jadwal kegiatan dihapus.', 'info');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Gagal menghapus jadwal.', 'error');
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-[#C81E1E]">
            Agenda &amp; Pengingat Kegiatan
          </p>
          <h1 className="mt-1 font-serif text-3xl font-semibold text-slate-900">
            Jadwal Kegiatan Ekstrakurikuler MMC
          </h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Seluruh anggota menerima notifikasi pengingat jadwal secara otomatis sebelum kegiatan dimulai.
          </p>
        </div>

        {currentUser?.role === 'admin' && (
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-xl transition-colors min-h-[44px] whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Tambah Jadwal Kegiatan
          </button>
        )}
      </div>

      {schedules.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-sm text-slate-500">
          Belum ada jadwal kegiatan terbaru.
        </div>
      ) : (
        <div className="space-y-4">
          {schedules.map((item) => (
            <div
              key={item.id}
              className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6"
            >
              <div className="space-y-2.5 max-w-3xl">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-semibold text-[#C81E1E]">{item.division}</span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <UserCheck className="w-3.5 h-3.5" />
                    Pembina: {item.mentor}
                  </span>
                </div>
                <h2 className="text-lg sm:text-xl font-semibold text-slate-900">{item.title}</h2>
                {item.description && <p className="text-sm text-slate-600 leading-relaxed">{item.description}</p>}

                <div className="pt-1 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs sm:text-sm text-slate-700">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <Calendar className="w-4 h-4 text-[#1D4ED8]" />
                    {formatDateID(item.event_date)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
                    <Clock className="w-4 h-4 text-slate-500" />
                    {item.start_time} – {item.end_time} {getLocalTimeZoneLabel()}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-slate-500" />
                    {item.location}
                  </span>
                </div>
              </div>

              {currentUser?.role === 'admin' && (
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleSendReminder(item)}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs sm:text-sm font-semibold text-amber-950 bg-[#FEF08A] hover:bg-[#FACC15] rounded-xl transition-colors min-h-[44px] whitespace-nowrap"
                  >
                    <BellRing className="w-4 h-4" />
                    Kirim Pengingat Siswa
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(item)}
                    aria-label="Hapus jadwal"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Schedule Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Buat Jadwal &amp; Pengingat Kegiatan</h2>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateSchedule} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Judul Kegiatan</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Contoh: Latihan Liputan Hari Guru Nasional"
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Divisi</label>
                  <select
                    value={division}
                    onChange={(e) => setDivision(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                  >
                    <option value="Semua Divisi">Semua Divisi</option>
                    <option value="Fotografi">Fotografi</option>
                    <option value="Videografi">Videografi</option>
                    <option value="Jurnalistik">Jurnalistik</option>
                    <option value="Desain Grafis">Desain Grafis</option>
                    <option value="Penyiaran">Penyiaran</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Tanggal</label>
                  <input
                    type="date"
                    required
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Jam Mulai</label>
                  <input
                    type="time"
                    required
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Jam Selesai</label>
                  <input
                    type="time"
                    required
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Lokasi</label>
                  <input
                    type="text"
                    required
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Pembina / Pemateri</label>
                  <input
                    type="text"
                    value={mentor}
                    onChange={(e) => setMentor(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Catatan / Perlengkapan</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Harap membawa kartu pelajar NFC dan kamera/catatan liputan..."
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-[#1D4ED8]"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl min-h-[44px]"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-xl min-h-[44px]"
                >
                  {saving ? 'Menyimpan...' : 'Simpan & Kirim Pengingat'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
