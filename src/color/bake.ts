import { compileGrade, type Grade, type LookFn } from './grade';
import { compileBuiltInLook } from './looks';
import { bakeLut, bakeTexture, type Lut3D, type LutTexture } from './lut';
import type { ProfileId } from './profiles';

/** Resolves user-imported looks (`user:<id>`); built-ins are handled here. */
export type UserLookResolver = (lookId: string) => LookFn | null;

export function resolveLook(lookId: string | null, user: UserLookResolver): LookFn | null {
  if (!lookId) return null;
  if (lookId.startsWith('user:')) return user(lookId);
  return compileBuiltInLook(lookId);
}

export function gradeFn(input: ProfileId, grade: Grade, user: UserLookResolver) {
  return compileGrade(input, grade, resolveLook(grade.lookId, user));
}

export function bakeGradeTexture(input: ProfileId, grade: Grade, size: number, user: UserLookResolver): LutTexture {
  return bakeTexture(size, gradeFn(input, grade, user));
}

export function bakeGradeLut(input: ProfileId, grade: Grade, size: number, user: UserLookResolver): Lut3D {
  return bakeLut(size, gradeFn(input, grade, user));
}
