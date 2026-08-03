'use client';

import { useLanguage } from '@/lib/language-context';

export function PrivacyContent() {
    const { messages } = useLanguage();

    return (
        <main className="min-h-screen px-4 py-8 md:px-6 lg:px-8">
            <div className="mx-auto max-w-3xl card p-6 md:p-8">
                <h1 className="text-2xl font-bold mb-4 text-fg">
                    {messages.publicPages.privacyTitle}
                </h1>
                <div className="space-y-4 text-sm text-muted-fg">
                    <p>{messages.publicPages.privacyP1}</p>
                    <p>{messages.publicPages.privacyP2}</p>
                    <p>{messages.publicPages.privacyP3}</p>
                    <p>{messages.publicPages.privacyP4}</p>
                    <p>{messages.publicPages.privacyP5}</p>
                </div>
            </div>
        </main>
    );
}
