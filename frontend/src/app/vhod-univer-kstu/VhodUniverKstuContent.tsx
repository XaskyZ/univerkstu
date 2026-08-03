'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/language-context';
import ShareLinkButton from '@/components/ShareLinkButton';

export default function VhodUniverKstuContent() {
    const { language } = useLanguage();
    const content = {
        ru: {
            title: 'Вход в Univer KSTU',
            lead: 'Эта страница собрана под запросы «вход univer kstu» и помогает быстро попасть в личный кабинет студента. После входа доступны расписание занятий, оценки, экзамены и УМКД.',
            cta: 'Перейти ко входу',
            afterAuth: 'Что вы получите после авторизации',
            bullets: [
                'Персональное расписание КСТУ с учетом вашей группы.',
                'Быстрый переход к оценкам и GPA.',
                'Раздел экзаменов с датами и дисциплинами.',
                'Доступ к УМКД и учебным материалам.',
            ],
            faqTitle: 'Частые вопросы',
            faq: [
                ['Как войти в Univer KSTU без ошибок?', 'Откройте страницу входа, используйте актуальные логин и пароль от университета, затем проверьте язык интерфейса.'],
                ['Где после входа смотреть расписание?', 'После авторизации откроется персональное расписание: день, неделя, аудитории, преподаватели и изменения по числителю/знаменателю.'],
                ['Можно ли войти с телефона?', 'Да, вход и дальнейшая работа с расписанием, оценками и УМКД доступны с мобильного браузера.'],
            ],
            seeAlso: 'См. также:',
            classes: 'пары КСТУ',
            schedule: 'расписание КСТУ',
        },
        kz: {
            title: 'Univer KSTU жүйесіне кіру',
            lead: 'Бұл бет «вход univer kstu» сұранысына арналған және студенттің жеке кабинетіне тез өтуге көмектеседі. Кіргеннен кейін кесте, бағалар, емтихандар және UMKD қолжетімді болады.',
            cta: 'Кіруге өту',
            afterAuth: 'Авторизациядан кейін не аласыз',
            bullets: [
                'Тобыңызды ескеретін жеке KSTU кестесі.',
                'Бағалар мен GPA-ға жылдам өту.',
                'Емтихандар бөлімі күндерімен және пәндерімен.',
                'UMKD мен оқу материалдарына қолжетімділік.',
            ],
            faqTitle: 'Жиі қойылатын сұрақтар',
            faq: [
                ['Univer KSTU-ға қатесіз қалай кіруге болады?', 'Кіру бетін ашып, университеттің өзекті логині мен құпиясөзін пайдаланыңыз, содан кейін интерфейс тілін тексеріңіз.'],
                ['Кіргеннен кейін кестені қайдан көремін?', 'Авторизациядан кейін жеке кесте ашылады: күн, апта, аудиториялар, оқытушылар және алым/бөлім өзгерістері.'],
                ['Телефоннан кіруге бола ма?', 'Иә, кіру және кесте, бағалар, UMKD-пен жұмыс мобильді браузерде де қолжетімді.'],
            ],
            seeAlso: 'Қараңыз:',
            classes: 'KSTU жұптары',
            schedule: 'KSTU кестесі',
        },
        en: {
            title: 'Login to Univer KSTU',
            lead: 'This page is built for queries like “vhod univer kstu” and helps you quickly reach the student dashboard. After login you can access schedule, grades, exams and UMKD.',
            cta: 'Go to login',
            afterAuth: 'What you get after authorization',
            bullets: [
                'Personal KSTU schedule matched to your group.',
                'Quick access to grades and GPA.',
                'Exams section with dates and subjects.',
                'Access to UMKD and study materials.',
            ],
            faqTitle: 'Frequently asked questions',
            faq: [
                ['How do I log in to Univer KSTU without errors?', 'Open the login page, use your current university username and password, then check the interface language.'],
                ['Where can I see the schedule after login?', 'After authorization your personal schedule opens with day, week, rooms, teachers and numerator/denominator changes.'],
                ['Can I log in from a phone?', 'Yes, login and further work with schedule, grades and UMKD are available from a mobile browser.'],
            ],
            seeAlso: 'See also:',
            classes: 'KSTU classes',
            schedule: 'KSTU schedule',
        },
    }[language];

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
                <h2 className="text-xl font-semibold mb-3 text-fg">{content.afterAuth}</h2>
                <ul className="space-y-2 text-sm text-secondary-fg">
                    {content.bullets.map((item) => <li key={item}>• {item}</li>)}
                </ul>
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
                    {content.seeAlso} <Link href="/univer-kstu">Univer KSTU</Link>, <Link href="/kstu-raspisanie-par">{content.classes}</Link>,{' '}
                    <Link href="/raspisanie-kstu">{content.schedule}</Link>.
                </div>
            </section>
        </div>
    );
}
