'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Home } from 'lucide-react';
import { AcademyLogo } from '@/components/AcademyLogo';
import { I18nProvider, useI18n } from '@/lib/i18n/client';

/** 404 — final test 18/11: in the screen language (was English only), same look as before. */
function View() {
  const { pick, dir } = useI18n();
  const Back = dir === 'rtl' ? ArrowRight : ArrowLeft;
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4" dir={dir}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-blue-100/50 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-emerald-100/40 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-lg text-center space-y-8">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5, ease: 'easeOut' }} className="flex justify-center">
          <AcademyLogo variant="primary" className="w-20 h-20 drop-shadow-md" />
        </motion.div>

        <div className="space-y-4">
          <motion.h1 initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.1, duration: 0.5 }} className="text-8xl font-black text-slate-900 tracking-tighter" dir="ltr">
            4<span className="text-blue-600">0</span>4
          </motion.h1>
          <motion.h2 initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2, duration: 0.5 }} className="text-2xl font-bold text-slate-800">
            {pick('Page not found', 'الصفحة دي مش موجودة')}
          </motion.h2>
          <motion.p initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3, duration: 0.5 }} className="text-slate-600 max-w-sm mx-auto leading-relaxed">
            {pick(
              'The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.',
              'ممكن تكون اتشالت، أو اسمها اتغيّر، أو اللينك ناقص حاجة. ارجع للصفحة اللي قبلها أو افتح الرئيسية.',
            )}
          </motion.p>
        </div>

        <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4, duration: 0.5 }} className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            onClick={() => window.history.back()}
            className="group flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-3 rounded-full bg-white border border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 hover:border-slate-300 transition-all active:scale-95 shadow-sm hover:shadow-md"
          >
            <Back className="w-4 h-4" />
            {pick('Go back', 'رجوع')}
          </button>
          <Link
            href="/dashboard"
            className="group flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-3 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-all active:scale-95 shadow-md hover:shadow-lg btn-glow"
          >
            <Home className="w-4 h-4" />
            {pick('Home', 'الرئيسية')}
          </Link>
        </motion.div>
      </div>
    </div>
  );
}

export default function NotFound() {
  return <I18nProvider><View /></I18nProvider>;
}
