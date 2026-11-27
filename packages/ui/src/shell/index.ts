export { AppShell } from './AppShell.tsx';
export type { AppShellProps } from './AppShell.tsx';
export { AppSwitcher } from './AppSwitcher.tsx';
export type { AppSwitcherProps } from './AppSwitcher.tsx';
export { NotificationBell } from './NotificationBell.tsx';
export type { NotificationBellProps } from './NotificationBell.tsx';
export { UserMenu, initialsOf } from './UserMenu.tsx';
export type { UserMenuProps } from './UserMenu.tsx';
export { PlatformShell, AppTile, PLATFORM_SHELL_GROUP_THRESHOLD } from './PlatformShell.tsx';
export type { PlatformShellProps } from './PlatformShell.tsx';
export {
  NEW_APP_COMMAND,
  THEME_STORAGE_KEY,
  applyTheme,
  monogramOf,
  newAppCommand,
  readTheme,
  safeHref,
  storeTheme,
  themeScript,
} from './platform.ts';
export type {
  ShellApp,
  ShellNavGroup,
  ShellNavItem,
  ShellNotification,
  ShellPlatform,
  ShellPlatformApp,
  ShellTheme,
  ShellUser,
} from './types.ts';
export { ThemeScript } from './ThemeScript.tsx';
export { sectionMatches, sectionNav, withBasePath, withoutBasePath } from './sections.ts';
export type { AppSection } from './sections.ts';
export { CommandPalette, filterCommands } from './CommandPalette.tsx';
export type { CommandItem, CommandPaletteProps } from './CommandPalette.tsx';
export {
  createPlatformSearch,
  parsePlatformSearchResponse,
  plainSnippet,
  PLATFORM_SEARCH_DEBOUNCE_MS,
  PLATFORM_SEARCH_MIN_QUERY,
  PLATFORM_SEARCH_PATH,
  PlatformSearchError,
} from './platform-search.ts';
export type {
  CreatePlatformSearchOptions,
  PlatformSearch,
  PlatformSearchFailure,
  PlatformSearchGroup,
  PlatformSearchHit,
  PlatformSearchResponse,
} from './platform-search.ts';
