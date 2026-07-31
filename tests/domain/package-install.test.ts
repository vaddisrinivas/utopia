import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  assertPackageInstallApprovalMatchesPreview,
  buildPackageInstallApprovalReceipt,
  buildPackageInstallPreview,
  parsePackageInstallTarget,
  UTOPIA_PUBLISH_DISCLOSURE_LINES,
  validateRegistryManifest,
} from '@/packages/shared/contracts/package-install';
import { resolveRegistrySignatureTrust } from '@/packages/shared/contracts/package-trust';
import { sha256Canonical } from '@/packages/shared/contracts/canonical-json';
import {
  BUNDLED_AUDIO_LOOP_PACKAGE_URL,
  BUNDLED_DEMO_PACKAGE_URL,
  BUNDLED_EXPENSE_SPLITTER_PACKAGE_URL,
  BUNDLED_FOCUS_INTERVALS_PACKAGE_URL,
  BUNDLED_HABIT_GRID_PACKAGE_URL,
  BUNDLED_SPLIT_RENT_PACKAGE_URL,
  BUNDLED_WORKOUT_LOGGER_PACKAGE_URL,
  BUNDLED_UTOPIA_REGISTRY_URL,
  PACKAGE_INSTALL_FETCH_TIMEOUT_MS,
  PACKAGE_INSTALL_MAX_BODY_BYTES,
  buildAppInstallationLifecycleViewModel,
  buildPackageInstallReviewViewModel,
  buildPackageInstallPreviewWithSignatureVerification,
  createPackageInstallFetcher,
  fetchPackageInstallCandidate,
  fetchRegistryManifest,
  getBundledRegistryManifest,
  packageInstallPreviewRows,
  packageInstallSignatureLabel,
  packageInstallTrustLabel,
  packageInstallTrustSummary,
  type PackageInstallFetcher,
} from '@/src/domain/package-install';
import { canonicalJson } from '@/packages/shared/contracts/canonical-json';

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/package-install');
const validationFixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/package-validation');
const packageFixture = JSON.parse(readFileSync(path.join(fixtureDir, 'valid-package.json'), 'utf8'));
const registryFixture = JSON.parse(readFileSync(path.join(fixtureDir, 'registry.json'), 'utf8'));
const validV3Package = JSON.parse(readFileSync(path.join(validationFixtureDir, 'valid-v3.json'), 'utf8'));

