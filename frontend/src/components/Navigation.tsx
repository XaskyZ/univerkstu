'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, FileText, Settings, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';

interface NavItem {
    href: string;
    label: string;
    Icon: LucideIcon;
}

export default function Navigation() {
    const pathname = usePathname();
    const { userId } = useAuth();
    const { messages } = useLanguage();
    const navItems: NavItem[] = [
        { href: '/schedule', label: messages.bottomNav.schedule, Icon: CalendarDays },
        { href: '/exams', label: messages.settings.quickActions.exams, Icon: FileText },
        { href: '/settings', label: messages.bottomNav.more, Icon: Settings },
    ];

    return (
        <nav className="bg-white shadow-sm border-b sticky top-0 z-50">
            <div className="max-w-4xl mx-auto px-4">
                <div className="flex items-center justify-between h-16">
                    {/* Logo */}
                    <Link href="/schedule" className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
                            <CalendarDays className="w-5 h-5 text-white" strokeWidth={2} />
                        </div>
                        <span className="font-bold text-gray-900 hidden sm:inline">UniverSchedule</span>
                    </Link>

                    {/* Nav Items */}
                    <div className="flex items-center gap-1">
                        {navItems.map(({ href, label, Icon }) => {
                            const isActive = pathname === href;
                            return (
                                <Link
                                    key={href}
                                    href={href}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isActive
                                            ? 'bg-blue-50 text-blue-600'
                                            : 'text-gray-600 hover:bg-gray-100'
                                        }`}
                                >
                                    <Icon className="w-5 h-5" strokeWidth={2} />
                                    <span className="hidden sm:inline">{label}</span>
                                </Link>
                            );
                        })}
                    </div>

                    {/* User Info */}
                    <div className="flex items-center">
                        <span className="text-sm text-gray-600 hidden sm:inline">{userId}</span>
                    </div>
                </div>
            </div>
        </nav>
    );
}
