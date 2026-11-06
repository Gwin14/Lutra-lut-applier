/**
 * Localized names for built-in data (looks, categories, camera profiles).
 * The colour modules stay language-neutral (they are shared with the engine and
 * the Node tests); the UI asks these helpers for display text.
 */
import { getBuiltInLook, type BuiltInLook, type LookCategory } from '../color/looks';
import { getProfile, type ProfileId } from '../color/profiles';
import { tr, type Dict } from './index';

type Look = Pick<BuiltInLook, 'id' | 'name' | 'description'>;

export function lookText(look: Look, t: Dict = tr()) {
  const l = t.looks[look.id];
  return { name: l?.name ?? look.name, description: l?.description ?? look.description };
}

export function builtInLookName(id: string, t: Dict = tr()) {
  const look = getBuiltInLook(id);
  return look ? lookText(look, t).name : null;
}

export function categoryLabel(id: LookCategory, t: Dict = tr()) {
  return t.lookCategories[id] ?? id;
}

export function profileText(id: ProfileId, t: Dict = tr()) {
  const p = getProfile(id);
  const o = t.profiles[id];
  return { name: o?.name ?? p.name, brand: o?.brand ?? p.brand, gamutLabel: o?.gamutLabel ?? p.gamutLabel };
}
