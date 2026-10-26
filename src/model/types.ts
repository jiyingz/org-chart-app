export type EntityType = 'org' | 'team' | 'person';

export interface Ref {
  type: EntityType;
  id: string;
}

export interface Note {
  id: string;
  text: string;
  createdAt: string; // ISO timestamp
}

export interface Notes {
  notable: Note[];
  other: Note[];
}

export type NoteSection = keyof Notes;

interface EntityBase {
  id: string;
  name: string;
  notes: Notes;
  createdAt: string;
  updatedAt: string;
}

export interface Org extends EntityBase {
  tentative?: boolean;
  /** Top-left of this org's tree on the canvas. Everything below it is laid out automatically. */
  position?: { x: number; y: number };
}

export interface Team extends EntityBase {
  orgId: string;
  /** null = sits directly under the org. */
  parentTeamId: string | null;
  tentative?: boolean;
}

/** Where a role lives: an org itself, or one of its teams. */
export interface Unit {
  type: 'org' | 'team';
  id: string;
}

export type RoleKind = 'member' | 'lead';

export interface Role {
  id: string;
  unit: Unit;
  kind: RoleKind;
  title?: string;
  tentative?: boolean;
  /** The member role whose card is drawn on the map. Other member roles show as link chips. */
  primary?: boolean;
}

export interface Person extends EntityBase {
  roles: Role[];
  linkedin?: string;
  personalEmail?: string;
  workEmail?: string;
  phone?: string;
}

export interface Relationship {
  id: string;
  a: Ref;
  b: Ref;
  /** true = one-way, reads "a → b". */
  directed: boolean;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface GraphData {
  schemaVersion: 1;
  orgs: Org[];
  teams: Team[];
  people: Person[];
  relationships: Relationship[];
}

export type CollectionKey = 'orgs' | 'teams' | 'people' | 'relationships';

export const emptyGraph = (): GraphData => ({
  schemaVersion: 1,
  orgs: [],
  teams: [],
  people: [],
  relationships: [],
});

export const emptyNotes = (): Notes => ({ notable: [], other: [] });
