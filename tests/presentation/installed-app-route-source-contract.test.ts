import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(path.join(root, 'app/apps/[installationId].tsx'), 'utf8');

describe('installed app route management affordance', () => {
  it('keeps lifecycle management available without a dominant route-level text button', () => {
    expect(source).toContain("from 'expo-symbols'");
    expect(source).toContain('const isPhone = width < 600');
    expect(source).toContain('styles.manageButtonPhone');
    expect(source).toContain('styles.manageButtonDesktop');
    expect(source).toContain('onHoverIn={() => setManageTooltipVisible(true)}');
    expect(source).toContain('onFocus={() => setManageTooltipVisible(true)}');
    expect(source).toContain('App Library settings');
    expect(source).toContain("accessibilityHint={`Opens App Library settings for ${currentInstallation.label}`}");
    expect(source).toContain("{isPhone ? null : <Text style={styles.manageButtonText}>Manage</Text>}");
    expect(source).toContain("ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz'");
    expect(source).toContain("ios: 'gearshape', android: 'settings', web: 'settings'");
    expect(source).toContain('screenRouteBase={`/apps/${encodeURIComponent(currentInstallation.id)}`}');
  });
});
