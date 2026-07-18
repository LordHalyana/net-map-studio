import { endpointResolver, type EndpointResolver, type ProjectState } from '@netplan/domain';
import { networkColorMap } from './networkColor';

/**
 * Graph-derived helpers, cached per graph version (#110 D4). State updates
 * always produce fresh objects (the reducer and every server adoption), so a
 * WeakMap keyed on object identity means the resolver and the network tint
 * map are built once per version app-wide — instead of once per render per
 * consuming component.
 */

const resolvers = new WeakMap<ProjectState, EndpointResolver>();

export function resolverFor(graph: ProjectState): EndpointResolver {
  let resolver = resolvers.get(graph);
  if (!resolver) {
    resolver = endpointResolver(graph);
    resolvers.set(graph, resolver);
  }
  return resolver;
}

const tints = new WeakMap<ProjectState['networks'], Map<string, string>>();

export function networkTintsFor(networks: ProjectState['networks']): Map<string, string> {
  let map = tints.get(networks);
  if (!map) {
    map = networkColorMap(networks);
    tints.set(networks, map);
  }
  return map;
}
