import type { Project, ProjectState } from '@netplan/domain';
import { makeProject } from '@netplan/domain/fixtures';

/** An empty ProjectState for state-layer tests (#110 D3). */
export function emptyState(project: Project = makeProject()): ProjectState {
  return {
    project,
    sites: [],
    zones: [],
    devices: [],
    interfaces: [],
    addresses: [],
    networks: [],
    links: [],
    services: [],
    policyRules: [],
    flows: [],
    hostArtifacts: [],
    reports: [],
    importProfiles: [],
    secretMatches: [],
    identities: [],
    roleAssignments: [],
    findingDispositions: [],
    baselines: [],
  };
}

/** A promise with its settle handles exposed — for in-flight sync tests. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
