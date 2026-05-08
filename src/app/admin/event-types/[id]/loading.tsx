import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Skeleton for the edit event-type page. Rendered by Next.js while the page's
 * server-side data (event type + accounts/calendars/schedules) is fetched, so
 * clicking "Edit" gives instant feedback instead of leaving the user staring
 * at the previous page.
 */
export default function EditEventTypeLoading() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-9 w-72" />
      </header>

      <FormSkeleton />
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="flex flex-col gap-6 pb-24 md:pb-0">
      <SectionSkeleton title="Basics">
        <Field labelWidth="w-12" />
        <Field labelWidth="w-24" inputClass="h-20" />
        <Field labelWidth="w-16" inputClass="h-9 w-40" />
      </SectionSkeleton>

      <SectionSkeleton title="What you offer">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field labelWidth="w-20" />
          <Field labelWidth="w-24" />
        </div>
      </SectionSkeleton>

      <SectionSkeleton title="Where it lands">
        <Field labelWidth="w-32" />
        <Field labelWidth="w-28" />
      </SectionSkeleton>

      <SectionSkeleton title="Custom questions">
        <Skeleton className="h-9 w-32" />
      </SectionSkeleton>

      <SectionSkeleton title="Advanced">
        <Skeleton className="h-4 w-48" />
      </SectionSkeleton>

      <div className="flex items-center justify-end gap-3">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 w-24" />
      </div>
    </div>
  );
}

function SectionSkeleton({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">{children}</CardContent>
    </Card>
  );
}

function Field({
  labelWidth,
  inputClass = 'h-10 w-full',
}: {
  labelWidth: string;
  inputClass?: string;
}) {
  return (
    <div className="grid gap-2">
      <Skeleton className={`h-3.5 ${labelWidth}`} />
      <Skeleton className={inputClass} />
    </div>
  );
}
