'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/language-context';
import ShareLinkButton from '@/components/ShareLinkButton';

export default function OcenkiUniverKstuContent() {
    const { language } = useLanguage();
    const isRu = language === 'ru';
    const isKz = language === 'kz';

    const faq = isRu
        ? [
            ['Где смотреть оценки в Univer KSTU?', 'После входа откройте раздел «Оценки», где отображаются текущие баллы, дисциплины и GPA.'],
            ['Обновляются ли оценки автоматически?', 'Да, данные синхронизируются из учебной системы, также можно обновить вручную в интерфейсе.'],
            ['Показывается ли GPA?', 'Да, GPA доступен в разделе оценок вместе с динамикой и предметами.'],
        ]
        : isKz
            ? [
                ['Univer KSTU бағаларын қайдан көруге болады?', 'Кіргеннен кейін «Бағалар» бөлімін ашыңыз, онда ағымдағы баллдар, пәндер және GPA көрсетіледі.'],
                ['Бағалар автоматты түрде жаңара ма?', 'Иә, деректер оқу жүйесінен синхрондалады, қажет болса интерфейстен қолмен де жаңартуға болады.'],
                ['GPA көрсетіле ме?', 'Иә, GPA бағалар бөлімінде динамикамен және пәндермен бірге қолжетімді.'],
            ]
            : [
                ['Where can I view grades in Univer KSTU?', 'After signing in, open the “Grades” section where current scores, subjects, and GPA are shown.'],
                ['Are grades updated automatically?', 'Yes, data is synced from the academic system, and you can also refresh it manually in the interface.'],
                ['Is GPA shown?', 'Yes, GPA is available in the grades section together with dynamics and subjects.'],
            ];

    const list = isRu
        ? ['Текущие оценки по дисциплинам.', 'История успеваемости.', 'Итоговый GPA.', 'Быстрый доступ к связанным разделам.']
        : isKz
            ? ['Пәндер бойынша ағымдағы бағалар.', 'Үлгерім тарихы.', 'Қорытынды GPA.', 'Байланысты бөлімдерге жылдам өту.']
            : ['Current grades by subject.', 'Academic performance history.', 'Final GPA.', 'Quick access to related sections.'];

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <section className="card p-6 md:p-8">
                <div className="flex items-start justify-between gap-3">
                    <h1 className="text-3xl font-bold mb-3 text-fg">
                        {isRu ? 'Оценки Univer KSTU: баллы и GPA' : isKz ? 'Univer KSTU бағалары: баллдар мен GPA' : 'Univer KSTU grades: scores and GPA'}
                    </h1>
                    <ShareLinkButton />
                </div>
                <p className="text-sm leading-6 text-secondary-fg">
                    {isRu
                        ? 'Страница создана под запросы «оценки univer kstu» и «gpa kstu». Здесь можно быстро перейти во вход и открыть раздел с оценками, дисциплинами и академическим прогрессом.'
                        : isKz
                            ? 'Бұл бет «оценки univer kstu» және «gpa kstu» сұраныстарына арналған. Осы жерден кіруге өтіп, бағалар, пәндер және академиялық прогресс бөлімін аша аласыз.'
                            : 'This page is built for queries like “Univer KSTU grades” and “KSTU GPA”. From here you can quickly sign in and open the section with grades, subjects, and academic progress.'}
                </p>
                <Link href="/login" className="btn btn-primary inline-flex mt-4 px-4 py-2 text-sm">
                    {isRu ? 'Перейти к оценкам' : isKz ? 'Бағаларға өту' : 'Open grades'}
                </Link>
            </section>

            <section className="card p-6 md:p-8">
                <h2 className="text-xl font-semibold mb-3 text-fg">
                    {isRu ? 'Что видно в разделе оценок' : isKz ? 'Бағалар бөлімінде не көрінеді' : 'What you can see in grades'}
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
                    {isRu ? 'См. также:' : isKz ? 'Қараңыз:' : 'See also:'} <Link href="/ekzameny-kstu">{isRu ? 'экзамены КСТУ' : isKz ? 'KSTU емтихандары' : 'KSTU exams'}</Link>, <Link href="/univer-kstu">Univer KSTU</Link>.
                </div>
            </section>
        </div>
    );
}
