import type { Metadata } from 'next';
import { getCanonicalSiteUrl } from '@/lib/site-url';
import { getLanguageLocale, getServerLanguage } from '@/lib/server-language';
import RaspisanieZanyatiiKstuContent from './RaspisanieZanyatiiKstuContent';

const siteUrl = getCanonicalSiteUrl();

function getSeoContent(language: 'ru' | 'kz' | 'en') {
  if (language === 'kz') {
    return {
      faq: [
        ['Сабақ кестесі мен жұптар кестесінің айырмасы қандай?', 'Негізі бұл бір бөлім: кестеде оқу сабақтары, уақыт және әр пән бойынша мәліметтер көрсетіледі.'],
        ['KSTU кестесін телефоннан көруге бола ма?', 'Иә, бет толықтай мобильді құрылғыларға бейімделген және қолданбаны орнатпай-ақ ашылады.'],
        ['Өз тобыма арналған кестені қайдан табамын?', 'Кіргеннен кейін жүйе сіздің аккаунтыңыз бен оқу тобыңызға арналған жеке деректерді көрсетеді.'],
      ],
      name: 'KSTU сабақ кестесі',
      description: 'KSTU сабақ кестесі: студенттерге арналған жұптар, уақыт, аудиториялар және оқытушылар.',
      title: 'KSTU сабақ кестесі - студенттерге онлайн',
      ogTitle: 'KSTU сабақ кестесі',
      ogDescription: 'KSTU сабақ кестесін ыңғайлы интерфейсте онлайн тексеріңіз.',
      breadcrumbHome: 'Басты бет',
      breadcrumbCurrent: 'KSTU сабақ кестесі',
    };
  }
  if (language === 'en') {
    return {
      faq: [
        ['What is the difference between the class schedule and lessons?', 'In practice it is the same section: it shows study classes, times and details for each subject.'],
        ['Is there a KSTU schedule for phones?', 'Yes, the page is fully optimized for mobile and opens without installing the app.'],
        ['Where can I find the schedule for my own group?', 'After signing in, the system shows personal data for your account and your study group.'],
      ],
      name: 'KSTU class schedule',
      description: 'KSTU class schedule: classes, time, rooms and teachers for students.',
      title: 'KSTU class schedule - online for students',
      ogTitle: 'KSTU class schedule',
      ogDescription: 'Check the KSTU class schedule online in a convenient interface.',
      breadcrumbHome: 'Home',
      breadcrumbCurrent: 'KSTU class schedule',
    };
  }
  return {
    faq: [
      ['Чем отличается расписание занятий от пар?', 'По сути это один раздел: в расписании показываются учебные пары, время и детали по каждой дисциплине.'],
      ['Есть ли расписание КСТУ на телефоне?', 'Да, страница полностью адаптирована для мобильного и открывается без установки приложения.'],
      ['Где найти расписание конкретно своей группы?', 'После входа система показывает персональные данные по вашему аккаунту и вашей учебной группе.'],
    ],
    name: 'Расписание занятий КСТУ',
    description: 'Расписание занятий КСТУ: пары, время, аудитории и преподаватели.',
    title: 'Расписание занятий КСТУ - онлайн для студентов',
    ogTitle: 'Расписание занятий КСТУ',
    ogDescription: 'Проверяйте расписание занятий КСТУ онлайн в удобном интерфейсе.',
    breadcrumbHome: 'Главная',
    breadcrumbCurrent: 'Расписание занятий КСТУ',
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const language = await getServerLanguage();
  const seo = getSeoContent(language);
  return {
    title: seo.title,
    description: seo.description,
    alternates: {
      canonical: '/raspisanie-zanyatii-kstu',
    },
    openGraph: {
      title: seo.ogTitle,
      description: seo.ogDescription,
      url: `${siteUrl}/raspisanie-zanyatii-kstu`,
      locale: getLanguageLocale(language),
    },
  };
}

export default async function RaspisanieZanyatiiKstuPage() {
  const language = await getServerLanguage();
  const seo = getSeoContent(language);
  const webPageSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: seo.name,
    url: `${siteUrl}/raspisanie-zanyatii-kstu`,
    inLanguage: language,
    description: seo.description,
  };
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: seo.breadcrumbHome, item: `${siteUrl}/` },
      { '@type': 'ListItem', position: 2, name: seo.breadcrumbCurrent, item: `${siteUrl}/raspisanie-zanyatii-kstu` },
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

      <RaspisanieZanyatiiKstuContent />
    </main>
  );
}
