import type { MetadataRoute } from 'next';
import { getCanonicalSiteUrl } from '@/lib/site-url';

const siteUrl = getCanonicalSiteUrl();

export default function sitemap(): MetadataRoute.Sitemap {
    const rawCommitDate = process.env.VERCEL_GIT_COMMIT_DATE;
    const lastModified = rawCommitDate ? new Date(rawCommitDate) : new Date();
    const publicRoutes = [
        '/',
        '/about',
        '/login',
        '/privacy',
        '/terms',
        '/univer-kstu',
        '/raspisanie-kstu',
        '/univer',
        '/vhod-univer-kstu',
        '/kstu-raspisanie-par',
        '/raspisanie-zanyatii-kstu',
        '/ocenki-univer-kstu',
        '/ekzameny-kstu',
    ];

    const priorities: Record<string, number> = {
        '/': 1,
        '/login': 0.9,
        '/univer-kstu': 0.9,
        '/raspisanie-kstu': 0.9,
        '/vhod-univer-kstu': 0.85,
        '/kstu-raspisanie-par': 0.85,
        '/raspisanie-zanyatii-kstu': 0.85,
        '/ocenki-univer-kstu': 0.8,
        '/ekzameny-kstu': 0.8,
        '/univer': 0.8,
        '/about': 0.7,
        '/privacy': 0.3,
        '/terms': 0.3,
    };

    return publicRoutes.map((route) => ({
        url: `${siteUrl}${route}`,
        lastModified,
        changeFrequency: route === '/' ? 'daily' : 'weekly',
        priority: priorities[route] || 0.75,
    }));
}
