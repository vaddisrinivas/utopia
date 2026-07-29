module.exports = {
  forbidden: [
    {
      name: 'presentation-no-server-imports',
      from: { path: '(^|/)src/presentation/' },
      to: { path: '(^|/)server/' },
    },
    {
      name: 'server-no-app-imports',
      from: { path: '(^|/)server/src/' },
      to: { path: '(^|/)app/' },
    },
    {
      name: 'providers-stay-isolated',
      from: { path: '(^|/)(src/providers/|server/src/providers/)' },
      to: { path: '(^|/)(app/|src/presentation/|server/src/)' },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules|dist|coverage|\\.expo',
    },
    tsConfig: {
      fileName: './tsconfig.json',
    },
    includeOnly: '(^|/)(app|src|server/src)/',
  },
};
