import type { Metadata } from 'next';
import { getCanonicalSiteUrl } from '@/lib/site-url';
import { getLanguageLocale, getServerLanguage } from '@/lib/server-language';
import UniverKstuContent from './UniverKstuContent';

const siteUrl = getCanonicalSiteUrl();

function getSeoContent(language: 'ru' | 'kz' | 'en') {
    if (language === 'kz') {
        return {
            faq: [
                ['Univer KSTU деген не?', 'UniverSchedule — KSTU оқу деректерімен жұмыс істеуге арналған ыңғайлы интерфейс: кесте, емтихандар, бағалар және УӘКД.'],
                ['Жаңа аккаунт құру керек пе?', 'Жоқ. Кіру сіздің бар KSTU/Platonus деректеріңіз арқылы орындалады.'],
                ['Телефоннан пайдалануға бола ма?', 'Иә, сервис мобильді құрылғыларға және күнделікті қолдануға бейімделген.'],
            ],
            title: 'Univer KSTU - кіру, кесте, бағалар және емтихандар',
            description: 'KSTU студенттеріне арналған Univer KSTU: жылдам кіру, кесте, бағалар, емтихандар және УӘКД бір ыңғайлы сервисте.',
            ogTitle: 'Univer KSTU - кіру және оқу бөлімдері',
            ogDescription: 'KSTU оқу деректеріне жеке қолжетімділік: кесте, бағалар, емтихандар және УӘКД.',
            breadcrumbHome: 'Басты бет',
        };
    }
    if (language === 'en') {
        return {
            faq: [
                ['What is Univer KSTU?', 'UniverSchedule is a convenient interface for working with KSTU academic data: schedule, exams, grades and UMKD.'],
                ['Do I need to create a new account?', 'No. Sign-in uses your existing KSTU/Platonus credentials.'],
                ['Can I use it on a phone?', 'Yes, the service is adapted for mobile devices and daily use.'],
            ],
            title: 'Univer KSTU - login, schedule, grades and exams',
            description: 'Univer KSTU for students: quick login, schedule, grades, exams and UMKD in one convenient service.',
            ogTitle: 'Univer KSTU - login and academic sections',
            ogDescription: 'Personal access to KSTU academic data: schedule, grades, exams and UMKD.',
            breadcrumbHome: 'Home',
        };
    }
    return {
        faq: [
            ['Что такое Univer KSTU?', 'UniverSchedule — это удобный интерфейс для работы с учебными данными КСТУ: расписание, экзамены, оценки и УМКД.'],
            ['Нужно ли создавать новый аккаунт?', 'Нет. Вход выполняется с вашими существующими учётными данными KSTU/Platonus.'],
            ['Можно ли пользоваться с телефона?', 'Да, сервис адаптирован под мобильные устройства и ежедневное использование.'],
        ],
        title: 'Univer KSTU - вход, расписание, оценки и экзамены',
        description: 'Univer KSTU для студентов: быстрый вход, расписание, оценки, экзамены и УМКД в одном удобном сервисе.',
        ogTitle: 'Univer KSTU - вход и учебные разделы',
        ogDescription: 'Персональный доступ к учебным данным КСТУ: расписание, оценки, экзамены и УМКД.',
        breadcrumbHome: 'Главная',
    };
}

export async function generateMetadata(): Promise<Metadata> {
    const language = await getServerLanguage();
    const seo = getSeoContent(language);
    return {
        title: seo.title,
        description: seo.description,
        alternates: {
            canonical: '/univer-kstu',
        },
        openGraph: {
            title: seo.ogTitle,
            description: seo.ogDescription,
            url: `${siteUrl}/univer-kstu`,
            locale: getLanguageLocale(language),
        },
    };
}

export default async function UniverKstuPage() {
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
        url: `${siteUrl}/univer-kstu`,
        inLanguage: language,
    };
    const breadcrumbSchema = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: seo.breadcrumbHome, item: `${siteUrl}/` },
            { '@type': 'ListItem', position: 2, name: 'Univer KSTU', item: `${siteUrl}/univer-kstu` },
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

            <UniverKstuContent />
        </main>
    );
}
