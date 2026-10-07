/** Identity follows the environment channel, never the more frequent live tick. */
export function environmentIdentity(
  env: { readonly worldId: number; readonly tick: number },
  lens: string,
  resourceView: string,
): string {
  return `${env.worldId}/${env.tick}/${lens}/${resourceView}`;
}

export function environmentMatchesWorld(currentWorldId: string, frameWorldId: number): boolean {
  return currentWorldId === String(frameWorldId);
}

/** Camera/viewport are intentionally absent: identical channel input at the same live tick reuses smoothing output. */
export function sameNormalFieldInput(
  previous: { readonly liveTick: number; readonly fieldIdentity: string } | null,
  liveTick: number,
  fieldIdentity: string,
): boolean {
  return previous !== null && previous.liveTick === liveTick && previous.fieldIdentity === fieldIdentity;
}

/** A changed authoritative field at the same environment tick is a discontinuity, not temporal evolution. */
export function sameTickEnvironmentDiscontinuity(
  previous: { readonly environmentTick: number; readonly fieldIdentity: string } | null,
  nextEnvironmentTick: number,
  nextFieldIdentity: string,
): boolean {
  return previous !== null
    && previous.environmentTick === nextEnvironmentTick
    && previous.fieldIdentity !== nextFieldIdentity;
}
