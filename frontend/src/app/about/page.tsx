import type { Metadata } from 'next';
import { getCanonicalSiteUrl } from '@/lib/site-url';
import { getLanguageLocale, getServerLanguage } from '@/lib/server-language';
import { AboutContent } from './AboutContent';

const siteUrl = getCanonicalSiteUrl();

export function getSeoContent(language: 'ru' | 'kz' | 'en') {
    if (language === 'kz') {
        return {
            title: 'UniverSchedule жобасы туралы',
            description: 'UniverSchedule KSTU студенттеріне кестені, бағаларды, емтихандарды және УӘКД-ні бір интерфейсте көруге көмектеседі.',
            ogTitle: 'UniverSchedule жобасы туралы',
            ogDescription: 'KSTU студенттеріне арналған сервис: кесте, бағалар, емтихандар және УӘКД бір жерде.',
        };
    }
    if (language === 'en') {
        return {
            title: 'About UniverSchedule',
            description: 'UniverSchedule helps KSTU students view schedule, grades, exams and UMKD in a single interface.',
            ogTitle: 'About UniverSchedule',
            ogDescription: 'A service for KSTU students: schedule, grades, exams and UMKD in one place.',
        };
    }
    return {
        title: 'О проекте UniverSchedule',
        description: 'UniverSchedule помогает студентам КСТУ смотреть расписание, оценки, экзамены и УМКД в одном интерфейсе.',
        ogTitle: 'О проекте UniverSchedule',
        ogDescription: 'Сервис для студентов КСТУ: расписание, оценки, экзамены и УМКД в одном месте.',
    };
}

export async function generateMetadata(): Promise<Metadata> {
    const language = await getServerLanguage();
    const seo = getSeoContent(language);
    return {
        title: seo.title,
        description: seo.description,
        alternates: {
            canonical: '/about',
        },
        openGraph: {
            title: seo.ogTitle,
            description: seo.ogDescription,
            url: `${siteUrl}/about`,
            locale: getLanguageLocale(language),
        },
    };
}

export default function AboutPage() {
    return <AboutContent />;
}
