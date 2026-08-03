'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/language-context';
import ShareLinkButton from '@/components/ShareLinkButton';

export default function KstuRaspisanieParContent() {
    const { language } = useLanguage();
    const isRu = language === 'ru';
    const isKz = language === 'kz';

    const faq = isRu
        ? [
            ['Где посмотреть пары КСТУ на сегодня?', 'После входа в UniverSchedule откройте расписание: там есть пары по дням, времени, аудиториям и преподавателям.'],
            ['Учитывается ли числитель и знаменатель?', 'Да, расписание показывает чётность недели и меняет пары под текущий учебный цикл.'],
            ['Можно ли быстро обновить данные?', 'Да, в интерфейсе есть обновление и кеш обновляется без сложных действий.'],
        ]
        : isKz
            ? [
                ['Бүгінгі KSTU жұптарын қайдан көруге болады?', 'UniverSchedule ішіне кіргеннен кейін кестені ашыңыз: онда күндер, уақыт, аудиториялар мен оқытушылар көрсетіледі.'],
                ['Алым мен бөлім ескеріле ме?', 'Иә, кесте аптаның жұптылығын көрсетіп, ағымдағы оқу цикліне сай сабақтарды ауыстырады.'],
                ['Деректерді тез жаңартуға бола ма?', 'Иә, интерфейсте жаңарту бар және кэш күрделі әрекеттерсіз жаңарады.'],
            ]
            : [
                ['Where can I view KSTU classes for today?', 'After signing in to UniverSchedule, open the schedule: it shows classes by day, time, rooms, and teachers.'],
                ['Does it account for week parity?', 'Yes, the schedule shows week parity and switches classes for the current study cycle.'],
                ['Can I refresh the data quickly?', 'Yes, the interface includes refresh and the cache updates without extra steps.'],
            ];

    const list = isRu
        ? ['Пары на день и неделю.', 'Номер пары и точное время.', 'Преподаватель и аудитория.', 'Числитель/знаменатель.']
        : isKz
            ? ['Күн мен аптаға арналған сабақтар.', 'Жұп нөмірі және нақты уақыты.', 'Оқытушы және аудитория.', 'Алым/бөлім.']
            : ['Classes for the day and week.', 'Class number and exact time.', 'Teacher and room.', 'Week parity.'];

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <section className="card p-6 md:p-8">
                <div className="flex items-start justify-between gap-3">
                    <h1 className="text-3xl font-bold mb-3 text-fg">
                        {isRu ? 'Пары КСТУ: расписание занятий по дням' : isKz ? 'KSTU жұптары: күндер бойынша сабақ кестесі' : 'KSTU classes: daily schedule'}
                    </h1>
                    <ShareLinkButton />
                </div>
                <p className="text-sm leading-6 text-secondary-fg">
                    {isRu
                        ? 'Страница отвечает на запросы «пары ксту» и «расписание пар». После входа вы видите точное расписание по вашему аккаунту, включая чётность недели и изменения.'
                        : isKz
                            ? 'Бұл бет «пары ксту» және «расписание пар» сұраныстарына арналған. Кіргеннен кейін сіз өз аккаунтыңыз бойынша нақты кестені, аптаның жұптылығын және өзгерістерді көресіз.'
                            : 'This page targets queries like “KSTU classes” and “class schedule”. After signing in, you see the exact schedule for your account, including week parity and changes.'}
                </p>
                <Link href="/login" className="btn btn-primary inline-flex mt-4 px-4 py-2 text-sm">
                    {isRu ? 'Смотреть пары' : isKz ? 'Жұптарды көру' : 'View classes'}
                </Link>
            </section>

            <section className="card p-6 md:p-8">
                <h2 className="text-xl font-semibold mb-3 text-fg">
                    {isRu ? 'Что есть в расписании' : isKz ? 'Кестеде не бар' : 'What the schedule includes'}
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
                    {isRu ? 'См. также:' : isKz ? 'Қараңыз:' : 'See also:'} <Link href="/raspisanie-kstu">{isRu ? 'расписание КСТУ' : isKz ? 'KSTU кестесі' : 'KSTU schedule'}</Link>, <Link href="/raspisanie-zanyatii-kstu">{isRu ? 'расписание занятий' : isKz ? 'сабақ кестесі' : 'class schedule'}</Link>.
                </div>
            </section>
        </div>
    );
}
