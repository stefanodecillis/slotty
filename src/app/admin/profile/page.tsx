import { requireUserOrRedirect } from '@/lib/auth/session';
import { Card } from '@/components/ui/Card';
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
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-headline-m text-on-surface">Profile</h1>
        <p className="text-body-m text-on-surface-variant">
          Update your personal details and preferences.
        </p>
      </header>

      <Card variant="filled">
        <Card.Header>
          <h2 className="text-title-m text-on-surface">Avatar</h2>
        </Card.Header>
        <Card.Content>
          <AvatarForm
            currentAvatarPath={user.avatarPath}
            userId={user.id}
          />
        </Card.Content>
      </Card>

      <Card variant="filled">
        <Card.Header>
          <h2 className="text-title-m text-on-surface">Personal information</h2>
        </Card.Header>
        <Card.Content>
          <ProfileForm user={user} timezones={timezones} />
        </Card.Content>
      </Card>
    </div>
  );
}
