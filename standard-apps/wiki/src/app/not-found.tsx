import { EmptyState } from '@openapps/ui';
import { LinkButton } from '@/components/LinkButton';

export default function NotFound() {
  return (
    <main className="p-6">
      <EmptyState
        title="Diese Seite gibt es nicht"
        description="Vielleicht wurde sie archiviert oder der Verweis ist falsch."
        action={
          <LinkButton href="/" variant="primary" size="sm">
            Zu allen Seiten
          </LinkButton>
        }
      />
    </main>
  );
}
