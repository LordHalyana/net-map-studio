import { useEffect, useMemo, useRef, useState } from 'react';
import {
  endpointSchema,
  policyActionSchema,
  policyDirectionSchema,
  protocolSchema,
  serviceIdSchema,
  validatePolicyRules,
  type Endpoint,
  type PolicyRule,
  type ProjectState,
  type RuleWarning,
  type Service,
} from '@netplan/domain';
import { useAppStore } from '../state/store';
import {
  buildPolicyRule,
  buildService,
  opCreateEntity,
  opCreatePolicyRule,
  opDeleteEntity,
  opDeletePolicyRule,
  opSetField,
} from '../state/ops';
import { SelectField } from './fields';

/** endpoint selects encode values as `${kind}:${id}` */
function decodeEndpoint(value: string): Endpoint | null {
  const [kind, id] = value.split(':');
  const parsed = endpointSchema.safeParse({ kind, id });
  return parsed.success ? parsed.data : null;
}

function endpointOptions(graph: ProjectState) {
  return [
    ...graph.networks.map((n) => ({
      value: `${n.kind === 'subnet' ? 'subnet' : 'network'}:${n.id}`,
      label: `⊞ ${n.name}`,
    })),
    ...graph.zones.map((z) => ({ value: `zone:${z.id}`, label: `▦ ${z.name}` })),
    ...graph.devices.map((d) => ({ value: `device:${d.id}`, label: `▢ ${d.name}` })),
  ];
}

function endpointLabel(graph: ProjectState, endpoint: Endpoint): string {
  switch (endpoint.kind) {
    case 'network':
    case 'subnet':
      return graph.networks.find((n) => n.id === endpoint.id)?.name ?? '(deleted)';
    case 'device':
      return graph.devices.find((d) => d.id === endpoint.id)?.name ?? '(deleted)';
    case 'zone':
      return graph.zones.find((z) => z.id === endpoint.id)?.name ?? '(deleted)';
    case 'interface':
      return graph.interfaces.find((i) => i.id === endpoint.id)?.name ?? '(deleted)';
  }
}

function serviceLabel(service: Service): string {
  const port =
    service.portStart == null
      ? ''
      : service.portEnd != null && service.portEnd !== service.portStart
        ? ` ${service.portStart}–${service.portEnd}`
        : ` ${service.portStart}`;
  return `${service.name} (${service.protocol}${port})`;
}

function NewServiceForm({ graph }: { graph: ProjectState }) {
  const dispatch = useAppStore((s) => s.dispatch);
  const [name, setName] = useState('');
  const [protocol, setProtocol] = useState('tcp');
  const [port, setPort] = useState('');

  function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const parsedProtocol = protocolSchema.safeParse(protocol);
    if (!parsedProtocol.success) return;
    const portNumber = port.trim() ? Number.parseInt(port.trim(), 10) : null;
    if (
      portNumber != null &&
      (!Number.isInteger(portNumber) || portNumber < 0 || portNumber > 65535)
    ) {
      return;
    }
    const service = buildService(graph.project.id, {
      name: trimmed,
      protocol: parsedProtocol.data,
      portStart: portNumber,
    });
    dispatch(opCreateEntity(graph.project.id, { entityType: 'service', entity: service }));
    setName('');
    setPort('');
  }

  return (
    <div className="service-add">
      <input
        value={name}
        placeholder="Service name (HTTPS…)"
        data-testid="service-name-input"
        onChange={(e) => setName(e.target.value)}
      />
      <select
        value={protocol}
        data-testid="service-protocol-select"
        onChange={(e) => setProtocol(e.target.value)}
      >
        {protocolSchema.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <input
        value={port}
        placeholder="port"
        data-testid="service-port-input"
        onChange={(e) => setPort(e.target.value)}
      />
      <button type="button" data-testid="service-create" onClick={create}>
        Add service
      </button>
    </div>
  );
}

