import { requireUserOrRedirect } from '@/lib/auth/session';
import { ProfileForm } from './profile-form';
import { AvatarForm } from './avatar-form';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Profile' };

export default async function ProfilePage() {
  const user = await requireUserOrRedirect('/admin/login?next=%2Fadmin%2Fprofile');

  // Intl.supportedValuesOf is available in Node 20+.
  const timezones: string[] = (Intl as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf?.('timeZone') ?? ['UTC'];

  return (
    <div className="mx-auto flex max-w-4xl flex-col">
      <header className="mb-8">
        <h1 className="text-display-s text-on-background">Profile</h1>
        <p className="mt-1 text-body-l text-on-surface-variant">
          Update how you appear on your public booking page.
        </p>
      </header>

      <div className="grid gap-8 md:grid-cols-[280px_1fr] md:gap-10">
        {/* Left column — avatar */}
        <section className="md:sticky md:top-24 md:self-start">
          <h2 className="mb-3 text-title-l text-on-surface">Avatar</h2>
          <AvatarForm currentAvatarPath={user.avatarPath} userId={user.id} />
        </section>

        {/* Right column — form */}
        <section>
          <h2 className="mb-3 text-title-l text-on-surface">Personal information</h2>
          <p className="mb-4 text-body-m text-on-surface-variant">
            Your name, email, bio, and timezone preference.
          </p>
          <div className="rounded-shape-md bg-surface-container-low p-6">
            <ProfileForm user={user} timezones={timezones} />
          </div>
        </section>
      </div>
    </div>
  );
}
