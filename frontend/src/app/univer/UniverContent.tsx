'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/language-context';
import ShareLinkButton from '@/components/ShareLinkButton';

export default function UniverContent() {
    const { language } = useLanguage();

    const content = {
        ru: {
            title: 'Univer для студентов КСТУ',
            lead: 'Если вы ищете Univer, здесь можно быстро перейти ко входу и получить доступ к основным учебным разделам: расписание, экзамены, оценки и УМКД.',
            cta: 'Перейти ко входу',
            quickLinks: 'Быстрые ссылки',
            links: ['Страница Univer KSTU', 'Страница Расписание КСТУ', 'Вход Univer KSTU', 'Расписание занятий КСТУ', 'Оценки и GPA', 'Экзамены КСТУ'],
            faqTitle: 'Вопросы и ответы',
            faq: [
                ['Что можно сделать через Univer?', 'Через UniverSchedule можно открыть личное расписание, проверить экзамены, оценки и учебные материалы.'],
                ['Для кого этот сервис?', 'Сервис ориентирован на студентов КСТУ, которым нужен быстрый доступ к учебной информации.'],
                ['С чего начать?', 'Перейдите на страницу входа и авторизуйтесь с вашими учетными данными.'],
            ],
        },
        kz: {
            title: 'KSTU студенттеріне арналған Univer',
            lead: 'Егер сіз Univer іздеп жүрсеңіз, мұнда кіруге тез өтіп, негізгі оқу бөлімдеріне қол жеткізе аласыз: кесте, емтихандар, бағалар және UMKD.',
            cta: 'Кіруге өту',
            quickLinks: 'Жылдам сілтемелер',
            links: ['Univer KSTU беті', 'KSTU кесте беті', 'Univer KSTU кіруі', 'KSTU сабақ кестесі', 'Бағалар және GPA', 'KSTU емтихандары'],
            faqTitle: 'Сұрақтар мен жауаптар',
            faq: [
                ['Univer арқылы не істеуге болады?', 'UniverSchedule арқылы жеке кестені ашып, емтихандарды, бағаларды және оқу материалдарын қарай аласыз.'],
                ['Бұл сервис кімге арналған?', 'Сервис KSTU студенттеріне арналған, оларға оқу ақпаратына жылдам қолжетімділік қажет.'],
                ['Неден бастау керек?', 'Кіру бетіне өтіп, өз есептік деректеріңізбен авторизациядан өтіңіз.'],
            ],
        },
        en: {
            title: 'Univer for KSTU students',
            lead: 'If you are looking for Univer, you can quickly jump to login here and access the main study sections: schedule, exams, grades and UMKD.',
            cta: 'Go to login',
            quickLinks: 'Quick links',
            links: ['Univer KSTU page', 'KSTU Schedule page', 'Univer KSTU login', 'KSTU class schedule', 'Grades and GPA', 'KSTU exams'],
            faqTitle: 'Questions and answers',
            faq: [
                ['What can you do through Univer?', 'With UniverSchedule you can open your personal schedule, check exams, grades and study materials.'],
                ['Who is this service for?', 'The service is designed for KSTU students who need fast access to academic information.'],
                ['Where should I start?', 'Open the login page and sign in with your credentials.'],
            ],
        },
    }[language];

    const hrefs = ['/univer-kstu', '/raspisanie-kstu', '/vhod-univer-kstu', '/raspisanie-zanyatii-kstu', '/ocenki-univer-kstu', '/ekzameny-kstu'];

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <section className="card p-6 md:p-8">
                <div className="flex items-start justify-between gap-3">
                    <h1 className="text-3xl font-bold mb-3 text-fg">{content.title}</h1>
                    <ShareLinkButton />
                </div>
                <p className="text-sm leading-6 text-secondary-fg">{content.lead}</p>
                <Link href="/login" className="btn btn-primary inline-flex mt-4 px-4 py-2 text-sm">
                    {content.cta}
                </Link>
            </section>

            <section className="card p-6 md:p-8">
                <h2 className="text-xl font-semibold mb-3 text-fg">{content.quickLinks}</h2>
                <div className="grid sm:grid-cols-2 gap-3 text-sm">
                    {content.links.map((label, index) => (
                        <Link key={hrefs[index]} className="card p-3 hover:bg-white/5 transition-colors" href={hrefs[index]}>
                            {label}
                        </Link>
                    ))}
                </div>
            </section>

            <section className="card p-6 md:p-8">
                <h2 className="text-xl font-semibold mb-3 text-fg">{content.faqTitle}</h2>
                <div className="space-y-3">
                    {content.faq.map(([question, answer]) => (
                        <article key={question} className="rounded-lg p-3" style={{ border: '1px solid var(--border)' }}>
                            <h3 className="font-semibold text-sm mb-1 text-fg">{question}</h3>
                            <p className="text-sm text-secondary-fg">{answer}</p>
                        </article>
                    ))}
                </div>
            </section>
        </div>
    );
}
