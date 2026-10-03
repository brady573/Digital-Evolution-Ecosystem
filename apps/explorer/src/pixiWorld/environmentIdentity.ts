/** Identity follows the environment channel, never the more frequent live tick. */
export function environmentIdentity(
  env: { readonly worldId: number; readonly tick: number },
  lens: string,
  resourceView: string,
): string {
  return `${env.worldId}/${env.tick}/${lens}/${resourceView}`;
}
