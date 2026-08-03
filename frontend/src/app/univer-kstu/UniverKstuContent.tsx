'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/language-context';
import ShareLinkButton from '@/components/ShareLinkButton';

export default function UniverKstuContent() {
    const { language } = useLanguage();
    const content = {
        ru: {
            title: 'Univer KSTU — удобный вход и личное расписание',
            lead: 'На странице Univer KSTU вы можете быстро перейти ко входу в UniverSchedule и получить доступ к расписанию, экзаменам, оценкам и УМКД в одном интерфейсе.',
            cta: 'Открыть вход',
            available: 'Что доступно студенту',
            bullets: [
                'Личное расписание занятий по вашему аккаунту.',
                'Экзамены и актуальные даты по дисциплинам.',
                'Оценки и GPA из Platonus.',
                'УМКД и загрузка учебных файлов.',
            ],
            links: ['Отдельная страница входа Univer KSTU', 'Пары КСТУ по дням', 'Оценки и GPA в Univer KSTU', 'Экзамены КСТУ онлайн'],
            faqTitle: 'Вопросы и ответы',
            faq: [
                ['Что такое Univer KSTU?', 'UniverSchedule — это удобный интерфейс для работы с учебными данными КСТУ: расписание, экзамены, оценки и УМКД.'],
                ['Нужно ли создавать новый аккаунт?', 'Нет. Вход выполняется с вашими существующими учётными данными KSTU/Platonus.'],
                ['Можно ли пользоваться с телефона?', 'Да, сервис адаптирован под мобильные устройства и ежедневное использование.'],
            ],
            seeAlso: 'См. также:',
            schedule: 'Расписание КСТУ',
            univer: 'Univer',
        },
        kz: {
            title: 'Univer KSTU — ыңғайлы кіру және жеке кесте',
            lead: 'Univer KSTU бетінде сіз UniverSchedule жүйесіне тез кіріп, кесте, емтихандар, бағалар және UMKD-ге бір интерфейстен қол жеткізе аласыз.',
            cta: 'Кіруді ашу',
            available: 'Студентке не қолжетімді',
            bullets: [
                'Сіздің аккаунтыңыз бойынша жеке сабақ кестесі.',
                'Емтихандар және пәндер бойынша өзекті күндер.',
                'Platonus-тен бағалар мен GPA.',
                'UMKD және оқу файлдарын жүктеу.',
            ],
            links: ['Univer KSTU кіру беті', 'KSTU жұптары күндер бойынша', 'Univer KSTU бағалары және GPA', 'KSTU емтихандары онлайн'],
            faqTitle: 'Сұрақтар мен жауаптар',
            faq: [
                ['Univer KSTU деген не?', 'UniverSchedule — KSTU оқу деректерімен жұмыс істеуге арналған ыңғайлы интерфейс: кесте, емтихандар, бағалар және UMKD.'],
                ['Жаңа аккаунт құру керек пе?', 'Жоқ. Кіру KSTU/Platonus-тағы бар есептік деректеріңізбен жасалады.'],
                ['Телефоннан қолдануға бола ма?', 'Иә, сервис мобильді құрылғылар мен күнделікті қолдануға бейімделген.'],
            ],
            seeAlso: 'Қараңыз:',
            schedule: 'KSTU кестесі',
            univer: 'Univer',
        },
        en: {
            title: 'Univer KSTU — convenient login and personal schedule',
            lead: 'On the Univer KSTU page you can quickly open UniverSchedule login and access schedule, exams, grades and UMKD in one interface.',
            cta: 'Open login',
            available: 'What is available to a student',
            bullets: [
                'Personal class schedule for your account.',
                'Exams and current discipline dates.',
                'Grades and GPA from Platonus.',
                'UMKD and study file downloads.',
            ],
            links: ['Separate Univer KSTU login page', 'KSTU classes by day', 'Grades and GPA in Univer KSTU', 'KSTU exams online'],
            faqTitle: 'Questions and answers',
            faq: [
                ['What is Univer KSTU?', 'UniverSchedule is a convenient interface for working with KSTU academic data: schedule, exams, grades and UMKD.'],
                ['Do I need to create a new account?', 'No. Sign in with your existing KSTU/Platonus credentials.'],
                ['Can I use it on my phone?', 'Yes, the service is adapted for mobile devices and daily use.'],
            ],
            seeAlso: 'See also:',
            schedule: 'KSTU schedule',
            univer: 'Univer',
        },
    }[language];
    const hrefs = ['/vhod-univer-kstu', '/kstu-raspisanie-par', '/ocenki-univer-kstu', '/ekzameny-kstu'];

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
                <h2 className="text-xl font-semibold mb-3 text-fg">{content.available}</h2>
                <ul className="space-y-2 text-sm text-secondary-fg">
                    {content.bullets.map((item) => <li key={item}>• {item}</li>)}
                </ul>
                <div className="grid sm:grid-cols-2 gap-3 mt-4 text-sm">
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
                <div className="mt-4 text-sm text-muted-fg">
                    {content.seeAlso} <Link href="/raspisanie-kstu">{content.schedule}</Link> and <Link href="/univer">{content.univer}</Link>
                </div>
            </section>
        </div>
    );
}
