import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { OrganismId } from "../../packages/contracts/src/index";
import { worldId } from "../../packages/contracts/src/index";
import { WorldPixi } from "../../apps/explorer/src/pixiWorld/WorldPixi";
import type { PixiWorldProps } from "../../apps/explorer/src/worldViewTypes";
import { createWorldVisualFixtures, type WorldVisualScene } from "../validation/world-visual-fixtures";

const fixtures = createWorldVisualFixtures();
type Scene = WorldVisualScene;
type Environment = "rich" | "depleted";

declare global {
  interface Window {
    __DEE_WORLD_VISUAL__?: {
      setScene(scene: Scene): void;
      setEnvironment(environment: Environment): void;
      setZoom(zoom: number): void;
    };
  }
}

function WorldVisualProof() {
  const [scene, setScene] = useState<Scene>("families");
  const [environment, setEnvironment] = useState<Environment>("rich");
  const [zoom, setZoom] = useState(1);
  const sceneFixtures = {
    activity: fixtures.activity,
    sparse: fixtures.sparse,
    dense: fixtures.dense,
  };
  const currentScene = useMemo(() => {
    if (scene === "families" || scene === "families-active") {
      const rows = scene === "families-active" ? fixtures.familiesActive : fixtures.families;
      return {
        organisms: rows.map((fixture) => fixture.organism),
        resolvedPhenotypes: new Map(rows.map((fixture) => [Number(fixture.organism.id), fixture.phenotype])),
      };
    }
    return sceneFixtures[scene];
  }, [scene]);
  const env = fixtures[environment];

  useEffect(() => {
    window.__DEE_WORLD_VISUAL__ = { setScene, setEnvironment, setZoom };
    return () => { delete window.__DEE_WORLD_VISUAL__; };
  }, []);

  const props: PixiWorldProps = {
    worldId: worldId(Number(env.worldId)),
    tick: env.tick,
    environment: env,
    organisms: currentScene.organisms,
    resolvedPhenotypes: currentScene.resolvedPhenotypes,
    lens: "normal",
    resourceView: "combined",
    traitView: "speed",
    selectedId: null as OrganismId | null,
    camera: { x: 300, y: 300 },
    zoom,
    onSelect: () => {},
    onCamera: () => {},
    onView: () => {},
  };

  return <main className="proof-shell">
    <div className="fixture-label">Deterministic presentation fixture · not a simulation finding</div>
    <div className="proof-world"><WorldPixi {...props} /></div>
  </main>;
}

const style = document.createElement("style");
style.textContent = `
  *{box-sizing:border-box}html,body,#root{width:100%;height:100%;margin:0;background:#08141f;color:#e3eee9;font:14px system-ui,sans-serif}
  .proof-shell{position:relative;width:100%;height:100%;display:grid;place-items:center;overflow:hidden}
  .fixture-label{position:absolute;top:8px;left:8px;z-index:5;padding:4px 7px;border-radius:5px;background:#08141fcc;color:#bdc9c4;font-size:11px}
  .proof-world{width:min(100vw,100vh);height:min(100vw,100vh)}
  .world-pixi-host,.world-pixi-host>canvas{width:100%;height:100%}
`;
document.head.append(style);
createRoot(document.getElementById("root")!).render(<WorldVisualProof />);
