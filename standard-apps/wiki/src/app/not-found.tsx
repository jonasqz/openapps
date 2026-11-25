import { EmptyState } from '@openapps/ui';
import { LinkButton } from '@/components/LinkButton';

export default function NotFound() {
  return (
    <div>
      <EmptyState
        title="This page does not exist"
        description="It may have been archived, or the link is wrong."
        action={
          <LinkButton href="/" variant="primary" size="sm">
            All pages
          </LinkButton>
        }
      />
    </div>
  );
}
