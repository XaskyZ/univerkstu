import type { Metadata } from 'next';
import { getCanonicalSiteUrl } from '@/lib/site-url';
import { getLanguageLocale, getServerLanguage } from '@/lib/server-language';
import RaspisanieKstuContent from './RaspisanieKstuContent';

const siteUrl = getCanonicalSiteUrl();

function getSeoContent(language: 'ru' | 'kz' | 'en') {
    if (language === 'kz') {
        return {
            faq: [
                ['KSTU кестесін онлайн қайдан көруге болады?', 'UniverSchedule ішінде кіргеннен кейін топ пен аптаның жұптылығы ескерілген жеке кесте қолжетімді болады.'],
                ['Кесте қаншалықты жиі жаңартылады?', 'Қолданба деректерді үнемі синхрондайды және кестені қолмен жаңартуға мүмкіндік береді.'],
                ['Телефоннан көруге бола ма?', 'Иә, кесте беті мобильді экранға бейімделген.'],
            ],
            title: 'KSTU кестесі онлайн - сабақтар, аудиториялар, оқытушылар',
            description: 'KSTU кестесі онлайн: сабақтар, аптаның жұптылығы, аудиториялар және оқытушылар. Телефон мен компьютерден жылдам қолжетімділік.',
            ogTitle: 'KSTU кестесі онлайн - сабақтар мен апталар',
            ogDescription: 'KSTU кестесін ыңғайлы қарау: сабақтар, уақыт, аптаның жұптылығы, оқытушылар.',
            breadcrumbHome: 'Басты бет',
            breadcrumbCurrent: 'KSTU кестесі',
        };
    }
    if (language === 'en') {
        return {
            faq: [
                ['Where can I view the KSTU schedule online?', 'After signing in to UniverSchedule, you get a personal schedule based on your group and week parity.'],
                ['How often is the schedule updated?', 'The app syncs data regularly and also lets you refresh the schedule manually.'],
                ['Is there a mobile version?', 'Yes, the schedule page is adapted for mobile screens.'],
            ],
            title: 'KSTU schedule online - classes, rooms, teachers',
            description: 'KSTU schedule online: classes, week parity, rooms and teachers. Quick access for students on phone and desktop.',
            ogTitle: 'KSTU schedule online - classes and weeks',
            ogDescription: 'A convenient way to view the KSTU schedule: classes, time, week parity and teachers.',
            breadcrumbHome: 'Home',
            breadcrumbCurrent: 'KSTU schedule',
        };
    }
    return {
        faq: [
            ['Где посмотреть расписание КСТУ онлайн?', 'В UniverSchedule после входа доступно персональное расписание с учётом группы и чётности недели.'],
            ['Как часто обновляется расписание?', 'Приложение регулярно синхронизирует данные и позволяет обновить расписание вручную.'],
            ['Есть ли расписание на телефоне?', 'Да, страница расписания адаптирована под мобильный экран.'],
        ],
        title: 'Расписание КСТУ онлайн - пары, аудитории, преподаватели',
        description: 'Расписание КСТУ онлайн: пары, чётность недели, аудитории и преподаватели. Быстрый доступ для студентов с телефона и ПК.',
        ogTitle: 'Расписание КСТУ онлайн - пары и недели',
        ogDescription: 'Удобный просмотр расписания КСТУ: пары, время, чётность недели, преподаватели.',
        breadcrumbHome: 'Главная',
        breadcrumbCurrent: 'Расписание КСТУ',
    };
}

export async function generateMetadata(): Promise<Metadata> {
    const language = await getServerLanguage();
    const seo = getSeoContent(language);
    return {
        title: seo.title,
        description: seo.description,
        alternates: {
            canonical: '/raspisanie-kstu',
        },
        openGraph: {
            title: seo.ogTitle,
            description: seo.ogDescription,
            url: `${siteUrl}/raspisanie-kstu`,
            locale: getLanguageLocale(language),
        },
    };
}

export default async function RaspisanieKstuPage() {
    const language = await getServerLanguage();
    const seo = getSeoContent(language);
    const websiteSchema = {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'UniverSchedule',
        url: siteUrl,
        inLanguage: language,
    };
    const appSchema = {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'UniverSchedule',
        applicationCategory: 'EducationalApplication',
        operatingSystem: 'Web',
        url: `${siteUrl}/raspisanie-kstu`,
        inLanguage: language,
    };
    const breadcrumbSchema = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: seo.breadcrumbHome, item: `${siteUrl}/` },
            { '@type': 'ListItem', position: 2, name: seo.breadcrumbCurrent, item: `${siteUrl}/raspisanie-kstu` },
        ],
    };
    const faqSchema = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: seo.faq.map(([question, answer]) => ({
            '@type': 'Question',
            name: question,
            acceptedAnswer: {
                '@type': 'Answer',
                text: answer,
            },
        })),
    };
    return (
        <main className="min-h-screen px-4 py-8">
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }} />
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(appSchema) }} />
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />

            <RaspisanieKstuContent />
        </main>
    );
}