describe('package install link and registry contracts', () => {
  it('parses deep links, universal links, and direct HTTPS package URLs', () => {
    expect(parsePackageInstallTarget('utopia://install?url=https%3A%2F%2Fexample.com%2Fapps%2Fdemo.package.json')).toEqual({
      source: 'deep_link',
      packageUrl: 'https://example.com/apps/demo.package.json',
    });
    expect(parsePackageInstallTarget('wonder://install?url=https%3A%2F%2Fexample.com%2Fapps%2Fdemo.package.json')).toEqual({
      source: 'deep_link',
      packageUrl: 'https://example.com/apps/demo.package.json',
    });
    expect(parsePackageInstallTarget('https://utoia.thetechcruise.com/install?url=https%3A%2F%2Fexample.com%2Fapps%2Fdemo.package.json')).toEqual({
      source: 'universal_link',
      packageUrl: 'https://example.com/apps/demo.package.json',
    });
    expect(parsePackageInstallTarget('https://wonder.app/install?url=https%3A%2F%2Fexample.com%2Fapps%2Fdemo.package.json')).toEqual({
      source: 'universal_link',
      packageUrl: 'https://example.com/apps/demo.package.json',
    });
    expect(parsePackageInstallTarget('https://example.com/apps/demo.package.json#ignored')).toEqual({
      source: 'package_url',
      packageUrl: 'https://example.com/apps/demo.package.json',
    });
  });

  it('fails bad install URLs before fetch', async () => {
    let called = false;
    const fetcher: PackageInstallFetcher = async () => {
      called = true;
      throw new Error('should not fetch');
    };

    await expect(fetchPackageInstallCandidate('http://example.com/app.package.json', fetcher)).rejects.toThrow('install_url_must_be_https');
    expect(called).toBe(false);
  });

  it('bounds remote fetches and rejects redirects, non-JSON, and oversized bodies', async () => {
    vi.useFakeTimers();
    try {
      const pendingFetcher = createPackageInstallFetcher(async () => new Promise(() => {}));
      const pending = pendingFetcher('https://example.com/apps/demo.package.json');
      const pendingExpectation = expect(pending).rejects.toThrow('package_fetch_timeout');
      await vi.advanceTimersByTimeAsync(PACKAGE_INSTALL_FETCH_TIMEOUT_MS);
      await pendingExpectation;

      const response = (overrides: Record<string, unknown>) => ({
        ok: true,
        status: 200,
        headers: { get: (name: string) => name === 'content-type' ? 'application/json' : null },
        text: async () => '{}',
        ...overrides,
      });
      await expect(fetchPackageInstallCandidate('https://example.com/apps/demo.package.json', async () => response({ redirected: true }))).rejects.toThrow('package_fetch_redirected');
      await expect(fetchPackageInstallCandidate('https://example.com/apps/demo.package.json', async () => response({ headers: { get: () => 'text/html' } }))).rejects.toThrow('package_fetch_not_json');
      await expect(fetchPackageInstallCandidate('https://example.com/apps/demo.package.json', async () => response({ text: async () => 'x'.repeat(PACKAGE_INSTALL_MAX_BODY_BYTES + 1) }))).rejects.toThrow('package_fetch_body_too_large');
    } finally {
      vi.useRealTimers();
    }
  });

  it('validates registry manifest and fetches registry JSON through an injected fetcher', async () => {
    const manifest = {
      ...registryFixture,
      packages: [
        {
          ...registryFixture.packages[0],
          checksum: sha256Canonical(packageFixture),
          publisher: {
            id: 'utopia.local',
            name: 'Utopia Local',
            homepage: 'https://example.com/publishers/utopia',
            verified: true,
          },
          signature: {
            algorithm: 'ed25519',
            keyId: 'utopia-local-1',
            value: 'test-signature',
            signedAt: '2026-07-28T00:00:00.000Z',
          },
        },
        registryFixture.packages[1],
      ],
    };
    const fetcher = jsonFetcher({
      'https://example.com/registry.json': manifest,
    });

    await expect(fetchRegistryManifest('https://example.com/registry.json', fetcher)).resolves.toEqual(validateRegistryManifest(manifest));
    expect(() => validateRegistryManifest({ ...manifest, packages: [{ ...manifest.packages[0], url: 'http://bad.test/app.json' }] })).toThrow(
      /must be HTTPS/,
    );
    expect(() => validateRegistryManifest({
      ...manifest,
      packages: [{ ...manifest.packages[0], signature: { algorithm: 'ed25519' } }],
    })).toThrow(/packages\[0\]\.signature\.value is required/);
  });

  it('serves bundled registry and demo package without remote fetch', async () => {
    const remoteFetch = vi.fn(async () => {
      throw new Error('remote_fetch_forbidden');
    });
    const fetcher = createPackageInstallFetcher(remoteFetch);
    const manifest = await fetchRegistryManifest(BUNDLED_UTOPIA_REGISTRY_URL, fetcher);
    const bundled = getBundledRegistryManifest();

    expect(new URL(BUNDLED_UTOPIA_REGISTRY_URL).hostname).toBe('bundled.utopia.invalid');
    expect(manifest.packages.every((item) => new URL(item.url).hostname === 'bundled.utopia.invalid')).toBe(true);
    expect(manifest).toEqual(bundled);
    expect(manifest.packages).toHaveLength(7);
    expect(manifest.packages[0]).toMatchObject({
      id: 'scientific-calculator',
      name: 'Scientific Calculator',
      url: BUNDLED_DEMO_PACKAGE_URL,
    });
    expect(manifest.packages[1]).toMatchObject({
      id: 'audio-loop-108',
      name: 'Audio Loop',
      url: BUNDLED_AUDIO_LOOP_PACKAGE_URL,
    });
    expect(manifest.packages.slice(2)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'habit-grid', url: BUNDLED_HABIT_GRID_PACKAGE_URL }),
      expect.objectContaining({ id: 'expense-splitter', url: BUNDLED_EXPENSE_SPLITTER_PACKAGE_URL }),
      expect.objectContaining({ id: 'split-rent', url: BUNDLED_SPLIT_RENT_PACKAGE_URL }),
      expect.objectContaining({ id: 'workout-logger', url: BUNDLED_WORKOUT_LOGGER_PACKAGE_URL }),
      expect.objectContaining({ id: 'focus-intervals', url: BUNDLED_FOCUS_INTERVALS_PACKAGE_URL }),
    ]));

    const candidate = await fetchPackageInstallCandidate(BUNDLED_DEMO_PACKAGE_URL, fetcher, {
      registryPackage: manifest.packages[0],
    });
    expect(candidate.preview.packageId).toBe('scientific-calculator');
    expect(candidate.preview.status).toBe('ready_for_review');
    expect(candidate.preview.trust.status).toBe('checksum_verified');
    expect(candidate.preview.approvalRequired).toBe(true);

    const audioLoopCandidate = await fetchPackageInstallCandidate(BUNDLED_AUDIO_LOOP_PACKAGE_URL, fetcher, {
      registryPackage: manifest.packages[1],
    });
    expect(audioLoopCandidate.preview.packageId).toBe('audio-loop-108');
    expect(audioLoopCandidate.preview.widgetsRequired).toContain('audioLoopPlayer');
    expect(audioLoopCandidate.preview.status).toBe('ready_for_review');
    expect(audioLoopCandidate.preview.trust.status).toBe('checksum_verified');

    const expensePackage = manifest.packages.find((item) => item.id === 'expense-splitter')!;
    const expenseCandidate = await fetchPackageInstallCandidate(
      BUNDLED_EXPENSE_SPLITTER_PACKAGE_URL,
      fetcher,
      { registryPackage: expensePackage },
    );
    expect(expenseCandidate.preview.widgetsRequired).toContain('dataTable');
    expect(expenseCandidate.preview.trust.status).toBe('checksum_verified');
    expect(remoteFetch).not.toHaveBeenCalled();
  });

  it('builds review-only preview with checksum trust metadata', async () => {
    const checksum = sha256Canonical(packageFixture);
    const publisher = {
      id: 'demo.publisher',
      name: 'Demo Publisher',
      homepage: 'https://example.com/demo-publisher',
      verified: true,
    };
    const signature = await signPackageFixture(packageFixture, 'demo-key-1');
    const fetcher = jsonFetcher({
      'https://example.com/apps/demo.package.json': packageFixture,
    });

    const result = await fetchPackageInstallCandidate(
      'wonder://install?url=https%3A%2F%2Fexample.com%2Fapps%2Fdemo.package.json',
      fetcher,
      {
        registryPackage: { ...registryFixture.packages[0], checksum, publisher, signature },
      },
    );

    expect(result.preview).toMatchObject({
      schemaVersion: 'utopia.install-preview.v1',
      status: 'ready_for_review',
      approvalRequired: true,
      appName: 'Demo Shelf',
      description: 'Portable demo app.',
      packageId: 'demo.shelf',
      version: '1.0.0',
      sourceUrl: 'https://example.com/apps/demo.package.json',
      runtimeCompatibility: { status: 'compatible', reasons: [] },
      trust: {
        status: 'checksum_verified',
        checksum,
        computedChecksum: checksum,
        publisher,
        signatureStatus: 'signature_present_untrusted',
        signatureAlgorithm: 'ecdsa-p256-sha256',
        signatureKeyId: 'demo-key-1',
        signatureSignedAt: '2026-07-28T00:00:00.000Z',
      },
    });
    expect(result.preview.screensIncluded).toEqual(['home', 'review']);
    expect(result.preview.dataCollections).toEqual(['task']);
    expect(result.preview.providersRequested).toEqual(['provider:notion']);
    expect(result.preview.widgetsRequired).toEqual(['metricTile']);
    expect(packageInstallTrustLabel(result.preview)).toBe('Checksum verified');
    expect(packageInstallTrustSummary(result.preview)).toMatchObject({
      statusLabel: 'Ready for review',
      trustLabel: 'Checksum verified',
      trustTone: 'unknown',
      publisherLabel: 'Demo Publisher',
      signatureLabel: 'Signature present but publisher is untrusted (demo-key-1)',
      selfSignatureLabel: 'Signature present but publisher is untrusted (demo-key-1)',
      publisherTrustLabel: 'Publisher is not trusted by Utopia',
      tufMetadataLabel: 'TUF metadata missing',
      approvalLabel: 'Review required',
    });
    expect(packageInstallSignatureLabel(result.preview)).toBe('Signature present but publisher is untrusted (demo-key-1)');
    expect(result.preview.installDisclosures).toEqual(expect.arrayContaining([
      'Utopia shows package data collections, providers, and permissions during install review.',
      'Data collections: task',
      'Providers: provider:notion',
      'No native permissions requested.',
    ]));
    expect(result.preview.publishDisclosures).toEqual(UTOPIA_PUBLISH_DISCLOSURE_LINES);
    expect(buildPackageInstallReviewViewModel(result.preview)).toMatchObject({
      title: 'Demo Shelf',
      identityRows: [
        { label: 'Package ID', values: ['demo.shelf'] },
        { label: 'Version', values: ['1.0.0'] },
        { label: 'Source', values: ['https://example.com/apps/demo.package.json'] },
      ],
      blockingReasons: [],
      primaryActionLabel: 'Install app',
    });
    expect(packageInstallPreviewRows(result.preview)).toEqual([
      { label: 'Screens', values: ['home', 'review'] },
      { label: 'Collections', values: ['task'] },
      { label: 'Providers', values: ['provider:notion'] },
      { label: 'Native permissions', values: [] },
      { label: 'Widgets', values: ['metricTile'] },
      { label: 'Plugins', values: ['plugin:metricTile'] },
      { label: 'Fallbacks', values: [] },
    ]);

    const approval = buildPackageInstallApprovalReceipt(result.preview, 'test-user', '2026-07-27T00:00:00.000Z');
    expect(approval).toMatchObject({
      schemaVersion: 'utopia.install-approval.v1',
      approved: true,
      sourceUrl: 'https://example.com/apps/demo.package.json',
      packageId: 'demo.shelf',
      version: '1.0.0',
      checksum,
      approvedBy: 'test-user',
      approvedAt: '2026-07-27T00:00:00.000Z',
    });
    expect(() => assertPackageInstallApprovalMatchesPreview(approval, result.preview)).not.toThrow();
    expect(() => assertPackageInstallApprovalMatchesPreview({ ...approval, version: '2.0.0' }, result.preview)).toThrow(
      'package_install_approval_mismatch',
    );
  });

  it('blocks tampered package payloads when registry signature verification fails', async () => {
    const signature = await signPackageFixture(packageFixture, 'demo-key-1');
    const tamperedPackage = clone(packageFixture);
    tamperedPackage.presentation.label = 'Tampered Shelf';
    const checksum = sha256Canonical(tamperedPackage);

    const preview = await buildPackageInstallPreviewWithSignatureVerification(tamperedPackage, {
      sourceUrl: 'https://example.com/apps/demo.package.json',
      expectedChecksum: checksum,
      registryPackage: {
        ...registryFixture.packages[0],
        checksum,
        signature,
      },
    });

    expect(preview.status).toBe('blocked');
    expect(preview.trust).toMatchObject({
      status: 'checksum_verified',
      checksum,
      computedChecksum: checksum,
      signatureStatus: 'signature_invalid',
    });
    expect(preview.validationErrors).toEqual(expect.arrayContaining([
      expect.stringContaining('signature verification failed'),
    ]));
    expect(packageInstallTrustLabel(preview)).toBe('Publisher signature invalid');
    expect(packageInstallSignatureLabel(preview)).toBe('Signature invalid');
    expect(() => buildPackageInstallApprovalReceipt(preview, 'test-user')).toThrow('package_install_preview_blocked');
  });

  it('does not treat a legacy policy or embedded key as publisher trust', async () => {
    const signature = await signPackageFixture(packageFixture, 'demo-key-1');
    const { publicKey, ...signatureWithoutInlineKey } = signature;
    const registryPackage = {
      ...registryFixture.packages[0],
      checksum: sha256Canonical(packageFixture),
      publisher: {
        id: 'demo.publisher',
        name: 'Demo Publisher',
        verified: true,
      },
      signature: signatureWithoutInlineKey,
    };
    const trustPolicy = {
      schemaVersion: 'utopia.trust-policy.v1' as const,
      name: 'Test Trust Root',
      trustedKeys: [{
        publisherId: 'demo.publisher',
        keyId: 'demo-key-1',
        algorithm: 'ecdsa-p256-sha256' as const,
        publicKey,
        status: 'trusted' as const,
      }],
    };

    expect(resolveRegistrySignatureTrust({ policy: trustPolicy, registryPackage })).toEqual({
      trusted: true,
      publicKey,
    });

    const preview = await buildPackageInstallPreviewWithSignatureVerification(packageFixture, {
      sourceUrl: 'https://example.com/apps/demo.package.json',
      registryPackage,
    });

    expect(preview.status).toBe('ready_for_review');
    expect(preview.trust.signatureStatus).toBe('signature_present_untrusted');
    expect(preview.trust.publisherTrustStatus).toBe('unknown');
    expect(preview.trust.tufMetadata.status).toBe('missing');
    expect(packageInstallSignatureLabel(preview)).toContain('publisher is untrusted');
  });

  it('blocks expired registry trust metadata before install approval', () => {
    const checksum = sha256Canonical(packageFixture);
    const preview = buildPackageInstallPreview(packageFixture, {
      sourceUrl: 'https://example.com/apps/demo.package.json',
      expectedChecksum: checksum,
      registryPackage: {
        ...registryFixture.packages[0],
        checksum,
        publisher: { id: 'demo.publisher' },
      },
      registryTrustMetadata: {
        root: {
          schemaVersion: 'utopia.extension-trust-root.v1',
          version: 4,
          expires: '2026-07-29T00:00:00.000Z',
          rootKeyId: 'root-key',
          delegatedPublishers: [],
          signature: { algorithm: 'ecdsa-p256-sha256', keyId: 'root-key', value: 'root-signature', signedAt: '2026-07-20T00:00:00.000Z' },
        },
        targets: [{
          schemaVersion: 'utopia.extension-trust-targets.v1',
          publisherId: 'demo.publisher',
          version: 7,
          expires: '2026-08-30T00:00:00.000Z',
          delegatedSigningKeyIds: ['publisher-key'],
          signature: { algorithm: 'ecdsa-p256-sha256', keyId: 'publisher-key', value: 'targets-signature', signedAt: '2026-07-20T00:00:00.000Z' },
        }],
      },
      trustNow: '2026-07-30T00:00:00.000Z',
    });

    expect(preview.status).toBe('blocked');
    expect(preview.trust.tufMetadata).toMatchObject({
      status: 'blocked',
      rootVersion: 4,
    });
    expect(preview.validationErrors).toContain('trust.root expired');
    expect(packageInstallTrustSummary(preview).tufMetadataLabel).toContain('TUF metadata blocked');
  });

  it('blocks registry trust metadata below the persisted rollback floor', () => {
    const checksum = sha256Canonical(packageFixture);
    const preview = buildPackageInstallPreview(packageFixture, {
      sourceUrl: 'https://example.com/apps/demo.package.json',
      expectedChecksum: checksum,
      registryPackage: {
        ...registryFixture.packages[0],
        checksum,
        publisher: { id: 'demo.publisher' },
      },
      registryTrustMetadata: {
        root: {
          schemaVersion: 'utopia.extension-trust-root.v1',
          version: 4,
          expires: '2026-08-30T00:00:00.000Z',
          rootKeyId: 'root-key',
          delegatedPublishers: [{
            publisherId: 'demo.publisher',
            extensionIdPatterns: ['*'],
            delegatedSigningKeyIds: ['publisher-key'],
          }],
          signature: { algorithm: 'ecdsa-p256-sha256', keyId: 'root-key', value: 'root-signature', signedAt: '2026-07-20T00:00:00.000Z' },
        },
        targets: [{
          schemaVersion: 'utopia.extension-trust-targets.v1',
          publisherId: 'demo.publisher',
          version: 7,
          expires: '2026-08-30T00:00:00.000Z',
          delegatedSigningKeyIds: ['publisher-key'],
          signature: { algorithm: 'ecdsa-p256-sha256', keyId: 'publisher-key', value: 'targets-signature', signedAt: '2026-07-20T00:00:00.000Z' },
        }],
      },
      trustFloor: {
        minimumAcceptedRootVersion: 5,
        minimumAcceptedTargetsVersionByPublisher: { 'demo.publisher': 8 },
      },
      trustNow: '2026-07-30T00:00:00.000Z',
    });

    expect(preview.status).toBe('blocked');
    expect(preview.trust.tufMetadata.status).toBe('blocked');
    expect(preview.validationErrors).toEqual(expect.arrayContaining([
      'trust.root version rollback',
      'trust.targets[0] version rollback',
    ]));
  });

  it('shows structurally valid but unverified TUF metadata without granting a green trust tone', () => {
    const checksum = sha256Canonical(packageFixture);
    const preview = buildPackageInstallPreview(packageFixture, {
      sourceUrl: 'https://example.com/apps/demo.package.json',
      expectedChecksum: checksum,
      registryPackage: {
        ...registryFixture.packages[0],
        checksum,
        publisher: { id: 'demo.publisher' },
      },
      registryTrustMetadata: {
        root: {
          schemaVersion: 'utopia.extension-trust-root.v1',
          version: 6,
          expires: '2026-08-30T00:00:00.000Z',
          rootKeyId: 'root-key',
          delegatedPublishers: [{
            publisherId: 'demo.publisher',
            extensionIdPatterns: ['*'],
            delegatedSigningKeyIds: ['publisher-key'],
          }],
          signature: { algorithm: 'ecdsa-p256-sha256', keyId: 'root-key', value: 'root-signature', signedAt: '2026-07-20T00:00:00.000Z' },
        },
        targets: [{
          schemaVersion: 'utopia.extension-trust-targets.v1',
          publisherId: 'demo.publisher',
          version: 9,
          expires: '2026-08-30T00:00:00.000Z',
          delegatedSigningKeyIds: ['publisher-key'],
          signature: { algorithm: 'ecdsa-p256-sha256', keyId: 'publisher-key', value: 'targets-signature', signedAt: '2026-07-20T00:00:00.000Z' },
        }],
      },
      trustNow: '2026-07-30T00:00:00.000Z',
    });

    expect(preview.status).toBe('ready_for_review');
    expect(preview.trust.tufMetadata).toMatchObject({
      status: 'present_unverified',
      rootVersion: 6,
      targetsVersion: 9,
    });
    expect(packageInstallTrustSummary(preview)).toMatchObject({ trustTone: 'unknown' });
  });

  it('blocks signed registry packages when the public key is not in the trust root', async () => {
    const signature = await signPackageFixture(packageFixture, 'demo-key-1');
    const registryPackage = {
      ...registryFixture.packages[0],
      checksum: sha256Canonical(packageFixture),
      publisher: { id: 'demo.publisher' },
      signature: {
        ...signature,
        publicKey: 'not-the-trusted-key',
      },
    };
    const preview = await buildPackageInstallPreviewWithSignatureVerification(packageFixture, {
      sourceUrl: 'https://example.com/apps/demo.package.json',
      registryPackage,
    });

    expect(preview.status).toBe('blocked');
    expect(preview.trust.signatureStatus).toBe('signature_invalid');
    expect(preview.validationErrors).toEqual(expect.arrayContaining([
      expect.stringContaining('signature verification failed'),
    ]));
  });

  it('keeps unknown remote packages review-only and checksum-unverified', () => {
    const preview = buildPackageInstallPreview(packageFixture, {
      sourceUrl: 'https://example.com/apps/unknown.package.json',
    });

    expect(preview.status).toBe('ready_for_review');
    expect(preview.trust).toMatchObject({
      status: 'checksum_missing',
      computedChecksum: sha256Canonical(packageFixture),
      signatureStatus: 'signature_missing',
    });
    expect(packageInstallTrustLabel(preview)).toBe('Unknown remote package - review required');
    expect(packageInstallTrustSummary(preview)).toMatchObject({
      trustTone: 'unknown',
      publisherLabel: 'Unknown publisher',
      signatureLabel: 'Signature missing',
      approvalLabel: 'Review required',
    });
    expect(preview.validationErrors).toEqual([]);
  });

  it('blocks invalid signature metadata while preserving checksum result', () => {
    const checksum = sha256Canonical(packageFixture);
    const preview = buildPackageInstallPreview(packageFixture, {
      sourceUrl: 'https://example.com/apps/demo.package.json',
      expectedChecksum: checksum,
      registryPackage: {
        ...registryFixture.packages[0],
        checksum,
        signature: {
          algorithm: 'ed25519',
          signedAt: 'not-a-date',
        },
      },
    });

    expect(preview.status).toBe('blocked');
    expect(preview.trust).toMatchObject({
      status: 'checksum_verified',
      checksum,
      computedChecksum: checksum,
      signatureStatus: 'signature_invalid',
    });
    expect(packageInstallTrustLabel(preview)).toBe('Publisher signature invalid');
    expect(packageInstallSignatureLabel(preview)).toBe('Signature invalid');
    expect(packageInstallTrustSummary(preview)).toMatchObject({
      statusLabel: 'Blocked',
      trustTone: 'blocked',
      approvalLabel: 'Install blocked',
    });
    expect(buildPackageInstallReviewViewModel(preview).blockingReasons)
      .toContain('signature.value is required|signature.signedAt must be ISO date');
    expect(preview.validationErrors).toContain('signature.value is required|signature.signedAt must be ISO date');
    expect(() => buildPackageInstallApprovalReceipt(preview, 'test-user')).toThrow('package_install_preview_blocked');
  });

  it('blocks unknown native permissions even when the package checksum matches', () => {
    const riskyPackage = clone(validV3Package);
    riskyPackage.nativeCapabilities.permissions = [
      ...(riskyPackage.nativeCapabilities.permissions ?? []),
      {
        id: 'bluetooth-admin',
        platform: 'android',
        permission: 'android.permission.BLUETOOTH_ADMIN',
        reason: 'Need broad Bluetooth access.',
        required: true,
      },
    ];
    riskyPackage.contractLock.nativeCapabilities = riskyPackage.nativeCapabilities;
    riskyPackage.contractLock.checksum = sha256Canonical({
      schemaVersion: riskyPackage.contractLock.schemaVersion,
      algorithm: riskyPackage.contractLock.algorithm,
      pinnedAt: riskyPackage.contractLock.pinnedAt,
      dependencyPins: riskyPackage.contractLock.dependencyPins,
      nativeCapabilities: riskyPackage.contractLock.nativeCapabilities,
    });

    const checksum = sha256Canonical(riskyPackage);
    const preview = buildPackageInstallPreview(riskyPackage, {
      sourceUrl: 'https://example.com/apps/risky.package.json',
      expectedChecksum: checksum,
      registryPackage: {
        id: riskyPackage.id,
        name: riskyPackage.presentation?.label ?? riskyPackage.id,
        version: riskyPackage.version,
        url: 'https://example.com/apps/risky.package.json',
        checksum,
      },
    });

    expect(preview.status).toBe('blocked');
    expect(preview.trust).toMatchObject({
      status: 'checksum_verified',
      checksum,
      computedChecksum: checksum,
    });
    expect(preview.runtimeCompatibility.status).toBe('blocked');
    expect(preview.runtimeCompatibility.reasons).toContain('unsupported native permission:android.permission.BLUETOOTH_ADMIN');
    expect(preview.validationErrors).toContain('unsupported native permission:android.permission.BLUETOOTH_ADMIN');
    expect(packageInstallTrustLabel(preview)).toBe('Checksum verified');
    expect(buildPackageInstallReviewViewModel(preview).capabilityRows).toContainEqual({
      label: 'Requested permission',
      value: 'android.permission.BLUETOOTH_ADMIN - unsupported native permission:android.permission.BLUETOOTH_ADMIN',
      tone: 'blocked',
    });
    expect(() => buildPackageInstallApprovalReceipt(preview, 'test-user')).toThrow('package_install_preview_blocked');
  });

  it('allows optional planned capabilities while surfacing matrix support findings', () => {
    const packageWithOptionalSpeech = clone(validV3Package);
    packageWithOptionalSpeech.nativeCapabilities.permissions = [
      ...(packageWithOptionalSpeech.nativeCapabilities.permissions ?? []),
      {
        id: 'speech-dictation',
        platform: 'ios',
        permission: 'ios.permission.speech',
        reason: 'Let users dictate notes when the runtime supports it.',
        required: false,
      },
    ];
    packageWithOptionalSpeech.contractLock.nativeCapabilities = packageWithOptionalSpeech.nativeCapabilities;
    packageWithOptionalSpeech.contractLock.checksum = sha256Canonical({
      schemaVersion: packageWithOptionalSpeech.contractLock.schemaVersion,
      algorithm: packageWithOptionalSpeech.contractLock.algorithm,
      pinnedAt: packageWithOptionalSpeech.contractLock.pinnedAt,
      dependencyPins: packageWithOptionalSpeech.contractLock.dependencyPins,
      nativeCapabilities: packageWithOptionalSpeech.contractLock.nativeCapabilities,
    });

    const checksum = sha256Canonical(packageWithOptionalSpeech);
    const preview = buildPackageInstallPreview(packageWithOptionalSpeech, {
      sourceUrl: 'https://example.com/apps/speech.package.json',
      expectedChecksum: checksum,
    });

    expect(preview.status).toBe('ready_for_review');
    expect(preview.runtimeCompatibility.status).toBe('compatible');
    expect(preview.nativeCapabilitySupport).toContainEqual(expect.objectContaining({
      id: 'ios.permission.speech',
      required: false,
      message: 'native permission unavailable:ios.permission.speech (ios:planned)',
    }));
  });

  it('blocks required planned capabilities before approval', () => {
    const packageWithRequiredSpeech = clone(validV3Package);
    packageWithRequiredSpeech.nativeCapabilities.permissions = [
      ...(packageWithRequiredSpeech.nativeCapabilities.permissions ?? []),
      {
        id: 'speech-dictation',
        platform: 'ios',
        permission: 'ios.permission.speech',
        reason: 'This app cannot work without speech.',
        required: true,
      },
    ];
    packageWithRequiredSpeech.contractLock.nativeCapabilities = packageWithRequiredSpeech.nativeCapabilities;
    packageWithRequiredSpeech.contractLock.checksum = sha256Canonical({
      schemaVersion: packageWithRequiredSpeech.contractLock.schemaVersion,
      algorithm: packageWithRequiredSpeech.contractLock.algorithm,
      pinnedAt: packageWithRequiredSpeech.contractLock.pinnedAt,
      dependencyPins: packageWithRequiredSpeech.contractLock.dependencyPins,
      nativeCapabilities: packageWithRequiredSpeech.contractLock.nativeCapabilities,
    });

    const checksum = sha256Canonical(packageWithRequiredSpeech);
    const preview = buildPackageInstallPreview(packageWithRequiredSpeech, {
      sourceUrl: 'https://example.com/apps/speech.package.json',
      expectedChecksum: checksum,
    });

    expect(preview.status).toBe('blocked');
    expect(preview.validationErrors).toContain('native permission unavailable:ios.permission.speech (ios:planned)');
    expect(() => buildPackageInstallApprovalReceipt(preview, 'test-user')).toThrow('package_install_preview_blocked');
  });

  it('rejects registry descriptors whose bound identity does not match the fetched package', async () => {
    const fetcher = jsonFetcher({
      'https://example.com/apps/demo.package.json': packageFixture,
    });

    await expect(fetchPackageInstallCandidate(
      'https://example.com/apps/demo.package.json',
      fetcher,
      {
        registryPackage: { ...registryFixture.packages[0], id: 'wrong.app', version: '9.9.9' },
      },
    )).rejects.toThrow('package_descriptor_identity_mismatch:wrong.app@9.9.9');
  });

  it('blocks invalid package and checksum mismatch without activating anything', () => {
    const invalid = { schemaVersion: 'wonder.app-package.v2' };
    const preview = buildPackageInstallPreview(invalid, {
      sourceUrl: 'https://example.com/apps/bad.package.json',
      expectedChecksum: `sha256:${'0'.repeat(64)}`,
    });

    expect(preview.status).toBe('blocked');
    expect(preview.approvalRequired).toBe(true);
    expect(preview.packageId).toBeNull();
    expect(preview.trust.status).toBe('checksum_mismatch');
    expect(packageInstallTrustLabel(preview)).toBe('Checksum mismatch');
    expect(packageInstallTrustSummary(preview)).toMatchObject({
      statusLabel: 'Blocked',
      trustLabel: 'Checksum mismatch',
      trustTone: 'blocked',
      approvalLabel: 'Install blocked',
    });
    expect(preview.validationErrors).toContain('id is required');
    expect(preview.validationErrors).toContain('checksum mismatch');
    expect(() => buildPackageInstallApprovalReceipt(preview, 'test-user')).toThrow('package_install_preview_blocked');
  });

  it('summarizes installation lifecycle actions for active and archived apps', () => {
    expect(buildAppInstallationLifecycleViewModel({
      id: 'demo-install',
      workspaceId: 'default-workspace',
      label: 'Demo Shelf',
      status: 'active',
      packageBinding: {
        packageKey: 'demo.shelf@1.0.0',
        packageId: 'demo.shelf',
        version: '1.0.0',
        sourceUrl: 'https://example.com/apps/demo.package.json',
        checksum: 'sha256:1234',
      },
      approval: {
        approvalHash: 'sha256:approval',
        approvedBy: 'test-user',
      },
      activation: {
        launchPath: '/apps/demo-install',
        activePackageKey: 'demo.shelf@1.0.0',
        previousPackageKey: null,
        updatedAt: '2026-07-28T00:00:00.000Z',
      },
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
    })).toMatchObject({
      statusLabel: 'Active',
      statusTone: 'verified',
      packageIdLabel: 'demo.shelf',
      actionLabel: 'Uninstall app',
      canOpen: true,
    });

    expect(buildAppInstallationLifecycleViewModel({
      id: 'demo-install',
      workspaceId: 'default-workspace',
      label: 'Demo Shelf',
      status: 'archived',
      packageBinding: {
        packageKey: 'demo.shelf@1.0.0',
        packageId: 'demo.shelf',
        version: '1.0.0',
        sourceUrl: 'https://example.com/apps/demo.package.json',
        checksum: 'sha256:1234',
      },
      approval: {
        approvalHash: 'sha256:approval',
        approvedBy: 'test-user',
      },
      activation: {
        launchPath: '/apps/demo-install',
        activePackageKey: 'demo.shelf@1.0.0',
        previousPackageKey: null,
        updatedAt: '2026-07-28T00:00:00.000Z',
      },
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
    })).toMatchObject({
      statusLabel: 'Uninstalled',
      statusTone: 'unknown',
      actionLabel: 'Restore app',
      canOpen: false,
      canRestore: true,
    });

    expect(buildAppInstallationLifecycleViewModel({
      id: 'demo-install',
      workspaceId: 'default-workspace',
      label: 'Demo Shelf',
      status: 'disabled',
      packageBinding: {
        packageKey: 'demo.shelf@1.0.0',
        packageId: 'demo.shelf',
        version: '1.0.0',
        sourceUrl: 'https://example.com/apps/demo.package.json',
        checksum: 'sha256:1234',
      },
      approval: {
        approvalHash: 'sha256:approval',
        approvedBy: 'test-user',
      },
      activation: {
        launchPath: '/apps/demo-install',
        activePackageKey: 'demo.shelf@1.0.0',
        previousPackageKey: null,
        updatedAt: '2026-07-28T00:00:00.000Z',
      },
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
    })).toMatchObject({
      statusLabel: 'Disabled',
      statusTone: 'blocked',
      actionLabel: 'Review required',
      actionHint: 'This app cannot be restored until the disabling reason is resolved.',
      canOpen: false,
      canRestore: false,
    });
  });
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

async function signPackageFixture(value: unknown, keyId: string) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('webcrypto_unavailable');
  const keyPair = await subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const signature = await subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    new TextEncoder().encode(canonicalJson(value)),
  );
  const publicKey = await subtle.exportKey('spki', keyPair.publicKey);
  return {
    algorithm: 'ecdsa-p256-sha256',
    keyId,
    publicKey: Buffer.from(publicKey).toString('base64'),
    value: Buffer.from(signature).toString('base64'),
    signedAt: '2026-07-28T00:00:00.000Z',
  };
}

function jsonFetcher(routes: Record<string, unknown>): PackageInstallFetcher {
  return async (url) => {
    if (!Object.hasOwn(routes, url)) return { ok: false, status: 404 };
    return {
      ok: true,
      status: 200,
      headers: {
        get: (name) => name.toLowerCase() === 'content-type' ? 'application/json' : null,
      },
      json: async () => routes[url],
    };
  };
}
