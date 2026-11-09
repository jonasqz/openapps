import {
  noForeignUi,
  DEFAULT_ALLOWED,
  DEFAULT_ALLOWLIST_FILE,
  clearAllowlistCache,
} from './no-foreign-ui.js';
import { noRawColor } from './no-raw-color.js';
import { requireFormStates } from './require-form-states.js';
import { requireListStates } from './require-list-states.js';

/** Das ESLint-Plugin von @openapps/ui. */
export const plugin = {
  meta: { name: '@openapps/ui', version: '0.1.0' },
  rules: {
    'no-raw-color': noRawColor,
    'no-foreign-ui': noForeignUi,
    'require-list-states': requireListStates,
    'require-form-states': requireFormStates,
  },
};

export {
  noForeignUi,
  noRawColor,
  requireFormStates,
  requireListStates,
  DEFAULT_ALLOWED,
  DEFAULT_ALLOWLIST_FILE,
  clearAllowlistCache,
};
export default plugin;
