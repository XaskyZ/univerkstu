import { NextResponse } from 'next/server';

// RFC standard "well-known" URL that password managers (1Password, Bitwarden,
// Chrome, Safari Keychain) hit when offering to update a saved credential.
// Browsers follow the redirect and land the user on the in-app form.
export function GET(request: Request) {
    return NextResponse.redirect(new URL('/settings/password', request.url), 302);
}
