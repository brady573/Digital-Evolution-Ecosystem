import { bootSpike } from './view.ts';
import { PROTOTYPE_BASELINE, type LodTier } from '../../packages/phenotype/src/index.ts';

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const fixtureIdx = Math.min(4, Math.max(0, Number(params.get('fixture') ?? 2) || 0));
  const tierParam = params.get('tier');
  const initialTier: LodTier | undefined =
    tierParam === 'ecosystem' || tierParam === 'population' || tierParam === 'inspection' ? tierParam : undefined;
  const host = document.getElementById('stage')!;
  const modeParam = params.get('mode');
  const handle = await bootSpike(host, fixtureIdx, initialTier);
  if (modeParam === 'canvas2d') {
    handle.setMode('canvas2d');
    (document.getElementById('mode') as HTMLSelectElement).value = 'canvas2d';
  }
  if (initialTier) (document.getElementById('tier') as HTMLSelectElement).value = initialTier;
  const statsEl = document.getElementById('stats')!;
  document.getElementById('baseline')!.textContent = PROTOTYPE_BASELINE;
  const render = (): void => {
    const s = handle.stats();
    statsEl.textContent =
      `${s.fixture} · ${s.organisms} organisms · mode=${s.mode} tier=${s.tier} gen=${s.generation} | ` +
      `sprites=${s.sprites} live-tex=${s.liveTextures} gpu-tex=${s.gpuTextures} reuse=${s.reuse.toFixed(1)}x ` +
      `cumulative=${s.cumulative} pruned=${s.pruned}`;
  };
  (document.getElementById('tier') as HTMLSelectElement).onchange = (e) => {
    handle.setTier((e.target as HTMLSelectElement).value as LodTier);
    render();
  };
  (document.getElementById('mode') as HTMLSelectElement).onchange = (e) => {
    handle.setMode((e.target as HTMLSelectElement).value as 'pixi' | 'canvas2d');
    render();
  };
  document.getElementById('step')!.onclick = () => {
    const r = handle.step();
    render();
    statsEl.textContent += ` | step: ${r.spritesReused}/${handle.stats().sprites} sprites reused, +${r.newTextures} textures (both must be all/0)`;
  };
  document.getElementById('evolve')!.onclick = () => {
    const r = handle.evolve(0.05);
    render();
    statsEl.textContent += ` | evolve: replaced=${r.replaced} live=${r.live} cumulative=${r.cumulative} pruned=${r.pruned}`;
  };
  render();
}

main();
