'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/language-context';
import ShareLinkButton from '@/components/ShareLinkButton';

export default function EkzamenyKstuContent() {
    const { language } = useLanguage();
    const isRu = language === 'ru';
    const isKz = language === 'kz';

    const faq = isRu
        ? [
            ['Где смотреть экзамены КСТУ?', 'После входа откройте раздел «Экзамены», где видны дисциплины, даты и формат экзамена.'],
            ['Можно ли отслеживать обновления по экзаменам?', 'Да, данные обновляются, а в приложении доступно ручное обновление расписания и экзаменов.'],
            ['Нужен отдельный аккаунт для экзаменов?', 'Нет, используется тот же вход, что и для расписания, оценок и УМКД.'],
        ]
        : isKz
            ? [
                ['KSTU емтихандарын қайдан көруге болады?', 'Кіргеннен кейін «Емтихандар» бөлімін ашыңыз, онда пәндер, күндер және емтихан форматы көрінеді.'],
                ['Емтихандар бойынша жаңартуларды бақылауға бола ма?', 'Иә, деректер жаңартылып тұрады, ал қолданбада кесте мен емтихандарды қолмен жаңарту бар.'],
                ['Емтихандар үшін бөлек аккаунт керек пе?', 'Жоқ, кесте, бағалар және UMKD үшін қолданылатын сол аккаунт пайдаланылады.'],
            ]
            : [
                ['Where can I view KSTU exams?', 'After signing in, open the “Exams” section where subjects, dates, and exam format are shown.'],
                ['Can I track exam updates?', 'Yes, data is updated, and the app also supports manual refresh for schedule and exams.'],
                ['Do I need a separate account for exams?', 'No, the same sign-in is used for schedule, grades, and UMKD.'],
            ];

    const list = isRu
        ? ['Список экзаменов по предметам.', 'Даты и формат сдачи.', 'Быстрая проверка с телефона.', 'Связанные данные: расписание и оценки.']
        : isKz
            ? ['Пәндер бойынша емтихандар тізімі.', 'Тапсыру күндері мен форматы.', 'Телефоннан жылдам тексеру.', 'Байланысты деректер: кесте және бағалар.']
            : ['List of exams by subject.', 'Dates and exam format.', 'Quick check from phone.', 'Related data: schedule and grades.'];

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <section className="card p-6 md:p-8">
                <div className="flex items-start justify-between gap-3">
                    <h1 className="text-3xl font-bold mb-3 text-fg">
                        {isRu ? 'Экзамены КСТУ онлайн' : isKz ? 'KSTU емтихандары онлайн' : 'KSTU exams online'}
                    </h1>
                    <ShareLinkButton />
                </div>
                <p className="text-sm leading-6 text-secondary-fg">
                    {isRu
                        ? 'Страница собрана под запросы «экзамены ксту». После входа студент получает доступ к актуальному разделу экзаменов по своим дисциплинам.'
                        : isKz
                            ? 'Бұл бет «экзамены ксту» сұранысына арналған. Кіргеннен кейін студент өз пәндері бойынша өзекті емтихан бөліміне қол жеткізеді.'
                            : 'This page is built for queries like “KSTU exams”. After signing in, a student gets access to the current exams section for their subjects.'}
                </p>
                <Link href="/login" className="btn btn-primary inline-flex mt-4 px-4 py-2 text-sm">
                    {isRu ? 'Открыть экзамены' : isKz ? 'Емтихандарды ашу' : 'Open exams'}
                </Link>
            </section>

            <section className="card p-6 md:p-8">
                <h2 className="text-xl font-semibold mb-3 text-fg">
                    {isRu ? 'Что доступно' : isKz ? 'Не қолжетімді' : 'What is available'}
                </h2>
                <ul className="space-y-2 text-sm text-secondary-fg">
                    {list.map((item) => <li key={item}>• {item}</li>)}
                </ul>
            </section>

            <section className="card p-6 md:p-8">
                <h2 className="text-xl font-semibold mb-3 text-fg">
                    {isRu ? 'Частые вопросы' : isKz ? 'Жиі қойылатын сұрақтар' : 'Frequently asked questions'}
                </h2>
                <div className="space-y-3">
                    {faq.map(([question, answer]) => (
                        <article key={question} className="rounded-lg p-3" style={{ border: '1px solid var(--border)' }}>
                            <h3 className="font-semibold text-sm mb-1 text-fg">{question}</h3>
                            <p className="text-sm text-secondary-fg">{answer}</p>
                        </article>
                    ))}
                </div>
                <div className="mt-4 text-sm text-muted-fg">
                    {isRu ? 'См. также:' : isKz ? 'Қараңыз:' : 'See also:'} <Link href="/ocenki-univer-kstu">{isRu ? 'оценки KSTU' : isKz ? 'KSTU бағалары' : 'KSTU grades'}</Link>, <Link href="/raspisanie-kstu">{isRu ? 'расписание КСТУ' : isKz ? 'KSTU кестесі' : 'KSTU schedule'}</Link>.
                </div>
            </section>
        </div>
    );
}
