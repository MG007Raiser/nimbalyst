import {
  DEFAULT_DICTATION_SETTINGS,
  type DictationEngineSetting,
  type DictationSettings,
} from '../../../shared/dictation';

const ENGINE_SETTINGS: DictationEngineSetting[] = ['auto', 'system', 'on-device', 'openai', 'handy'];

/** Coerce a stored or renderer-supplied value into valid settings. */
export function normalizeDictationSettings(value: unknown): DictationSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const settings: DictationSettings = {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_DICTATION_SETTINGS.enabled,
    engine: ENGINE_SETTINGS.includes(raw.engine as DictationEngineSetting)
      ? (raw.engine as DictationEngineSetting)
      : DEFAULT_DICTATION_SETTINGS.engine,
  };
  if (typeof raw.language === 'string' && raw.language.trim()) {
    settings.language = raw.language.trim();
  }
  // Empty strings clear the Handy override and model (back to auto-detect and
  // Handy's own selection), the same way '' clears the language.
  if (typeof raw.handyPath === 'string' && raw.handyPath.trim()) {
    settings.handyPath = raw.handyPath.trim();
  }
  if (typeof raw.handyModel === 'string' && raw.handyModel.trim()) {
    settings.handyModel = raw.handyModel.trim();
  }
  return settings;
}
