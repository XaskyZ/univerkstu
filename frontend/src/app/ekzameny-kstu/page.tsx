import type { Metadata } from 'next';
import { getCanonicalSiteUrl } from '@/lib/site-url';
import { getLanguageLocale, getServerLanguage } from '@/lib/server-language';
import EkzamenyKstuContent from './EkzamenyKstuContent';

const siteUrl = getCanonicalSiteUrl();

function getSeoContent(language: 'ru' | 'kz' | 'en') {
  if (language === 'kz') {
    return {
      faq: [
        ['KSTU емтихандарын қайдан көруге болады?', 'Кіргеннен кейін "Емтихандар" бөлімін ашыңыз, онда пәндер, күндер және емтихан форматы көрінеді.'],
        ['Емтихандар бойынша жаңартуларды бақылауға бола ма?', 'Иә, деректер жаңарып отырады, ал қолданбада кесте мен емтихандарды қолмен жаңарту мүмкіндігі бар.'],
        ['Емтихандар үшін бөлек аккаунт керек пе?', 'Жоқ, кесте, бағалар және УӘКД үшін қолданылатын сол кіру пайдаланылады.'],
      ],
      name: 'KSTU емтихандары',
      description: 'KSTU емтихандары онлайн: студенттерге арналған күндер, пәндер және академиялық күнтізбе.',
      title: 'KSTU емтихандары - күндер мен пәндер онлайн',
      ogTitle: 'KSTU емтихандары',
      ogDescription: 'KSTU емтихандарын тексеріңіз: күндер, пәндер және тапсыру форматы бір жерде.',
      breadcrumbHome: 'Басты бет',
      breadcrumbCurrent: 'KSTU емтихандары',
    };
  }
  if (language === 'en') {
    return {
      faq: [
        ['Where can I view KSTU exams?', 'After signing in, open the "Exams" section where subjects, dates and exam format are shown.'],
        ['Can I track exam updates?', 'Yes, the data is updated, and the app also provides manual refresh for schedule and exams.'],
        ['Do I need a separate account for exams?', 'No, the same sign-in is used for schedule, grades and UMKD.'],
      ],
      name: 'KSTU exams',
      description: 'KSTU exams online: dates, subjects and academic calendar for students.',
      title: 'KSTU exams - dates and subjects online',
      ogTitle: 'KSTU exams',
      ogDescription: 'Check KSTU exams: dates, subjects and exam format in one place.',
      breadcrumbHome: 'Home',
      breadcrumbCurrent: 'KSTU exams',
    };
  }
  return {
    faq: [
      ['Где смотреть экзамены КСТУ?', 'После входа откройте раздел «Экзамены», где видны дисциплины, даты и формат экзамена.'],
      ['Можно ли отслеживать обновления по экзаменам?', 'Да, данные обновляются, а в приложении доступно ручное обновление расписания и экзаменов.'],
      ['Нужен отдельный аккаунт для экзаменов?', 'Нет, используется тот же вход, что и для расписания, оценок и УМКД.'],
    ],
    name: 'Экзамены КСТУ',
    description: 'Экзамены КСТУ онлайн: даты, дисциплины и академический календарь для студентов.',
    title: 'Экзамены КСТУ - даты и дисциплины онлайн',
    ogTitle: 'Экзамены КСТУ',
    ogDescription: 'Проверяйте экзамены КСТУ: даты, дисциплины и формат сдачи в одном месте.',
    breadcrumbHome: 'Главная',
    breadcrumbCurrent: 'Экзамены КСТУ',
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const language = await getServerLanguage();
  const seo = getSeoContent(language);
  return {
    title: seo.title,
    description: seo.description,
    alternates: {
      canonical: '/ekzameny-kstu',
    },
    openGraph: {
      title: seo.ogTitle,
      description: seo.ogDescription,
      url: `${siteUrl}/ekzameny-kstu`,
      locale: getLanguageLocale(language),
    },
  };
}

export default async function EkzamenyKstuPage() {
  const language = await getServerLanguage();
  const seo = getSeoContent(language);
  const webPageSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: seo.name,
    url: `${siteUrl}/ekzameny-kstu`,
    inLanguage: language,
    description: seo.description,
  };
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: seo.breadcrumbHome, item: `${siteUrl}/` },
      { '@type': 'ListItem', position: 2, name: seo.breadcrumbCurrent, item: `${siteUrl}/ekzameny-kstu` },
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />

      <EkzamenyKstuContent />
    </main>
  );
}
