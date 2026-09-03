import { BedLink, WorkstationLink } from "./types";

export function persistedLinkState(
  link: WorkstationLink | BedLink | null
): {
  x: number;
  y: number;
  z: number;
} | null {
  if (!link) {
    return null;
  }

  return {
    x: Math.trunc(link.position.x),
    y: Math.trunc(link.position.y),
    z: Math.trunc(link.position.z)
  };
}
