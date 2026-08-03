'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/language-context';

export function AboutContent() {
    const { messages } = useLanguage();

    return (
        <main className="min-h-screen px-4 py-8">
            <div className="page-scroll-progress" aria-hidden />
            <div className="mx-auto max-w-4xl space-y-6">
                <section className="card p-6 md:p-8 reveal-on-scroll">
                    <h1 className="text-3xl font-bold mb-3 text-fg">
                        {messages.publicPages.aboutTitle}
                    </h1>
                    <p className="text-sm leading-6 text-secondary-fg">
                        {messages.publicPages.aboutLead}
                    </p>
                </section>

                <section className="card p-6 md:p-8 reveal-on-scroll">
                    <h2 className="text-xl font-semibold mb-3 text-fg">
                        {messages.publicPages.aboutAvailable}
                    </h2>
                    <ul className="space-y-2 text-sm text-secondary-fg">
                        <li>{`• ${messages.publicPages.aboutFeatureSchedule}`}</li>
                        <li>{`• ${messages.publicPages.aboutFeatureExams}`}</li>
                        <li>{`• ${messages.publicPages.aboutFeatureGrades}`}</li>
                        <li>{`• ${messages.publicPages.aboutFeatureUmkd}`}</li>
                    </ul>
                </section>

                <section className="card p-6 md:p-8 reveal-on-scroll">
                    <h2 className="text-xl font-semibold mb-3 text-fg">
                        {messages.publicPages.aboutPopular}
                    </h2>
                    <div className="grid sm:grid-cols-3 gap-3 text-sm">
                        <Link className="card p-3 transition-colors" href="/univer-kstu">Univer KSTU</Link>
                        <Link className="card p-3 transition-colors" href="/raspisanie-kstu">{messages.publicPages.popularSchedule}</Link>
                        <Link className="card p-3 transition-colors" href="/vhod-univer-kstu">{messages.publicPages.popularLogin}</Link>
                        <Link className="card p-3 transition-colors" href="/kstu-raspisanie-par">{messages.publicPages.popularLessons}</Link>
                        <Link className="card p-3 transition-colors" href="/raspisanie-zanyatii-kstu">{messages.publicPages.popularClassSchedule}</Link>
                        <Link className="card p-3 transition-colors" href="/ocenki-univer-kstu">{messages.publicPages.popularGrades}</Link>
                        <Link className="card p-3 transition-colors" href="/ekzameny-kstu">{messages.publicPages.popularExams}</Link>
                        <Link className="card p-3 transition-colors" href="/univer">Univer</Link>
                    </div>
                    <Link
                        href="/login"
                        className="btn btn-primary inline-flex mt-4 px-4 py-2 text-sm"
                    >
                        {messages.publicPages.aboutGoToLogin}
                    </Link>
                </section>
            </div>
        </main>
    );
}
