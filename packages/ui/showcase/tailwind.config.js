import preset from '../tailwind/preset.js';

/**
 * Tailwind für das Schaufenster. Eine App schreibt genau diese Datei:
 * das Preset von @openapps/ui plus die eigenen Dateien unter `content`.
 */
export default {
  presets: [preset],
  content: [
    './showcase/index.html',
    './showcase/*.tsx',
    './src/**/*.tsx',
  ],
};
