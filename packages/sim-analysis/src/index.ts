/**
 * Read-only ecological interpretation boundary.
 * EcologyObserver, dynamic clades, population eras, metabolic-role analysis,
 * and story arcs move here during migration.
 */
export interface ObservationFrame {
  readonly tick: number;
  readonly population: number;
  readonly activePopulation: number;
  readonly dormantPopulation: number;
}
