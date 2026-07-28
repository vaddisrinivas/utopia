declare module 'json-logic-js' {
  const jsonLogic: {
    apply(rule: unknown, data?: unknown): unknown;
  };
  export default jsonLogic;
}
