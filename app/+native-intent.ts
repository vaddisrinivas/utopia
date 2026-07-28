export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  let url: URL;
  try {
    url = new URL(path);
  } catch {
    return path;
  }

  const isSharedPayload = url.hostname === 'expo-sharing' || url.protocol === 'expo-sharing:';
  if (!isSharedPayload) {
    if (url.protocol !== 'utopia:') return path;
    if (url.hostname === 'expo-development-client') return '/';
    const route = [url.hostname, ...url.pathname.split('/')].filter(Boolean).join('/');
    return `/${route}${url.search}${url.hash}`;
  }
  return initial ? '/capture?incomingShare=1' : null;
}
