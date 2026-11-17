import { useState } from 'react';
import { ArrowRight, Award, BookOpen, Calendar, Clock, MapPin, X } from 'lucide-react';
import type { LmsTask, NewsArticle, ScheduleItem, SiteBranding, StudentProfile, StudentWork } from '../types';
import { HERO_IMAGE, formatDateID, resolveMediaUrl } from '../lib/mediaAssets';

interface HomeSectionProps {
  news: NewsArticle[];
  schedules: ScheduleItem[];
  works: StudentWork[];
  memberCount: number;
  siteBranding: SiteBranding;
  currentUser?: StudentProfile | null;
  lmsTasks?: LmsTask[];
  isAdmin?: boolean;
  onNavigate: (tab: 'galeri' | 'anggota' | 'jadwal' | 'absensi' | 'tugas') => void;
  onOpenWork: (work: StudentWork) => void;
}

export function HomeSection({
  news,
  schedules,
  works,
  memberCount,
  siteBranding,
  currentUser = null,
  lmsTasks = [],
  isAdmin = false,
  onNavigate,
  onOpenWork,
}: HomeSectionProps) {
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);

  const leadArticle = news.find((n) => n.is_featured === 1) || news[0];
  const secondaryArticles = news.filter((n) => n.id !== leadArticle?.id).slice(0, 3);
  const upcomingSchedules = schedules.slice(0, 3);
  const recentWorks = works.slice(0, 3);
  const pendingLmsCount = lmsTasks.filter(
    (t) => !t.submission || t.submission.status === 'revision'
  ).length;
  const completedLmsCount = lmsTasks.length - pendingLmsCount;

  return (
    <div className="space-y-16">
      {currentUser && (
        <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#1D4ED8]">
              Akun Aktif · {currentUser.full_name}
            </p>
            <h2 className="text-base sm:text-lg font-semibold text-slate-900">
              {pendingLmsCount > 0
                ? `${pendingLmsCount} Tugas LMS Menunggu Dikerjakan`
                : 'Semua Tugas LMS Anda Sudah Diselesaikan'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 font-mono tabular-nums flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1 text-[#CA8A04] font-semibold">
                <Award className="w-4 h-4" />
                {currentUser.lms_points ?? 0} Poin LMS
              </span>
              <span aria-hidden="true">·</span>
              <span>Selesai: {completedLmsCount} tugas</span>
              <span aria-hidden="true">·</span>
              <span>Total modul: {lmsTasks.length}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('tugas')}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-xl transition-colors min-h-[44px] whitespace-nowrap shrink-0"
          >
            <BookOpen className="w-4 h-4" />
            Buka Tugas Saya
          </button>
        </section>
      )}

      {/* Split Hero Section */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
        <div className="lg:col-span-6 flex flex-col justify-between bg-white border border-slate-200 rounded-2xl p-6 sm:p-10">
          <div className="space-y-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#C81E1E]">
              {siteBranding.heroEyebrow || 'SMP Negeri 2 Ciamis · Ekstrakurikuler Resmi'}
            </p>
            <h1 className="font-serif text-3xl sm:text-4xl lg:text-[42px] font-semibold leading-[1.12] tracking-tight text-slate-900 [text-wrap:balance]">
              {siteBranding.heroTitle || 'Nedacis Media Center: Ruang Berkarya & Jurnalisme Siswa SMPN 2 Ciamis'}
            </h1>
            <p className="text-[15px] sm:text-base leading-relaxed text-slate-600 max-w-xl">
              {siteBranding.heroDescription ||
                'Wadah resmi siswa SMPN 2 Ciamis dalam bidang fotografi, videografi, penyiaran, desain grafis, dan jurnalistik sekolah—dilengkapi arsip karya digital serta sistem absensi kartu pelajar NFC/RFID dan QR Code secara real-time.'}
            </p>
          </div>

          <div className="mt-8 pt-6 border-t border-slate-100 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('galeri')}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-xl transition-colors min-h-[44px] whitespace-nowrap shrink-0"
            >
              Jelajahi Galeri Karya
              <ArrowRight className="w-4 h-4" />
            </button>
            {isAdmin ? (
              <button
                type="button"
                onClick={() => onNavigate('absensi')}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-amber-950 bg-[#FACC15] hover:bg-[#EAB308] rounded-xl transition-colors min-h-[44px] whitespace-nowrap shrink-0"
              >
                Terminal Absensi NFC
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate('anggota')}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-amber-950 bg-[#FACC15] hover:bg-[#EAB308] rounded-xl transition-colors min-h-[44px] whitespace-nowrap shrink-0"
              >
                Profil Anggota NMC
              </button>
            )}
          </div>
        </div>

        <div className="lg:col-span-6 relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 min-h-[280px] lg:min-h-[420px]">
          <img
            src={siteBranding.heroImageUrl ? resolveMediaUrl(siteBranding.heroImageUrl) : HERO_IMAGE}
            alt={siteBranding.heroTitle || 'Anggota Nedacis Media Center SMPN 2 Ciamis di ruang produksi studio'}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-6 sm:p-8">
            <p className="text-xs font-medium text-slate-200">
              Studio Produksi NMC · Kampus SMPN 2 Ciamis
            </p>
            <p className="mt-1 text-base sm:text-lg font-medium text-white">
              Dokumentasi kegiatan sekolah, produksi siaran podcast, dan pelatihan media kreatif siswa.
            </p>
          </div>
        </div>
      </section>

      {/* Full-Width 3-Column Proof Strip */}
      <section aria-label="Ringkasan Ekstrakurikuler" className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Peserta Terdaftar</p>
          <p className="mt-2 text-2xl sm:text-3xl font-semibold text-[#C81E1E] font-mono tabular-nums">
            {memberCount} / 20
          </p>
          <p className="mt-1 text-xs text-slate-500">Siswa aktif kelas 7, 8, dan 9</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Divisi Kompetensi</p>
          <p className="mt-2 text-2xl sm:text-3xl font-semibold text-[#1D4ED8] font-mono tabular-nums">
            5
          </p>
          <p className="mt-1 text-xs text-slate-500">Foto, Video, Jurnal, Desain, Siaran</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Karya Terpublikasi</p>
          <p className="mt-2 text-2xl sm:text-3xl font-semibold text-[#CA8A04] font-mono tabular-nums">
            {works.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">Foto &amp; video dokumentasi siswa</p>
        </div>
      </section>

      {/* Berita & Hasil Liputan Sekolah */}
      <section className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-[#C81E1E]">
              Warta &amp; Liputan Sekolah
            </p>
            <h2 className="mt-1 font-serif text-2xl sm:text-3xl font-semibold text-slate-900">
              Berita Kegiatan Siswa Terkini
            </h2>
          </div>
          <p className="text-sm text-slate-500">
            Disusun langsung oleh tim redaksi &amp; peliput lapangan NMC SMPN 2 Ciamis
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Lead Story */}
          {leadArticle && (
            <article
              onClick={() => setSelectedArticle(leadArticle)}
              className="lg:col-span-7 group cursor-pointer bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col hover:border-slate-300 transition-colors"
            >
              <div className="aspect-[16/10] w-full bg-slate-100 overflow-hidden">
                <img
                  src={resolveMediaUrl(leadArticle.image_url)}
                  alt={leadArticle.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                />
              </div>
              <div className="p-6 sm:p-8 flex-1 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-semibold text-[#C81E1E]">{leadArticle.category}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatDateID(leadArticle.published_at)}</span>
                    <span aria-hidden="true">·</span>
                    <span>Oleh {leadArticle.author_name}</span>
                  </div>
                  <h3 className="font-serif text-xl sm:text-2xl font-semibold text-slate-900 leading-snug group-hover:text-[#C81E1E] transition-colors [text-wrap:balance]">
                    {leadArticle.title}
                  </h3>
                  <p className="text-sm sm:text-[15px] leading-relaxed text-slate-600">
                    {leadArticle.summary}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#C81E1E]">
                  Baca laporan lengkap
                  <ArrowRight className="w-4 h-4" />
                </span>
              </div>
            </article>
          )}

          {/* Secondary Stories */}
          <div className="lg:col-span-5 flex flex-col divide-y divide-slate-200 bg-white border border-slate-200 rounded-2xl overflow-hidden">
            {secondaryArticles.map((article) => (
              <article
                key={article.id}
                onClick={() => setSelectedArticle(article)}
                className="p-5 sm:p-6 flex gap-4 cursor-pointer hover:bg-slate-50 transition-colors"
              >
                <div className="w-24 h-24 sm:w-28 sm:h-24 shrink-0 rounded-xl overflow-hidden bg-slate-100 border border-slate-200">
                  <img
                    src={resolveMediaUrl(article.image_url)}
                    alt={article.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    <span className="font-medium text-[#C81E1E]">{article.category}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatDateID(article.published_at)}</span>
                  </div>
                  <h3 className="text-sm sm:text-base font-semibold text-slate-900 leading-snug line-clamp-2">
                    {article.title}
                  </h3>
                  <p className="text-xs text-slate-500 line-clamp-2">{article.summary}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Preview: Jadwal Terdekat & Galeri Pilihan */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Jadwal Kegiatan */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-slate-500">Agenda Rutin</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900">Jadwal Kegiatan Terbaru</h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('jadwal')}
              className="text-sm font-medium text-[#1D4ED8] hover:underline whitespace-nowrap shrink-0"
            >
              Semua Jadwal
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {upcomingSchedules.map((item) => (
              <div key={item.id} className="py-4 first:pt-0 last:pb-0 space-y-1.5">
                <p className="text-xs font-medium text-[#C81E1E]">{item.division}</p>
                <h3 className="text-sm sm:text-base font-semibold text-slate-900">{item.title}</h3>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {formatDateID(item.event_date)}
                  </span>
                  <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                    <Clock className="w-3.5 h-3.5" />
                    {item.start_time}–{item.end_time}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" />
                    {item.location}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Karya Terbaru */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-slate-500">Kurasi Studio</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-900">Karya Foto &amp; Video Siswa</h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('galeri')}
              className="text-sm font-medium text-[#1D4ED8] hover:underline whitespace-nowrap shrink-0"
            >
              Buka Galeri
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {recentWorks.map((work) => (
              <button
                key={work.id}
                type="button"
                onClick={() => onOpenWork(work)}
                className="text-left group border border-slate-200 rounded-xl overflow-hidden hover:border-slate-300 transition-colors bg-white"
              >
                <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                  {work.media_type === 'video' ? (
                    <video
                      src={resolveMediaUrl(work.media_url)}
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                    />
                  ) : (
                    <img
                      src={resolveMediaUrl(work.media_url)}
                      alt={work.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                    />
                  )}
                </div>
                <div className="p-3.5 space-y-1">
                  <p className="text-xs text-slate-500 truncate">
                    {work.category} · {work.author_kelas}
                  </p>
                  <h3 className="text-sm font-semibold text-slate-900 line-clamp-2 leading-snug">
                    {work.title}
                  </h3>
                  <p className="text-xs text-slate-500 truncate">{work.author_name}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Article Reader Modal */}
      {selectedArticle && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedArticle(null)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 max-w-2xl w-full max-h-[88vh] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="font-semibold text-[#C81E1E]">{selectedArticle.category}</span>
                <span aria-hidden="true">·</span>
                <span>{formatDateID(selectedArticle.published_at)}</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedArticle(null)}
                aria-label="Tutup artikel"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 sm:p-8 space-y-6">
              <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-slate-900 leading-tight [text-wrap:balance]">
                {selectedArticle.title}
              </h2>
              <p className="text-xs text-slate-500">Ditulis oleh {selectedArticle.author_name}</p>
              <div className="aspect-[16/10] rounded-xl overflow-hidden bg-slate-100 border border-slate-200">
                <img
                  src={resolveMediaUrl(selectedArticle.image_url)}
                  alt={selectedArticle.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="space-y-4 text-[15px] sm:text-base leading-relaxed text-slate-700 max-w-prose">
                {selectedArticle.content.split('\n\n').map((para, idx) => (
                  <p key={idx}>{para}</p>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
