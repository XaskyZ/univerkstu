import type { Metadata } from 'next';
import { getCanonicalSiteUrl } from '@/lib/site-url';
import { getLanguageLocale, getServerLanguage } from '@/lib/server-language';
import OcenkiUniverKstuContent from './OcenkiUniverKstuContent';

const siteUrl = getCanonicalSiteUrl();

function getSeoContent(language: 'ru' | 'kz' | 'en') {
  if (language === 'kz') {
    return {
      faq: [
        ['Univer KSTU бағаларын қайдан көруге болады?', 'Кіргеннен кейін "Бағалар" бөлімін ашыңыз, онда ағымдағы балдар, пәндер және GPA көрсетіледі.'],
        ['Бағалар автоматты түрде жаңара ма?', 'Иә, деректер оқу жүйесінен синхрондалады, сондай-ақ интерфейсте қолмен жаңартуға болады.'],
        ['GPA көрсетіле ме?', 'Иә, GPA бағалар бөлімінде динамикамен және пәндермен бірге қолжетімді.'],
      ],
      name: 'Univer KSTU бағалары',
      description: 'Univer KSTU бағалары: KSTU студенттеріне арналған пәндер, балдар және GPA.',
      title: 'Univer KSTU бағалары - балдар мен GPA онлайн',
      ogTitle: 'Univer KSTU бағалары',
      ogDescription: 'KSTU студенттеріне арналған бағалар, балдар және GPA ыңғайлы форматта.',
      breadcrumbHome: 'Басты бет',
      breadcrumbCurrent: 'Univer KSTU бағалары',
    };
  }
  if (language === 'en') {
    return {
      faq: [
        ['Where can I view grades in Univer KSTU?', 'After signing in, open the "Grades" section where current scores, subjects and GPA are shown.'],
        ['Are grades updated automatically?', 'Yes, the data is synced from the academic system, and you can also refresh it manually in the interface.'],
        ['Is GPA displayed?', 'Yes, GPA is available in the grades section together with dynamics and subjects.'],
      ],
      name: 'Univer KSTU grades',
      description: 'Univer KSTU grades: subjects, scores and GPA for KSTU students.',
      title: 'Univer KSTU grades - scores and GPA online',
      ogTitle: 'Univer KSTU grades',
      ogDescription: 'Grades, scores and GPA for KSTU students in a convenient format.',
      breadcrumbHome: 'Home',
      breadcrumbCurrent: 'Univer KSTU grades',
    };
  }
  return {
    faq: [
      ['Где смотреть оценки в Univer KSTU?', 'После входа откройте раздел «Оценки», где отображаются текущие баллы, дисциплины и GPA.'],
      ['Обновляются ли оценки автоматически?', 'Да, данные синхронизируются из учебной системы, также можно обновить вручную в интерфейсе.'],
      ['Показывается ли GPA?', 'Да, GPA доступен в разделе оценок вместе с динамикой и предметами.'],
    ],
    name: 'Оценки Univer KSTU',
    description: 'Оценки Univer KSTU: предметы, баллы и GPA для студентов КСТУ.',
    title: 'Оценки Univer KSTU - баллы и GPA онлайн',
    ogTitle: 'Оценки Univer KSTU',
    ogDescription: 'Оценки, баллы и GPA для студентов КСТУ в удобном формате.',
    breadcrumbHome: 'Главная',
    breadcrumbCurrent: 'Оценки Univer KSTU',
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const language = await getServerLanguage();
  const seo = getSeoContent(language);
  return {
    title: seo.title,
    description: seo.description,
    alternates: {
      canonical: '/ocenki-univer-kstu',
    },
    openGraph: {
      title: seo.ogTitle,
      description: seo.ogDescription,
      url: `${siteUrl}/ocenki-univer-kstu`,
      locale: getLanguageLocale(language),
    },
  };
}

export default async function OcenkiUniverKstuPage() {
  const language = await getServerLanguage();
  const seo = getSeoContent(language);
  const webPageSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: seo.name,
    url: `${siteUrl}/ocenki-univer-kstu`,
    inLanguage: language,
    description: seo.description,
  };
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: seo.breadcrumbHome, item: `${siteUrl}/` },
      { '@type': 'ListItem', position: 2, name: seo.breadcrumbCurrent, item: `${siteUrl}/ocenki-univer-kstu` },
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

      <OcenkiUniverKstuContent />
    </main>
  );
}
