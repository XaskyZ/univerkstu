import type { Metadata } from 'next';
import { getCanonicalSiteUrl } from '@/lib/site-url';
import { getLanguageLocale, getServerLanguage } from '@/lib/server-language';
import UniverContent from './UniverContent';

const siteUrl = getCanonicalSiteUrl();

function getSeoContent(language: 'ru' | 'kz' | 'en') {
    if (language === 'kz') {
        return {
            faq: [
                ['Univer арқылы не істеуге болады?', 'UniverSchedule арқылы жеке кестені ашуға, емтихандарды, бағаларды және оқу материалдарын тексеруге болады.'],
                ['Бұл сервис кімге арналған?', 'Сервис оқу ақпаратына жылдам қол жеткізу керек KSTU студенттеріне арналған.'],
                ['Неден бастау керек?', 'Кіру бетіне өтіп, өз деректеріңізбен авторизациядан өтіңіз.'],
            ],
            title: 'Univer KSTU - кіру, кесте, бағалар және УӘКД',
            description: 'KSTU студенттеріне арналған Univer: кіру, кесте, бағалар, емтихандар және УӘКД бір платформада.',
            ogTitle: 'Univer KSTU - жеке оқу кабинеті',
            ogDescription: 'UniverSchedule ішінде кестеге, емтихандарға, бағаларға және УӘКД-ге жылдам қол жеткізу.',
            breadcrumbHome: 'Басты бет',
        };
    }
    if (language === 'en') {
        return {
            faq: [
                ['What can you do through Univer?', 'With UniverSchedule you can open your personal schedule, check exams, grades and study materials.'],
                ['Who is this service for?', 'The service is aimed at KSTU students who need quick access to academic information.'],
                ['How do I get started?', 'Go to the login page and sign in with your credentials.'],
            ],
            title: 'Univer KSTU - login, schedule, grades and UMKD',
            description: 'Univer for KSTU students: login, schedule, grades, exams and UMKD on one platform.',
            ogTitle: 'Univer KSTU - personal academic cabinet',
            ogDescription: 'Quick access to schedule, exams, grades and UMKD in UniverSchedule.',
            breadcrumbHome: 'Home',
        };
    }
    return {
        faq: [
            ['Что можно сделать через Univer?', 'Через UniverSchedule можно открыть личное расписание, проверить экзамены, оценки и учебные материалы.'],
            ['Для кого этот сервис?', 'Сервис ориентирован на студентов КСТУ, которым нужен быстрый доступ к учебной информации.'],
            ['С чего начать?', 'Перейдите на страницу входа и авторизуйтесь с вашими учетными данными.'],
        ],
        title: 'Univer КСТУ - вход, расписание, оценки и УМКД',
        description: 'Univer для студентов КСТУ: вход, расписание, оценки, экзамены и УМКД на одной платформе.',
        ogTitle: 'Univer КСТУ - личный учебный кабинет',
        ogDescription: 'Быстрый доступ к расписанию, экзаменам, оценкам и УМКД в UniverSchedule.',
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
            canonical: '/univer',
        },
        openGraph: {
            title: seo.ogTitle,
            description: seo.ogDescription,
            url: `${siteUrl}/univer`,
            locale: getLanguageLocale(language),
        },
    };
}

export default async function UniverPage() {
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
        url: `${siteUrl}/univer`,
        inLanguage: language,
    };
    const breadcrumbSchema = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: seo.breadcrumbHome, item: `${siteUrl}/` },
            { '@type': 'ListItem', position: 2, name: 'Univer', item: `${siteUrl}/univer` },
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

            <UniverContent />
        </main>
    );
}
