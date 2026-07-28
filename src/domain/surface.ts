import { DomainManifest, Surface } from '@/src/domain/catalog';

export type SurfaceLabel = string;

export type SurfaceCatalog = {
  tabs: SurfaceLabel[];
  byLabel: Map<SurfaceLabel, Surface>;
};

export function buildSurfaceCatalog(manifest: DomainManifest): SurfaceCatalog {
  const byLabel = new Map<SurfaceLabel, Surface>();
  const tabs: SurfaceLabel[] = [];

  for (const surface of manifest.surfaces) {
    byLabel.set(surface.label, surface);
    tabs.push(surface.label);
  }

  return { tabs, byLabel };
}

export function getCollectionsForSurface(manifest: DomainManifest, label: SurfaceLabel): string[] {
  const surface = manifest.surfaces.find((item) => item.label === label);
  return surface?.collections ?? [];
}

export function toLabel(surface: Surface): SurfaceLabel {
  return surface.label;
}
