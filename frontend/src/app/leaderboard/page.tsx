import { redirect } from 'next/navigation';

export default function LeaderboardRedirectPage() {
    redirect('/settings/activity');
}
