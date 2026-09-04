import type { Metadata } from 'next';
import { getCanonicalSiteUrl } from '@/lib/site-url';
import { getLanguageLocale, getServerLanguage } from '@/lib/server-language';
import VhodUniverKstuContent from './VhodUniverKstuContent';

const siteUrl = getCanonicalSiteUrl();

function getSeoContent(language: 'ru' | 'kz' | 'en') {
  if (language === 'kz') {
    return {
      faq: [
        ['Univer KSTU-ге қатесіз қалай кіруге болады?', 'Кіру бетін ашып, Platonus (platonus.kstu.kz) логині мен құпиясөзін қолданыңыз, содан кейін интерфейс тілін тексеріңіз.'],
        ['Кіргеннен кейін кестені қайдан көруге болады?', 'Авторизациядан кейін жеке кесте ашылады: күн, апта, аудиториялар, оқытушылар және алым/бөлім өзгерістері.'],
        ['Телефоннан кіруге бола ма?', 'Иә, кіру және әрі қарай кестемен, бағалармен және УӘКД-мен жұмыс мобильді браузерде қолжетімді.'],
      ],
      name: 'Univer KSTU-ге кіру',
      description: 'KSTU студенттеріне арналған Univer KSTU-ге кіру: кесте, бағалар, емтихандар және УӘКД бір сервисте.',
      title: 'Univer KSTU-ге кіру - студенттің жеке кабинеті онлайн',
      ogTitle: 'Univer KSTU-ге кіру - студенттің жеке кабинеті',
      ogDescription: 'Univer KSTU-ге кіріп, кестеге, бағаларға, емтихандарға және УӘКД-ге қол жеткізіңіз.',
      breadcrumbHome: 'Басты бет',
      breadcrumbCurrent: 'Univer KSTU-ге кіру',
    };
  }
  if (language === 'en') {
    return {
      faq: [
        ['How do I sign in to Univer KSTU without errors?', 'Open the login page, use your Platonus (platonus.kstu.kz) login and password, then check the interface language.'],
        ['Where can I view the schedule after signing in?', 'After authorization, your personal schedule opens: day, week, rooms, teachers and numerator/denominator changes.'],
        ['Can I sign in from a phone?', 'Yes, sign-in and further work with schedule, grades and UMKD are available from a mobile browser.'],
      ],
      name: 'Univer KSTU login',
      description: 'Univer KSTU login for students: schedule, grades, exams and UMKD in one service.',
      title: 'Univer KSTU login - student account online',
      ogTitle: 'Univer KSTU login - student account',
      ogDescription: 'Open Univer KSTU login and get access to schedule, grades, exams and UMKD.',
      breadcrumbHome: 'Home',
      breadcrumbCurrent: 'Univer KSTU login',
    };
  }
  return {
    faq: [
      ['Как войти в Univer KSTU без ошибок?', 'Откройте страницу входа, используйте логин и пароль от Platonus (platonus.kstu.kz), затем проверьте язык интерфейса.'],
      ['Где после входа смотреть расписание?', 'После авторизации откроется персональное расписание: день, неделя, аудитории, преподаватели и изменения по числителю/знаменателю.'],
      ['Можно ли войти с телефона?', 'Да, вход и дальнейшая работа с расписанием, оценками и УМКД доступны с мобильного браузера.'],
    ],
    name: 'Вход Univer KSTU',
    description: 'Вход в Univer KSTU для студентов: расписание, оценки, экзамены и УМКД в одном сервисе.',
    title: 'Вход Univer KSTU - личный кабинет студента онлайн',
    ogTitle: 'Вход Univer KSTU - личный кабинет студента',
    ogDescription: 'Откройте вход в Univer KSTU и получите доступ к расписанию, оценкам, экзаменам и УМКД.',
    breadcrumbHome: 'Главная',
    breadcrumbCurrent: 'Вход Univer KSTU',
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const language = await getServerLanguage();
  const seo = getSeoContent(language);
  return {
    title: seo.title,
    description: seo.description,
    alternates: {
      canonical: '/vhod-univer-kstu',
    },
    openGraph: {
      title: seo.ogTitle,
      description: seo.ogDescription,
      url: `${siteUrl}/vhod-univer-kstu`,
      locale: getLanguageLocale(language),
    },
  };
}

export default async function VhodUniverKstuPage() {
  const language = await getServerLanguage();
  const seo = getSeoContent(language);
  const webPageSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: seo.name,
    url: `${siteUrl}/vhod-univer-kstu`,
    inLanguage: language,
    description: seo.description,
  };
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: seo.breadcrumbHome, item: `${siteUrl}/` },
      { '@type': 'ListItem', position: 2, name: seo.breadcrumbCurrent, item: `${siteUrl}/vhod-univer-kstu` },
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

      <VhodUniverKstuContent />
    </main>
  );
}
