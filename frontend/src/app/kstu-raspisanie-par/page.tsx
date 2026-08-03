import type { Metadata } from 'next';
import { getCanonicalSiteUrl } from '@/lib/site-url';
import { getLanguageLocale, getServerLanguage } from '@/lib/server-language';
import KstuRaspisanieParContent from './KstuRaspisanieParContent';

const siteUrl = getCanonicalSiteUrl();

function getSeoContent(language: 'ru' | 'kz' | 'en') {
  if (language === 'kz') {
    return {
      faq: [
        ['KSTU жұптарын бүгін қайдан көруге болады?', 'UniverSchedule ішінде кіргеннен кейін кестені ашыңыз: онда күндер, уақыт, аудиториялар және оқытушылар бойынша сабақтар бар.'],
        ['Алым мен бөлім ескеріле ме?', 'Иә, кесте аптаның жұптылығын көрсетеді және сабақтарды ағымдағы оқу цикліне қарай бейімдейді.'],
        ['Деректерді тез жаңартуға бола ма?', 'Иә, интерфейсте жаңарту бар және кэш күрделі әрекеттерсіз жаңартылады.'],
      ],
      name: 'KSTU жұптары',
      description: 'KSTU жұптары онлайн: сабақ кестесі, уақыт, аудиториялар және оқытушылар.',
      title: 'KSTU жұптары онлайн - күндер бойынша сабақ кестесі',
      ogTitle: 'KSTU жұптары онлайн',
      ogDescription: 'KSTU жұптарының кестесін күндер мен апталар бойынша ыңғайлы интерфейсте тексеріңіз.',
      breadcrumbHome: 'Басты бет',
      breadcrumbCurrent: 'KSTU жұптары',
    };
  }
  if (language === 'en') {
    return {
      faq: [
        ['Where can I check KSTU lessons for today?', 'After signing in to UniverSchedule, open the schedule: it shows classes by day, time, room and teacher.'],
        ['Does it account for numerator and denominator weeks?', 'Yes, the schedule shows week parity and adjusts classes for the current academic cycle.'],
        ['Can I refresh the data quickly?', 'Yes, the interface has a refresh action and the cache updates without complex steps.'],
      ],
      name: 'KSTU lessons',
      description: 'KSTU lessons online: class schedule, time, rooms and teachers.',
      title: 'KSTU lessons online - class schedule by day',
      ogTitle: 'KSTU lessons online',
      ogDescription: 'Check the KSTU lesson schedule by days and weeks in a convenient interface.',
      breadcrumbHome: 'Home',
      breadcrumbCurrent: 'KSTU lessons',
    };
  }
  return {
    faq: [
      ['Где посмотреть пары КСТУ на сегодня?', 'После входа в UniverSchedule откройте расписание: там есть пары по дням, времени, аудиториям и преподавателям.'],
      ['Учитывается ли числитель и знаменатель?', 'Да, расписание показывает чётность недели и меняет пары под текущий учебный цикл.'],
      ['Можно ли быстро обновить данные?', 'Да, в интерфейсе есть обновление и кеш обновляется без сложных действий.'],
    ],
    name: 'Пары КСТУ',
    description: 'Пары КСТУ онлайн: расписание занятий, время, аудитории и преподаватели.',
    title: 'Пары КСТУ онлайн - расписание занятий по дням',
    ogTitle: 'Пары КСТУ онлайн',
    ogDescription: 'Проверяйте расписание пар КСТУ по дням и неделям в удобном интерфейсе.',
    breadcrumbHome: 'Главная',
    breadcrumbCurrent: 'Пары КСТУ',
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const language = await getServerLanguage();
  const seo = getSeoContent(language);
  return {
    title: seo.title,
    description: seo.description,
    alternates: {
      canonical: '/kstu-raspisanie-par',
    },
    openGraph: {
      title: seo.ogTitle,
      description: seo.ogDescription,
      url: `${siteUrl}/kstu-raspisanie-par`,
      locale: getLanguageLocale(language),
    },
  };
}

export default async function KstuRaspisanieParPage() {
  const language = await getServerLanguage();
  const seo = getSeoContent(language);
  const webPageSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: seo.name,
    url: `${siteUrl}/kstu-raspisanie-par`,
    inLanguage: language,
    description: seo.description,
  };
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: seo.breadcrumbHome, item: `${siteUrl}/` },
      { '@type': 'ListItem', position: 2, name: seo.breadcrumbCurrent, item: `${siteUrl}/kstu-raspisanie-par` },
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

      <KstuRaspisanieParContent />
    </main>
  );
}
