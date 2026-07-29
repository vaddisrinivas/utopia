type CalcToken = { kind: 'number'; value: number } | { kind: 'operator' | 'paren' | 'ident' | 'comma'; value: string };

export function evaluateScientificExpression(rawExpression: string, options: { angleMode: 'deg' | 'rad'; memory: number }): number {
  const tokens = tokenizeCalcExpression(rawExpression);
  let index = 0;

  function peek() {
    return tokens[index] ?? null;
  }

  function take(value?: string) {
    const token = tokens[index] ?? null;
    if (!token) return null;
    if (value !== undefined && token.value !== value) return null;
    index += 1;
    return token;
  }

  function parseExpression(): number {
    let value = parseTerm();
    while (true) {
      if (take('+')) value += parseTerm();
      else if (take('-')) value -= parseTerm();
      else return value;
    }
  }

  function parseTerm(): number {
    let value = parsePower();
    while (true) {
      if (take('*')) value *= parsePower();
      else if (take('/')) value /= parsePower();
      else if (take('%')) value %= parsePower();
      else return value;
    }
  }

  function parsePower(): number {
    let value = parseUnary();
    if (take('^')) {
      value = Math.pow(value, parsePower());
    }
    return value;
  }

  function parseUnary(): number {
    if (take('+')) return parseUnary();
    if (take('-')) return -parseUnary();
    return parsePostfix();
  }

  function parsePostfix(): number {
    let value = parsePrimary();
    while (take('!')) {
      value = factorial(value);
    }
    return value;
  }

  function parsePrimary(): number {
    const token = peek();
    if (!token) throw new Error('Missing value');
    if (token.kind === 'number') {
      index += 1;
      return token.value;
    }
    if (take('(')) {
      const value = parseExpression();
      if (!take(')')) throw new Error('Missing )');
      return value;
    }
    if (token.kind === 'ident') {
      index += 1;
      const name = token.value.toLowerCase();
      if (name === 'pi') return Math.PI;
      if (name === 'e') return Math.E;
      if (name === 'm') return options.memory;
      if (!take('(')) throw new Error(`${name} needs (`);
      const arg = parseExpression();
      if (!take(')')) throw new Error('Missing )');
      return applyCalcFunction(name, arg, options.angleMode);
    }
    throw new Error(`Unexpected ${token.value}`);
  }

  const value = parseExpression();
  if (index < tokens.length) throw new Error(`Unexpected ${tokens[index].value}`);
  if (!Number.isFinite(value)) throw new Error('Result is not finite');
  return value;
}

export function formatCalcValue(value: number): string {
  if (Object.is(value, -0)) return '0';
  if (Math.abs(value) >= 1e12 || (Math.abs(value) > 0 && Math.abs(value) < 1e-9)) {
    return value.toExponential(10).replace(/\.?0+e/, 'e');
  }
  return Number(value.toPrecision(12)).toString();
}

function tokenizeCalcExpression(expression: string): CalcToken[] {
  const tokens: CalcToken[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const start = index;
      index += 1;
      while (index < expression.length && /[0-9.eE]/.test(expression[index])) index += 1;
      if ((expression[index] === '+' || expression[index] === '-') && /e$/i.test(expression.slice(start, index))) {
        index += 1;
        while (index < expression.length && /[0-9]/.test(expression[index])) index += 1;
      }
      const value = Number(expression.slice(start, index));
      if (!Number.isFinite(value)) throw new Error('Invalid number');
      tokens.push({ kind: 'number', value });
      continue;
    }
    if (/[A-Za-z]/.test(char)) {
      const start = index;
      index += 1;
      while (index < expression.length && /[A-Za-z0-9_]/.test(expression[index])) index += 1;
      tokens.push({ kind: 'ident', value: expression.slice(start, index) });
      continue;
    }
    if ('+-*/%^!'.includes(char)) {
      tokens.push({ kind: 'operator', value: char });
      index += 1;
      continue;
    }
    if ('()'.includes(char)) {
      tokens.push({ kind: 'paren', value: char });
      index += 1;
      continue;
    }
    if (char === ',') {
      tokens.push({ kind: 'comma', value: char });
      index += 1;
      continue;
    }
    throw new Error(`Invalid ${char}`);
  }
  return tokens;
}

function applyCalcFunction(name: string, arg: number, angleMode: 'deg' | 'rad'): number {
  const angle = angleMode === 'deg' ? arg * Math.PI / 180 : arg;
  switch (name) {
    case 'sin': return Math.sin(angle);
    case 'cos': return Math.cos(angle);
    case 'tan': return Math.tan(angle);
    case 'asin': return angleMode === 'deg' ? Math.asin(arg) * 180 / Math.PI : Math.asin(arg);
    case 'acos': return angleMode === 'deg' ? Math.acos(arg) * 180 / Math.PI : Math.acos(arg);
    case 'atan': return angleMode === 'deg' ? Math.atan(arg) * 180 / Math.PI : Math.atan(arg);
    case 'sqrt': return Math.sqrt(arg);
    case 'ln': return Math.log(arg);
    case 'log':
    case 'log10': return Math.log10(arg);
    case 'exp': return Math.exp(arg);
    case 'abs': return Math.abs(arg);
    default: throw new Error(`Unknown ${name}`);
  }
}

function factorial(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 170) throw new Error('Factorial needs integer 0-170');
  let result = 1;
  for (let n = 2; n <= value; n += 1) result *= n;
  return result;
}
