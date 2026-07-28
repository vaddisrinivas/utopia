import { ScrollViewStyleReset } from 'expo-router/html';
import type { ReactNode } from 'react';

export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <title>Utopia</title>
      </head>
      <body>{children}</body>
    </html>
  );
}

const css = `
body {
  background-color: #F5F4EC;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  overflow-x: hidden;
}

#root {
  max-width: 100vw;
  overflow-x: hidden;
}

a[href],
[role="link"],
[role="button"],
[role="switch"],
button,
input[type="button"],
input[type="submit"] {
  min-width: 44px !important;
  min-height: 44px !important;
}

a[href],
[role="link"],
[role="button"],
button {
  align-items: center !important;
}
`;
