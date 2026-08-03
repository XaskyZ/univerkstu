'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/language-context';
import ShareLinkButton from '@/components/ShareLinkButton';

export default function RaspisanieKstuContent() {
    const { language } = useLanguage();
    const isRu = language === 'ru';
    const isKz = language === 'kz';

    const faq = isRu
        ? [
            ['Где посмотреть расписание КСТУ онлайн?', 'В UniverSchedule после входа доступно персональное расписание с учётом группы и чётности недели.'],
            ['Как часто обновляется расписание?', 'Приложение регулярно синхронизирует данные и позволяет обновить расписание вручную.'],
            ['Есть ли расписание на телефоне?', 'Да, страница расписания адаптирована под мобильный экран.'],
        ]
        : isKz
            ? [
                ['KSTU кестесін онлайн қайдан көруге болады?', 'UniverSchedule ішінде кіргеннен кейін топ пен аптаның жұптылығы ескерілген жеке кесте қолжетімді болады.'],
                ['Кесте қаншалықты жиі жаңартылады?', 'Қолданба деректерді тұрақты түрде синхрондайды және кестені қолмен жаңартуға мүмкіндік береді.'],
                ['Телефоннан көруге бола ма?', 'Иә, кесте беті мобильді экранға бейімделген.'],
            ]
            : [
                ['Where can I view the KSTU schedule online?', 'After signing in to UniverSchedule, you get a personal schedule based on your group and week parity.'],
                ['How often is the schedule updated?', 'The app syncs data regularly and also lets you refresh the schedule manually.'],
                ['Is there a mobile version?', 'Yes, the schedule page is adapted for mobile screens.'],
            ];

    const list = isRu
        ? ['Быстрый просмотр пар на день и неделю.', 'Учет числителя и знаменателя.', 'Подробности по аудиториям и преподавателям.', 'Удобный мобильный интерфейс.']
        : isKz
            ? ['Күн мен апта бойынша сабақтарды жылдам көру.', 'Алым және бөлім ескеріледі.', 'Аудиториялар мен оқытушылар туралы толық мәлімет.', 'Ыңғайлы мобильді интерфейс.']
            : ['Fast view of classes for the day and week.', 'Numerator and denominator week parity included.', 'Details for rooms and teachers.', 'Comfortable mobile interface.'];

    const links = isRu
        ? ['Пары КСТУ на сегодня и неделю', 'Расписание занятий КСТУ', 'Вход в личный кабинет Univer KSTU', 'Главная страница Univer KSTU']
        : isKz
            ? ['Бүгінгі және апталық KSTU сабақтары', 'KSTU сабақ кестесі', 'Univer KSTU жеке кабинетіне кіру', 'Univer KSTU басты беті']
            : ['KSTU classes for today and the week', 'KSTU class schedule', 'Univer KSTU personal account sign-in', 'Univer KSTU home page'];

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <section className="card p-6 md:p-8">
                <div className="flex items-start justify-between gap-3">
                    <h1 className="text-3xl font-bold mb-3 text-fg">
                        {isRu ? 'Расписание КСТУ онлайн' : isKz ? 'KSTU кестесі онлайн' : 'KSTU schedule online'}
                    </h1>
                    <ShareLinkButton />
                </div>
                <p className="text-sm leading-6 text-secondary-fg">
                    {isRu
                        ? 'Страница для быстрого доступа к расписанию КСТУ. После входа вы получаете персональные пары, текущую чётность недели и обновления по учебному графику.'
                        : isKz
                            ? 'Бұл бет KSTU кестесіне жылдам қол жеткізу үшін жасалған. Кіргеннен кейін сіз жеке сабақтарыңызды, аптаның жұптылығын және оқу кестесіндегі жаңартуларды көресіз.'
                            : 'This page gives quick access to the KSTU schedule. After sign-in, you get personal classes, current week parity, and academic schedule updates.'}
                </p>
                <Link href="/login" className="btn btn-primary inline-flex mt-4 px-4 py-2 text-sm">
                    {isRu ? 'Войти и открыть расписание' : isKz ? 'Кіріп, кестені ашу' : 'Sign in and open schedule'}
                </Link>
            </section>

            <section className="card p-6 md:p-8">
                <h2 className="text-xl font-semibold mb-3 text-fg">
                    {isRu ? 'Преимущества' : isKz ? 'Артықшылықтары' : 'Advantages'}
                </h2>
                <ul className="space-y-2 text-sm text-secondary-fg">
                    {list.map((item) => <li key={item}>• {item}</li>)}
                </ul>
                <div className="grid sm:grid-cols-2 gap-3 mt-4 text-sm">
                    {['/kstu-raspisanie-par', '/raspisanie-zanyatii-kstu', '/vhod-univer-kstu', '/univer-kstu'].map((href, index) => (
                        <Link key={href} className="card p-3 hover:bg-white/5 transition-colors" href={href}>
                            {links[index]}
                        </Link>
                    ))}
                </div>
            </section>

            <section className="card p-6 md:p-8">
                <h2 className="text-xl font-semibold mb-3 text-fg">
                    {isRu ? 'Вопросы и ответы' : isKz ? 'Сұрақтар мен жауаптар' : 'Questions and answers'}
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
                    {isRu ? 'См. также:' : isKz ? 'Қараңыз:' : 'See also:'} <Link href="/univer-kstu">Univer KSTU</Link> {isRu ? 'и' : isKz ? 'және' : 'and'} <Link href="/univer">Univer</Link>
                </div>
            </section>
        </div>
    );
}
