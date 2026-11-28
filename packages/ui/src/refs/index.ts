export { RefChip, ResolvedRefChip, useRefResolution } from './RefChip.tsx';
export type { RefChipProps, RefChipState, ResolvedRefChipProps } from './RefChip.tsx';
export { MentionPicker, MENTION_PICKER_DEBOUNCE_MS } from './MentionPicker.tsx';
export type { MentionPickerProps } from './MentionPicker.tsx';
export { BacklinksPanel } from './BacklinksPanel.tsx';
export type { BacklinksPanelProps } from './BacklinksPanel.tsx';
export { RefActionsMenu } from './RefActionsMenu.tsx';
export { RefText } from './RefText.tsx';
export type { RefTextProps, RefTextSegment } from './RefText.tsx';
export type { RefActionsMenuProps } from './RefActionsMenu.tsx';
export {
  createActionsLoader,
  createBacklinksLoader,
  createMentionSearch,
  createRefResolver,
  parseRefResolution,
  PLATFORM_PEOPLE_PATH,
  PLATFORM_REFS_ACTIONS_PATH,
  PLATFORM_REFS_BACKLINKS_PATH,
  PLATFORM_REFS_RESOLVE_PATH,
  PlatformRefsError,
  REF_RESOLVE_BATCH_MAX,
  refToken,
} from './platform-refs.ts';
export type {
  BacklinkItem,
  BacklinkKind,
  LoadActions,
  LoadBacklinks,
  MentionOption,
  MentionOptionKind,
  MentionSearch,
  PlatformRefsOptions,
  RefActionItem,
  RefObjectKind,
  RefResolution,
  ResolvedRef,
  ResolveRef,
  UnresolvedRef,
} from './platform-refs.ts';
