import {
  APP_VERSION,
  ENGINE_VERSION,
  EXPORT_FORMAT_VERSION,
} from "@digital-evolution/sim-core";

export function App() {
  return (
    <main className="migration-shell">
      <section>
        <p className="eyebrow">Living Evolution Explorer</p>
        <h1>Canonical repository migration</h1>
        <p>
          The modular application shell is active. Biological behavior remains
          protected by legacy regression artifacts while sim-core is extracted.
        </p>
        <dl>
          <div><dt>App source</dt><dd>v{APP_VERSION}</dd></div>
          <div><dt>Engine source</dt><dd>{ENGINE_VERSION}</dd></div>
          <div><dt>Export source</dt><dd>{EXPORT_FORMAT_VERSION}</dd></div>
        </dl>
      </section>
    </main>
  );
}
