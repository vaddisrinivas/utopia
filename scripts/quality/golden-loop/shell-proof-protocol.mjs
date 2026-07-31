#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { currentGit, validateEvidenceEnvelope } from '../evidence-provenance.mjs';

export const SHELL_PROOF_SCHEMA_VERSION = 'utopia.shell-proof-protocol.v1';
const REQUIRED_SCENARIO_ID = 'convergence-conflict-rollback-v1';

const OPERATION_STATUS_VALUES = new Set(['executed', 'applied', 'replayed', 'ignored', 'failed']);

function asString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asChecksum(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const trimmed = value.trim();
  return /^sha256:[a-f0-9]{64}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
}

function asArtifactChecksum(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const trimmed = value.trim().toLowerCase().replace(/^sha256:/, '');
  return /^[a-f0-9]{64}$/.test(trimmed) ? trimmed : null;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function asArray(value, label, blockers) {
  if (!Array.isArray(value)) {
    if (label) blockers.push(`missing_${label}`);
    return [];
  }
  return value;
}

function asStringArray(value, label, blockers) {
  if (!Array.isArray(value)) {
    if (label) blockers.push(`missing_${label}`);
    return [];
  }
  return value
    .map((entry) => asString(entry))
    .filter(Boolean);
}

function parseJsonArtifact(root, artifact, contextLabel, blockers) {
  const artifactPath = resolve(root, artifact.path);
  try {
    if (!existsSync(artifactPath)) {
      blockers.push(`missing_observation_artifact:${contextLabel}:${artifact.path}`);
      return null;
    }
    const body = readFileSync(artifactPath, 'utf8');
    return JSON.parse(body);
  } catch (error) {
    blockers.push(`invalid_observation_artifact_json:${contextLabel}:${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function resolveArtifactReference(candidate, label, blockers, root, prefix) {
  const artifact = asObject(candidate);
  if (!artifact) {
    blockers.push(`${prefix}_missing:${label}`);
    return null;
  }
  const path = asString(artifact.path);
  if (!path) blockers.push(`${prefix}_missing:path:${label}`);
  const sha256 = asArtifactChecksum(asString(artifact.sha256) || asString(artifact.digest));
  if (!sha256) blockers.push(`${prefix}_missing:sha256:${label}`);
  const bytes = Number.isInteger(artifact.bytes) ? artifact.bytes : null;
  if (bytes == null) blockers.push(`${prefix}_missing:bytes:${label}`);

  const normalized = { path, sha256: sha256 || 'missing', bytes: bytes ?? 0 };
  if (!path || !sha256 || bytes == null) return null;

  const artifactPath = isAbsolute(normalized.path) ? normalized.path : resolve(root, normalized.path);
  if (!existsSync(artifactPath)) {
    blockers.push(`${prefix}_${label}:artifact_missing:file:${normalized.path}`);
    return null;
  }
  try {
    const stats = statSync(artifactPath);
    if (!stats.isFile()) {
      blockers.push(`${prefix}_${label}:artifact_not_file:${normalized.path}`);
      return null;
    }
    if (stats.size !== bytes) {
      blockers.push(`${prefix}_${label}:artifact_stale:bytes:${normalized.path}`);
      return null;
    }
    const actualSha = createHash('sha256').update(readFileSync(artifactPath)).digest('hex');
    if (actualSha !== normalized.sha256) {
      blockers.push(`${prefix}_${label}:artifact_stale:sha256:${normalized.path}`);
      return null;
    }
  } catch (error) {
    blockers.push(`${prefix}_${label}:${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  return { ...normalized, path };
}

function parseObservationOperations(root, observation, blockers, index) {
  const observer = asObject(observation.observer) || {};
  const observerKind = asString(observation.observer_kind) || asString(observer.kind);
  if (!observerKind) blockers.push(`missing_observer_kind:${index}`);
  const command = asString(observation.command) || asString(observer.command) || asString(observer.identity);
  if (!command) blockers.push(`missing_observer_command:${index}`);
  const driver = asString(observation.driver) || asString(observation.driver_id) || asString(observer.driver) || asString(observer.identity_id);
  if (!driver) blockers.push(`missing_observer_driver:${index}`);

  const sourceTimestamp = asString(observation.source_timestamp) || asString(observation.timestamp);
  if (!sourceTimestamp || Number.isNaN(Date.parse(sourceTimestamp))) {
    blockers.push(`missing_or_invalid_source_timestamp:${index}`);
  }

  const artifact = resolveArtifactReference(
    observation.artifact || observation.source_artifact || observation.observation_artifact,
    `observation_${index}`,
    blockers,
    root,
    'observation',
  );
  if (!artifact) return [];

  const payload = parseJsonArtifact(root, artifact, `observation_${index}`, blockers);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    blockers.push(`invalid_observation_artifact_payload:${index}`);
    return [];
  }

  const listedOperations = Array.isArray(payload.operations)
    ? payload.operations
    : Array.isArray(payload.operation_ids)
      ? payload.operation_ids.map((opId) => ({ op_id: opId, status: 'observed', timestamp: sourceTimestamp }))
      : null;
  if (!listedOperations) {
    blockers.push(`missing_observed_operations:${index}`);
    return [];
  }

  return listedOperations
    .map((raw, opIndex) => {
      const operation = asObject(raw);
      if (!operation) {
        blockers.push(`invalid_operation_payload:${index}:${opIndex}`);
        return null;
      }

      const opId = asString(operation.op_id) || asString(operation.operation_id);
      if (!opId) {
        blockers.push(`missing_operation_id:${index}:${opIndex}`);
        return null;
      }

      const operationObserver = asObject(operation.observer) || asObject(operation.execution_observer) || {};
      const operationKind = asString(operationObserver.kind)
        || asString(operationObserver.observer_kind)
        || asString(operationObserver.type)
        || observerKind;
      const operationCommand = asString(operationObserver.command)
        || asString(observation.command)
        || asString(observer.command)
        || asString(observer.identity);
      const operationDriver = asString(operationObserver.driver)
        || asString(operationObserver.driver_id)
        || asString(observation.driver)
        || asString(observation.driver_id)
        || asString(observer.driver)
        || asString(observer.identity_id);

      const operationArtifact = asObject(operation.artifact) || {};
      const operationArtifactSha = asString(operationArtifact.sha256)
        || `sha256:${artifact.sha256}`;
      const operationArtifactBytes = Number.isInteger(operationArtifact.bytes) ? operationArtifact.bytes : artifact.bytes;
      const operationArtifactPath = asString(operationArtifact.path) || artifact.path;

      if (!operationKind) blockers.push(`missing_operation_observer_kind:${index}:${opIndex}`);
      if (!operationCommand) blockers.push(`missing_operation_observer_command:${index}:${opIndex}`);
      if (!operationDriver) blockers.push(`missing_operation_observer_driver:${index}:${opIndex}`);
      if (!operationArtifactPath) blockers.push(`missing_operation_artifact:${index}:${opIndex}`);
      if (!operationArtifactSha || !operationArtifactSha.startsWith('sha256:')) {
        blockers.push(`invalid_operation_artifact_sha256:${index}:${opIndex}`);
      }
      if (!Number.isInteger(operationArtifactBytes) || operationArtifactBytes < 0) {
        blockers.push(`invalid_operation_artifact_bytes:${index}:${opIndex}`);
      }

      const status = asString(operation.status) || 'observed';
      if (!OPERATION_STATUS_VALUES.has(status) && status !== 'observed') {
        blockers.push(`invalid_operation_status:${index}:${opId}`);
      }

      const operationTimestamp = asString(operation.timestamp) || asString(operation.at) || sourceTimestamp;
      if (!operationTimestamp || Number.isNaN(Date.parse(operationTimestamp))) {
        blockers.push(`invalid_operation_timestamp:${index}:${opId}`);
      }

      return {
        op_id: opId,
        type: asString(operation.type) || asString(operation.kind) || 'unknown',
        status,
        timestamp: operationTimestamp,
        source_timestamp: sourceTimestamp,
        observer: {
          kind: observerKind,
          command,
          driver,
        },
        provenance: {
          kind: operationKind,
          command: operationCommand,
          driver: operationDriver,
          source_timestamp: sourceTimestamp,
        },
        artifact: {
          path: operationArtifactPath,
          sha256: operationArtifactSha,
          bytes: operationArtifactBytes,
        },
      };
    })
    .filter(Boolean);
}

function collectTransportObservedOperations(payload, blockers, label) {
  const operationIds = new Set();
  const addString = (candidate) => {
    const value = asString(candidate);
    if (value) operationIds.add(value);
  };
  const operations = payload?.operations;
  if (!Array.isArray(operations) && operations !== undefined) {
    blockers.push(`invalid_${label}_operations_payload`);
  }

  if (Array.isArray(operations)) {
    for (const rawOperation of operations) {
      const operation = asObject(rawOperation);
      if (!operation) {
        if (rawOperation != null) {
          blockers.push(`invalid_${label}_operation_payload`);
        }
        continue;
      }

      const opId = asString(operation.op_id)
        || asString(operation.operation_id)
        || asString(operation.id);
      if (!opId) {
        continue;
      }

      const status = asString(operation.status) || 'observed';
      if (!OPERATION_STATUS_VALUES.has(status) && status !== 'observed') {
        blockers.push(`invalid_${label}_operation_status:${opId}`);
      }

      const timestamp = asString(operation.timestamp) || asString(operation.at) || asString(payload?.timestamp);
      if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
        blockers.push(`invalid_${label}_operation_timestamp:${opId}`);
      }

      operationIds.add(opId);
    }
  }

  addString(payload?.operationId);
  addString(payload?.operation_id);
  addString(payload?.reconciled_operation_id);
  addString(payload?.reconciled_operation);
  addString(payload?.rollback_operation_id);
  addString(payload?.reconciledOperationId);
  if (Array.isArray(payload?.operation_ids)) {
    for (const operationId of payload.operation_ids) addString(operationId);
  }
  if (Array.isArray(payload?.rollback_operation_ids)) {
    for (const operationId of payload.rollback_operation_ids) addString(operationId);
  }
  if (Array.isArray(payload?.reconciled_operation_ids)) {
    for (const operationId of payload.reconciled_operation_ids) addString(operationId);
  }

  if (operationIds.size === 0) {
    blockers.push(`missing_${label}_operation_ids`);
  }

  return [...operationIds];
}

function resolveObservedOperations(receipt, root, blockers) {
  const shell = asObject(receipt.shell) || {};
  const execution = asObject(receipt.execution) || {};
  const observations = asArray(
    asObject(execution)?.observations || asObject(shell)?.observations || receipt.observations,
    'execution_observations',
    blockers,
  );

  if (observations.length === 0) blockers.push('missing_execution_observations');

  const allOperations = observations
    .map((entry, index) => parseObservationOperations(root, asObject(entry) || {}, blockers, index))
    .flat();

  const operationIds = [];
  const seen = new Set();
  const deduped = [];
  const operationProvenance = new Map();

  for (const operation of allOperations) {
    if (!operation.op_id) continue;
    if (seen.has(operation.op_id)) {
      blockers.push(`duplicate_operation_id:${operation.op_id}`);
      continue;
    }
    seen.add(operation.op_id);
    operationIds.push(operation.op_id);
    deduped.push(operation);
    operationProvenance.set(operation.op_id, {
      source_timestamp: operation.source_timestamp,
      timestamp: operation.timestamp,
      status: operation.status,
      observer: operation.provenance?.kind ? {
        kind: operation.provenance.kind,
        command: operation.provenance.command,
        driver: operation.provenance.driver,
      } : operation.observer,
      artifact: operation.artifact,
    });
  }

  if (operationIds.length === 0) blockers.push('no_valid_executed_operations');
  return {
    operations: deduped,
    operationIds: new Set(operationIds),
    operationIdsList: operationIds,
    operationProvenance,
  };
}

function resolvePackageInfo(receipt, blockers) {
  const shell = asObject(receipt.shell) || {};
  const app = asObject(receipt.app) || {};
  const execution = asObject(receipt.execution) || {};
  const packageNode = asObject(receipt.package) || asObject(shell.package) || asObject(app.package) || {};

  const checksum = asChecksum(
    packageNode.checksum
    || packageNode.sha256
    || shell.package_checksum
    || receipt.package_checksum
    || execution.package_checksum
    || app.package_checksum,
  );
  const version = asString(
    packageNode.version
    || shell.version
    || receipt.package_version
    || execution.package_version,
  );
  const previousVersion = asString(
    packageNode.previous_version
    || shell.previous_version
    || receipt.previous_version
    || execution.previous_version,
  );
  const transition = asObject(packageNode.version_transition)
    || asObject(shell.version_transition)
    || asObject(receipt.version_transition)
    || {};

  const transitionFrom = asString(
    transition.from
    || transition.previous_version
    || previousVersion,
  );
  const transitionTo = asString(
    transition.to
    || transition.current_version
    || version,
  );

  if (!checksum) blockers.push('missing_package_checksum');
  if (!version) blockers.push('missing_package_version');
  if (!transitionFrom || !transitionTo) blockers.push('missing_package_version_transition');
  if (transitionFrom && transitionTo && transitionFrom === transitionTo) {
    blockers.push(`invalid_package_version_transition:${transitionFrom}`);
  }

  return {
    checksum,
    version,
    previous_version: previousVersion,
    transition_from: transitionFrom,
    transition_to: transitionTo,
  };
}

function resolveTransport(receipt, blockers, root, operationIdSet = new Set(), operationProvenance = new Map()) {
  const shell = asObject(receipt.shell) || {};
  const execution = asObject(receipt.execution) || {};
  const claimed = execution.sync_claimed === true || shell.sync_claimed === true || receipt.sync_claimed === true;

  if (!claimed) return null;

  const transport = asObject(shell.transport) || asObject(execution.transport) || {};
  const endpoint = asString(transport.endpoint) || asString(transport.base_url);
  const session = asString(transport.session) || asString(transport.session_id);
  if (!endpoint || !session) {
    blockers.push('missing_sync_transport_session_or_endpoint');
    return null;
  }

  const transportCandidate = transport.observation || transport.observation_artifact || transport.raw_observation;
  const transportObservation = transportCandidate
    ? resolveArtifactReference(transportCandidate, 'transport', blockers, root, 'transport')
    : null;
  let observedOperationIds = [];
  if (transportObservation) {
    const payload = parseJsonArtifact(root, transportObservation, 'transport', blockers);
    const payloadSession = asString(payload?.session) || asString(payload?.session_id);
    const payloadEndpoint = asString(payload?.endpoint) || asString(payload?.base_url);
    const payloadOperations = collectTransportObservedOperations(payload, blockers, 'transport');
    observedOperationIds = payloadOperations;
    if (payloadSession !== session) blockers.push('transport_observation_session_mismatch');
    if (payloadEndpoint !== endpoint) blockers.push('transport_observation_endpoint_mismatch');
    if (observedOperationIds.length === 0) blockers.push('missing_transport_observed_operations');
    for (const operationId of observedOperationIds) {
      if (!operationIdSet.has(operationId)) blockers.push(`transport_operation_not_executed:${operationId}`);
      if (!operationProvenance.has(operationId)) blockers.push(`transport_operation_missing_provenance:${operationId}`);
    }
    if (Number.isInteger(transport.operation_count) && transport.operation_count !== observedOperationIds.length) {
      blockers.push(`transport_observation_operation_count_mismatch:${observedOperationIds.length}:${transport.operation_count}`);
    }
  }

  return {
    sync_claimed: true,
    endpoint,
    session,
    operation_count: Number.isInteger(transport.operation_count)
      ? transport.operation_count
      : Number.parseInt(asString(transport.operation_count), 10) || null,
    observation: transportObservation ? {
      path: transportObservation.path,
      sha256: `sha256:${transportObservation.sha256}`,
      bytes: transportObservation.bytes,
    } : null,
    observed_operation_ids: observedOperationIds,
  };
}

function resolveConvergence(receipt, operationIdSet, blockers, transport, root, operationProvenance = new Map()) {
  const shell = asObject(receipt.shell) || {};
  const execution = asObject(receipt.execution) || {};
  const convergence = asObject(shell.convergence) || asObject(execution.convergence) || asObject(receipt.convergence) || {};

  const operationIds = asStringArray(convergence.operation_ids, 'convergence_operation_ids', blockers);
  for (const opId of operationIds) {
    if (!operationIdSet.has(opId)) blockers.push(`convergence_operation_not_executed:${opId}`);
    if (!operationProvenance.has(opId)) blockers.push(`convergence_operation_missing_provenance:${opId}`);
  }

  const rollbackOperationIds = asStringArray(convergence.rollback_operation_ids, 'rollback_operation_ids', blockers)
    .filter((opId) => {
      if (!operationIdSet.has(opId)) blockers.push(`rollback_operation_not_executed:${opId}`);
      if (!operationProvenance.has(opId)) blockers.push(`rollback_operation_missing_provenance:${opId}`);
      return true;
    });

  const assertions = asObject(receipt.lifecycle?.scenario?.assertions) || asObject(receipt.scenario?.assertions) || {};
  if (assertions.convergence_replayed !== true) blockers.push('scenario_convergence_not_replayed');
  if (!Number.isInteger(assertions.rollback_replayed_for_losers) || assertions.rollback_replayed_for_losers < 1) {
    blockers.push('scenario_rollback_replay_missing');
  }

  const reconciled = asString(convergence.reconciled_operation_id) || asString(convergence.winner_op_id);
  if (reconciled && !operationIdSet.has(reconciled)) blockers.push(`reconciled_operation_not_executed:${reconciled}`);
  if (reconciled && !operationProvenance.has(reconciled)) {
    blockers.push(`reconciled_operation_missing_provenance:${reconciled}`);
  }

  if (operationIds.length === 0) blockers.push('missing_convergence_operation_ids');

  const referenceTransportObservation = asObject(convergence.transport_observation)
    || asObject(convergence.reference_transport_observation)
    || asObject(convergence.reference_observation);
  const referenceTransportSession = asString(convergence.transport_session) || asString(convergence.session);
  if (transport?.sync_claimed) {
    if (!referenceTransportObservation) blockers.push('missing_convergence_reference_transport_observation');
    if (referenceTransportSession !== transport.session) blockers.push('convergence_transport_session_mismatch');
    if (!referenceTransportSession) blockers.push('missing_convergence_transport_session');
  }
  if (referenceTransportObservation) {
    const normalized = resolveArtifactReference(
      referenceTransportObservation,
      'convergence_transport_observation',
      blockers,
      root,
      'transport_observation',
    );
    if (!normalized) {
      blockers.push('invalid_convergence_transport_observation');
    } else {
      const payload = parseJsonArtifact(
        root,
        normalized,
        'convergence_transport_observation',
        blockers,
      );
      const observedSession = asString(payload?.session) || asString(payload?.session_id);
      const observedEndpoint = asString(payload?.endpoint) || asString(payload?.base_url);
      const observedOperationIds = new Set(
        (
          Array.isArray(payload?.operation_ids)
            ? payload.operation_ids
            : Array.isArray(payload?.operations)
              ? payload.operations.map((operation) => operation?.op_id || operation?.operation_id)
              : []
        )
          .map((operationId) => asString(operationId))
          .filter(Boolean),
      );

      if (observedSession !== referenceTransportSession) {
        blockers.push('convergence_observation_session_mismatch');
      }
      if (transport?.endpoint && observedEndpoint !== transport.endpoint) {
        blockers.push('convergence_observation_endpoint_mismatch');
      }
      for (const operationId of new Set([
        ...operationIds,
        ...rollbackOperationIds,
        ...(reconciled ? [reconciled] : []),
      ])) {
        if (!observedOperationIds.has(operationId)) {
          blockers.push(`convergence_operation_not_in_transport_observation:${operationId}`);
        }
        if (!operationProvenance.has(operationId)) {
          blockers.push(`convergence_transport_operation_missing_provenance:${operationId}`);
        }
      }
    }
  }

  return {
    operation_ids: operationIds,
    rollback_operation_ids: rollbackOperationIds,
    reconciled_operation_id: reconciled,
    replayed: convergence.rollback_replayed === true,
    reference_transport_observation: referenceTransportObservation
      ? {
        path: asString(referenceTransportObservation.path),
        sha256: asString(referenceTransportObservation.sha256),
        bytes: Number.isInteger(referenceTransportObservation.bytes) ? referenceTransportObservation.bytes : null,
      }
      : null,
    transport_session: referenceTransportSession,
    assertions,
  };
}

function expectedTransportCount(receipt) {
  const shell = asObject(receipt.shell) || {};
  const execution = asObject(receipt.execution) || {};
  return Number.parseInt(
    asString(
      shell?.transport?.operation_count
      || execution?.transport?.operation_count
      || receipt?.transport_operation_count,
    ) || '',
    10,
  );
}

/**
 * @param {Record<string, any> | null | undefined} receipt
 * @param {{
 *   root?: string;
 *   label?: string;
 *   path?: string;
 *   requiredSourceSurface?: string | null;
 *   requireTransport?: boolean;
 * }} [options]
 */
export function validateShellProofReceipt(receipt, {
  root = process.cwd(),
  label = 'receipt',
  path = 'receipt',
  requiredSourceSurface = null,
  requireTransport = true,
} = {}) {
  const blockers = [];

  const envelope = validateEvidenceEnvelope(root, path, receipt, currentGit(root));
  const envelopeIssues = (envelope.issues || []).filter((entry) => entry !== 'missing:branch');
  if (envelopeIssues.length) {
    blockers.push(...envelopeIssues.map((entry) => `invalid_envelope:${entry}`));
  }

  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    blockers.push(`missing_or_invalid_payload:${label}`);
    return {
      pass: false,
      blockers,
      schema_version: SHELL_PROOF_SCHEMA_VERSION,
      source_surface: null,
      installation_id: null,
      package: null,
      durable_data_checksum: null,
      transport: null,
      operations: [],
      operation_ids: [],
      convergence: null,
      scenario_id: null,
      status: null,
      proof: null,
    };
  }

  const proof = asString(receipt.proof);
  if (!proof) blockers.push(`missing_proof:${label}`);

  const schemaVersion = asString(receipt.schema_version) || asString(receipt.protocol_version);
  if (schemaVersion !== SHELL_PROOF_SCHEMA_VERSION) {
    blockers.push(`invalid_schema_version:${schemaVersion || 'missing'}`);
  }

  const shell = asObject(receipt.shell) || {};
  const source = asObject(receipt.source) || {};
  const execution = asObject(receipt.execution) || {};

  const sourceSurface = asString(source.surface) || asString(shell.surface);
  if (!sourceSurface) blockers.push(`missing_source_surface:${label}`);
  if (requiredSourceSurface && sourceSurface && sourceSurface !== requiredSourceSurface) {
    blockers.push(`source_surface_mismatch:${label}:${sourceSurface}`);
  }

  const installationId = asString(receipt.installation_id)
    || asString(shell.installation_id)
    || asString(execution.installation_id)
    || asString(source.installation_id)
    || asString(execution.source_installation_id)
    || asString(shell.source_installation_id);
  if (!installationId) blockers.push(`missing_installation_id:${label}`);

  const packageInfo = resolvePackageInfo(receipt, blockers);

  const observed = resolveObservedOperations(receipt, root, blockers);
  const operations = observed.operations;
  const operationIdSet = observed.operationIds;
  const operationIdsList = observed.operationIdsList;

  const durableDataChecksum = asChecksum(
    execution.durable_data_checksum || shell.durable_data_checksum || receipt.durable_data_checksum,
  );
  if (!durableDataChecksum) blockers.push('missing_durable_data_checksum');

  const transport = resolveTransport(
    receipt,
    blockers,
    root,
    operationIdSet,
    observed.operationProvenance,
  );
  if (requireTransport && transport?.sync_claimed && (!transport.endpoint || !transport.session)) {
    blockers.push('missing_transport_session_or_endpoint');
  }

  const convergence = resolveConvergence(
    receipt,
    operationIdSet,
    blockers,
    transport,
    root,
    observed.operationProvenance,
  );

  const scenario = asObject(receipt.lifecycle?.scenario) || asObject(receipt.scenario);
  const scenarioId = asString(scenario?.scenario_id) || asString(receipt.scenario_id);
  if (!scenarioId) blockers.push('missing_scenario_id');
  if (scenarioId && scenarioId !== REQUIRED_SCENARIO_ID) blockers.push(`invalid_scenario_id:${scenarioId}`);

  const status = receipt.status === 'passed' || receipt.status === 'PASS'
    ? 'passed'
    : null;
  if (!status) blockers.push(`receipt_not_passed:${label}`);

  if (receipt.synthetic_plan_is_not_device_proof === true) blockers.push(`synthetic_receipt:${label}`);

  const expectedOps = expectedTransportCount(receipt);
  if (Number.isInteger(expectedOps) && expectedOps > 0 && expectedOps !== operations.length) {
    blockers.push(`operation_count_mismatch:${operations.length}:${expectedOps}`);
  }

  return {
    pass: blockers.length === 0,
    blockers,
    schema_version: schemaVersion || SHELL_PROOF_SCHEMA_VERSION,
    proof,
    source_surface: sourceSurface,
    installation_id: installationId,
    package: {
      checksum: packageInfo.checksum,
      version: packageInfo.version,
      previous_version: packageInfo.previous_version,
      transition_from: packageInfo.transition_from,
      transition_to: packageInfo.transition_to,
    },
    durable_data_checksum: durableDataChecksum,
    transport,
    operations,
    operation_ids: operationIdsList,
    convergence,
    scenario_id: scenarioId,
    status,
    expected_transport_operation_count: Number.isInteger(expectedOps) ? expectedOps : null,
  };
}
