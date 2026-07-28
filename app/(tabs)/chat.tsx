import { useLocalSearchParams } from 'expo-router';

import { JsonRenderRoute } from '@/src/presentation/json-render-route';

export default function ChatScreen() {
  const params = useLocalSearchParams<{ prompt?: string; run?: string }>();
  const prompt = Array.isArray(params.prompt) ? params.prompt[0] : params.prompt;
  const run = Array.isArray(params.run) ? params.run[0] : params.run;
  return <JsonRenderRoute screen="chat" initialPrompt={prompt} autoSubmitPrompt={run === '1'} />;
}