function NewRuleForm({ graph }: { graph: ProjectState }) {
  const dispatch = useAppStore((s) => s.dispatch);
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [direction, setDirection] = useState('bidirectional');
  const [action, setAction] = useState('allow');
  const [logging, setLogging] = useState(false);
  const [owner, setOwner] = useState('');
  const [justification, setJustification] = useState('');
  const [reviewDate, setReviewDate] = useState('');

  const options = endpointOptions(graph);
  const canCreate = Boolean(source && destination);

  function create() {
    const sourceEndpoint = decodeEndpoint(source);
    const destinationEndpoint = decodeEndpoint(destination);
    const parsedAction = policyActionSchema.safeParse(action);
    const parsedDirection = policyDirectionSchema.safeParse(direction);
    if (
      !sourceEndpoint ||
      !destinationEndpoint ||
      !parsedAction.success ||
      !parsedDirection.success
    ) {
      return;
    }
    const rule = buildPolicyRule(graph.project.id, {
      source: sourceEndpoint,
      destination: destinationEndpoint,
      action: parsedAction.data,
      direction: parsedDirection.data,
      serviceId: serviceId ? serviceIdSchema.parse(serviceId) : null,
      logging,
      owner: owner.trim(),
      justification: justification.trim(),
      reviewDate: reviewDate || null,
    });
    dispatch(opCreatePolicyRule(graph.project.id, rule));
    setSource('');
    setDestination('');
    setServiceId('');
    setOwner('');
    setJustification('');
    setReviewDate('');
  }

  return (
    <div className="rule-add" data-testid="new-rule-form">
      <select
        value={source}
        data-testid="rule-source-select"
        onChange={(e) => setSource(e.target.value)}
      >
        <option value="">— source —</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span>→</span>
      <select
        value={destination}
        data-testid="rule-destination-select"
        onChange={(e) => setDestination(e.target.value)}
      >
        <option value="">— destination —</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        value={serviceId}
        data-testid="rule-service-select"
        onChange={(e) => setServiceId(e.target.value)}
      >
        <option value="">any service</option>
        {graph.services.map((s) => (
          <option key={s.id} value={s.id}>
            {serviceLabel(s)}
          </option>
        ))}
      </select>
      <select
        value={direction}
        data-testid="rule-direction-select"
        onChange={(e) => setDirection(e.target.value)}
      >
        {policyDirectionSchema.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <select
        value={action}
        data-testid="rule-action-select"
        onChange={(e) => setAction(e.target.value)}
      >
        {policyActionSchema.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <label className="rule-add__logging">
        <span className="switch switch--inline">
          <input
            type="checkbox"
            checked={logging}
            data-testid="rule-logging-toggle"
            onChange={(e) => setLogging(e.target.checked)}
          />
          <span className="switch__track" />
        </span>
        log
      </label>
      <input
        value={owner}
        placeholder="owner"
        data-testid="rule-owner-input"
        onChange={(e) => setOwner(e.target.value)}
      />
      <input
        value={justification}
        placeholder="justification"
        data-testid="rule-justification-input"
        onChange={(e) => setJustification(e.target.value)}
      />
      <input
        type="date"
        value={reviewDate}
        title="Optional review date"
        data-testid="rule-review-date-input"
        onChange={(e) => setReviewDate(e.target.value)}
      />
      <button type="button" data-testid="rule-create" disabled={!canCreate} onClick={create}>
        Add rule
      </button>
    </div>
  );
}

function RuleRow({
  rule,
  graph,
  warnings,
  focused,
}: {
  rule: PolicyRule;
  graph: ProjectState;
  warnings: RuleWarning[];
  focused: boolean;
}) {
  const dispatch = useAppStore((s) => s.dispatch);
  const projectId = graph.project.id;
  const service = rule.serviceId ? graph.services.find((s) => s.id === rule.serviceId) : undefined;
  // planned-never-observed is informational (§3.11, M8 #65) — muted, not a ⚠
  const infoWarnings = warnings.filter((w) => w.category === 'plannedNeverObserved');
  const hardWarnings = warnings.filter((w) => w.category !== 'plannedNeverObserved');

  // a callout click / search hit lands here scrolled into view (M3, #60)
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focused]);

  return (
    <li
      ref={rowRef}
      className={`rule-row${focused ? ' rule-row--focused' : ''}`}
      data-testid={`rule-row-${rule.id}`}
    >
      <div className="rule-row__main">
        <span className={`rule-row__action rule-row__action--${rule.action}`}>{rule.action}</span>
        <span className="rule-row__traffic">
          {endpointLabel(graph, rule.source)} → {endpointLabel(graph, rule.destination)}
        </span>
        <span className="rule-row__service">{service ? serviceLabel(service) : 'any service'}</span>
        <span className="rule-row__direction">{rule.direction}</span>
        <SelectField
          label=""
          value={rule.action}
          options={policyActionSchema.options.map((value) => ({ value, label: value }))}
          onCommit={(v) =>
            dispatch(opSetField(projectId, 'policyRule', rule.id, 'action', v, rule.action))
          }
        />
        <label className="rule-add__logging" title="Logging">
          <span className="switch switch--inline">
            <input
              type="checkbox"
              checked={rule.logging}
              onChange={(e) =>
                dispatch(
                  opSetField(
                    projectId,
                    'policyRule',
                    rule.id,
                    'logging',
                    e.target.checked,
                    rule.logging,
                  ),
                )
              }
            />
            <span className="switch__track" />
          </span>
          log
        </label>
        <button
          type="button"
          title="Delete rule"
          data-testid={`rule-delete-${rule.id}`}
          onClick={() => dispatch(opDeletePolicyRule(projectId, rule))}
        >
          ✕
        </button>
      </div>
      {hardWarnings.length > 0 && (
        <ul className="rule-row__warnings" data-testid={`rule-warnings-${rule.id}`}>
          {hardWarnings.map((warning, index) => (
            <li key={index} data-warning={warning.category}>
              ⚠ {warning.message}
            </li>
          ))}
        </ul>
      )}
      {infoWarnings.length > 0 && (
        <ul className="rule-row__info" data-testid={`rule-info-${rule.id}`}>
          {infoWarnings.map((warning, index) => (
            <li key={index} data-warning={warning.category}>
              ℹ {warning.message}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The rule editor (design §3.11, concept LINK INFO panel). Renders as the
 * bottom context tab AND, with `page`, as the full-width RULES destination
 * (M10, #67) — the page adds endpoint/action filters over the same table.
 */
export function RulesPanel({ page = false }: { page?: boolean } = {}) {
  const graph = useAppStore((s) => s.graph);
  const dispatch = useAppStore((s) => s.dispatch);
  const focusedRuleId = useAppStore((s) => s.focusedRuleId);
  const warnings = useMemo(() => (graph ? validatePolicyRules(graph) : []), [graph]);
  const [endpointFilter, setEndpointFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  // observed-without-rule warnings belong to no rule row (M8, #65)
  const flowWarnings = warnings.filter((w) => w.ruleId === null);
  if (!graph) return null;
  const projectId = graph.project.id;

  const serviceInUse = (service: Service) =>
    graph.policyRules.some((r) => r.serviceId === service.id);

  const visibleRules = graph.policyRules.filter((rule) => {
    if (actionFilter && rule.action !== actionFilter) return false;
    if (
      endpointFilter &&
      rule.source.id !== endpointFilter &&
      rule.destination.id !== endpointFilter
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className={`rules-panel${page ? ' rules-panel--page' : ''}`} data-testid="rules-panel">
      <div className="rules-panel__column">
        <h3 className="field-section__title">Policy rules</h3>
        {page && (
          <div className="rules-panel__filters" data-testid="rules-filters">
            <select
              value={endpointFilter}
              data-testid="rules-filter-endpoint"
              onChange={(e) => setEndpointFilter(e.target.value)}
            >
              <option value="">all endpoints</option>
              {graph.networks.map((n) => (
                <option key={n.id} value={n.id}>
                  ⊞ {n.name}
                </option>
              ))}
              {graph.devices.map((d) => (
                <option key={d.id} value={d.id}>
                  ▢ {d.name}
                </option>
              ))}
            </select>
            <select
              value={actionFilter}
              data-testid="rules-filter-action"
              onChange={(e) => setActionFilter(e.target.value)}
            >
              <option value="">all actions</option>
              {policyActionSchema.options.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
            <span className="rules-panel__filter-count" data-testid="rules-filter-count">
              {visibleRules.length} of {graph.policyRules.length} rules
            </span>
          </div>
        )}
        {flowWarnings.length > 0 && (
          <ul className="rules-panel__flow-warnings" data-testid="flow-warnings">
            {flowWarnings.map((warning, index) => (
              <li key={index} data-warning={warning.category}>
                ⚠ {warning.message}
              </li>
            ))}
          </ul>
        )}
        <NewRuleForm graph={graph} />
        <ul className="rule-list" data-testid="rule-list">
          {visibleRules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              graph={graph}
              warnings={warnings.filter((w) => w.ruleId === rule.id)}
              focused={rule.id === focusedRuleId}
            />
          ))}
        </ul>
      </div>
      <div className="rules-panel__column rules-panel__column--services">
        <h3 className="field-section__title">Services</h3>
        <NewServiceForm graph={graph} />
        <ul className="service-list" data-testid="service-list">
          {graph.services.map((service) => (
            <li key={service.id}>
              {serviceLabel(service)}
              <button
                type="button"
                title={serviceInUse(service) ? 'In use by a rule' : 'Delete service'}
                disabled={serviceInUse(service)}
                onClick={() =>
                  dispatch(opDeleteEntity(projectId, { entityType: 'service', entity: service }))
                }
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
