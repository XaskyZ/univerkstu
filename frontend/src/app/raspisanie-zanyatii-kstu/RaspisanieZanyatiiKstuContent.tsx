'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/language-context';
import ShareLinkButton from '@/components/ShareLinkButton';

export default function RaspisanieZanyatiiKstuContent() {
    const { language } = useLanguage();
    const isRu = language === 'ru';
    const isKz = language === 'kz';

    const faq = isRu
        ? [
            ['Чем отличается расписание занятий от пар?', 'По сути это один раздел: в расписании показываются учебные пары, время и детали по каждой дисциплине.'],
            ['Есть ли расписание КСТУ на телефоне?', 'Да, страница полностью адаптирована для мобильного и открывается без установки приложения.'],
            ['Где найти расписание конкретно своей группы?', 'После входа система показывает персональные данные по вашему аккаунту и вашей учебной группе.'],
        ]
        : isKz
            ? [
                ['Сабақ кестесі мен жұптар кестесінің айырмасы қандай?', 'Негізі бұл бір бөлім: кестеде сабақтар, уақыт және әр пән бойынша мәліметтер көрсетіледі.'],
                ['KSTU кестесін телефоннан көруге бола ма?', 'Иә, бет толықтай мобильді құрылғыларға бейімделген және қолданбаны орнатпай-ақ ашылады.'],
                ['Өз тобыма арналған кестені қайдан табамын?', 'Жүйеге кіргеннен кейін сіздің аккаунтыңыз бен оқу тобыңызға арналған жеке деректер көрсетіледі.'],
            ]
            : [
                ['What is the difference between the class schedule and lessons?', 'In practice it is the same section: it shows your classes, times, and details for each subject.'],
                ['Is there a KSTU schedule for phones?', 'Yes, the page is fully optimized for mobile devices and opens without installing the app.'],
                ['Where can I find the schedule for my own group?', 'After signing in, the system shows personal data for your account and your study group.'],
            ];

    const reasons = isRu
        ? ['Личное расписание без ручного поиска группы.', 'Быстрый просмотр на телефоне между парами.', 'Прозрачный формат: время, аудитория, преподаватель.', 'Рядом доступны экзамены, оценки и УМКД.']
        : isKz
            ? ['Топты қолмен іздемей-ақ жеке кесте.', 'Сабақ арасында телефоннан тез қарау.', 'Түсінікті формат: уақыт, аудитория, оқытушы.', 'Жанында емтихандар, бағалар және УӘКД бар.']
            : ['Personal schedule without searching for the group manually.', 'Quick mobile view between classes.', 'Clear format: time, room, teacher.', 'Exams, grades, and UMKD are available nearby.'];

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <section className="card p-6 md:p-8">
                <div className="flex items-start justify-between gap-3">
                    <h1 className="text-3xl font-bold mb-3 text-fg">
                        {isRu ? 'Расписание занятий КСТУ' : isKz ? 'KSTU сабақ кестесі' : 'KSTU class schedule'}
                    </h1>
                    <ShareLinkButton />
                </div>
                <p className="text-sm leading-6 text-secondary-fg">
                    {isRu
                        ? 'Эта страница закрывает запросы «расписание занятий ксту» и «расписание ксту». После входа вы получаете актуальные пары, чётность недели и детали занятий по вашей группе.'
                        : isKz
                            ? 'Бұл бет «KSTU сабақ кестесі» секілді сұраныстарға арналған. Жүйеге кіргеннен кейін сіз өз тобыңыз бойынша өзекті сабақтарды, аптаның жұптылығын және сабақ мәліметтерін көресіз.'
                            : 'This page is designed for queries like “KSTU class schedule”. After signing in, you get current classes, week parity, and lesson details for your group.'}
                </p>
                <Link
                    href="/login"
                    className="btn btn-primary inline-flex mt-4 px-4 py-2 text-sm"
                >
                    {isRu ? 'Открыть расписание' : isKz ? 'Кестені ашу' : 'Open schedule'}
                </Link>
            </section>

            <section className="card p-6 md:p-8">
                <h2 className="text-xl font-semibold mb-3 text-fg">
                    {isRu ? 'Почему это удобно' : isKz ? 'Неге бұл ыңғайлы' : 'Why it is convenient'}
                </h2>
                <ul className="space-y-2 text-sm text-secondary-fg">
                    {reasons.map((item) => <li key={item}>• {item}</li>)}
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
                    {isRu ? 'См. также:' : isKz ? 'Қараңыз:' : 'See also:'}{' '}
                    <Link href="/kstu-raspisanie-par">{isRu ? 'пары КСТУ' : isKz ? 'KSTU жұптары' : 'KSTU lessons'}</Link>,{' '}
                    <Link href="/raspisanie-kstu">{isRu ? 'расписание КСТУ' : isKz ? 'KSTU кестесі' : 'KSTU schedule'}</Link>.
                </div>
            </section>
        </div>
    );
}
