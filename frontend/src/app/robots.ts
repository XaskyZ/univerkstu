import type { MetadataRoute } from 'next';
import { getCanonicalSiteUrl } from '@/lib/site-url';

const siteUrl = getCanonicalSiteUrl();

export default function robots(): MetadataRoute.Robots {
    return {
        rules: [
            {
                userAgent: '*',
                allow: [
                    '/',
                    '/about',
                    '/login',
                    '/univer-kstu',
                    '/raspisanie-kstu',
                    '/univer',
                    '/vhod-univer-kstu',
                    '/kstu-raspisanie-par',
                    '/raspisanie-zanyatii-kstu',
                    '/ocenki-univer-kstu',
                    '/ekzameny-kstu',
                ],
                disallow: [
                    '/schedule',
                    '/exams',
                    '/grades',
                    '/grades-demo',
                    '/umkd',
                    '/profile',
                    '/settings',
                    '/support',
                    '/admin',
                    '/group',
                    '/teacher',
                    '/chat',
                    '/starosta',
                    '/api/',
                ],
            },
        ],
        sitemap: `${siteUrl}/sitemap.xml`,
        host: siteUrl,
    };
}
