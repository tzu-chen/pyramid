export const UNICODE_MAP: Record<string, string> = {
  '\\forall': '\u2200', '\\exists': '\u2203', '\\lam': '\u03BB', '\\fun': '\u03BB',
  '\\to': '\u2192', '\\rightarrow': '\u2192', '\\leftarrow': '\u2190', '\\iff': '\u2194',
  '\\leftrightarrow': '\u2194', '\\mapsto': '\u21A6',
  '\\R': '\u211D', '\\N': '\u2115', '\\Z': '\u2124', '\\Q': '\u211A', '\\C': '\u2102',
  '\\alpha': '\u03B1', '\\beta': '\u03B2', '\\gamma': '\u03B3', '\\delta': '\u03B4',
  '\\epsilon': '\u03B5', '\\varepsilon': '\u03B5', '\\zeta': '\u03B6', '\\eta': '\u03B7',
  '\\theta': '\u03B8', '\\iota': '\u03B9', '\\kappa': '\u03BA', '\\mu': '\u03BC',
  '\\nu': '\u03BD', '\\xi': '\u03BE', '\\pi': '\u03C0', '\\rho': '\u03C1',
  '\\sigma': '\u03C3', '\\tau': '\u03C4', '\\upsilon': '\u03C5', '\\phi': '\u03C6',
  '\\varphi': '\u03C6', '\\chi': '\u03C7', '\\psi': '\u03C8', '\\omega': '\u03C9',
  '\\Gamma': '\u0393', '\\Delta': '\u0394', '\\Theta': '\u0398', '\\Lambda': '\u039B',
  '\\Xi': '\u039E', '\\Pi': '\u03A0', '\\Sigma': '\u03A3', '\\Phi': '\u03A6',
  '\\Psi': '\u03A8', '\\Omega': '\u03A9',
  '\\in': '\u2208', '\\notin': '\u2209', '\\ni': '\u220B',
  '\\sub': '\u2282', '\\sup': '\u2283', '\\sube': '\u2286', '\\supe': '\u2287',
  '\\subset': '\u2282', '\\supset': '\u2283', '\\subseteq': '\u2286', '\\supseteq': '\u2287',
  '\\and': '\u2227', '\\or': '\u2228', '\\not': '\u00AC', '\\neg': '\u00AC',
  '\\ne': '\u2260', '\\neq': '\u2260', '\\le': '\u2264', '\\ge': '\u2265',
  '\\leq': '\u2264', '\\geq': '\u2265', '\\lt': '<', '\\gt': '>',
  '\\inf': '\u221E', '\\infty': '\u221E', '\\infinity': '\u221E',
  '\\times': '\u00D7', '\\cross': '\u00D7', '\\cdot': '\u00B7', '\\circ': '\u2218',
  '\\comp': '\u2218', '\\oplus': '\u2295', '\\otimes': '\u2297',
  '\\union': '\u222A', '\\inter': '\u2229', '\\cup': '\u222A', '\\cap': '\u2229',
  '\\empty': '\u2205', '\\emptyset': '\u2205',
  '\\langle': '\u27E8', '\\rangle': '\u27E9', '\\lang': '\u27E8', '\\rang': '\u27E9',
  '\\vdash': '\u22A2', '\\dashv': '\u22A3', '\\models': '\u22A8',
  '\\top': '\u22A4', '\\bot': '\u22A5',
  '\\partial': '\u2202', '\\nabla': '\u2207', '\\sum': '\u2211', '\\prod': '\u220F',
  '\\int': '\u222B',
  '\\equiv': '\u2261', '\\approx': '\u2248', '\\cong': '\u2245', '\\sim': '\u223C',
  '\\pm': '\u00B1', '\\mp': '\u2213',
  '\\b0': '\u2080', '\\b1': '\u2081', '\\b2': '\u2082', '\\b3': '\u2083',
  '\\b4': '\u2084', '\\b5': '\u2085', '\\b6': '\u2086', '\\b7': '\u2087',
  '\\b8': '\u2088', '\\b9': '\u2089',
  '\\0': '\u2070', '\\1': '\u00B9', '\\2': '\u00B2', '\\3': '\u00B3',
  '\\4': '\u2074', '\\5': '\u2075', '\\6': '\u2076', '\\7': '\u2077',
  '\\8': '\u2078', '\\9': '\u2079',
  '\\l': '\u2113',
  '\\triangle': '\u25B3', '\\square': '\u25A1',
  '\\star': '\u22C6', '\\bullet': '\u2022',
};

export interface SymbolEntry {
  key: string;
  char: string;
}

export interface SymbolGroup {
  label: string;
  symbols: SymbolEntry[];
}

export const SYMBOL_GROUPS: SymbolGroup[] = [
  {
    label: 'Greek',
    symbols: [
      { key: '\\alpha', char: '\u03B1' },
      { key: '\\beta', char: '\u03B2' },
      { key: '\\gamma', char: '\u03B3' },
      { key: '\\delta', char: '\u03B4' },
      { key: '\\epsilon', char: '\u03B5' },
      { key: '\\theta', char: '\u03B8' },
      { key: '\\lam', char: '\u03BB' },
      { key: '\\mu', char: '\u03BC' },
      { key: '\\pi', char: '\u03C0' },
      { key: '\\sigma', char: '\u03C3' },
      { key: '\\phi', char: '\u03C6' },
      { key: '\\omega', char: '\u03C9' },
      { key: '\\Gamma', char: '\u0393' },
      { key: '\\Delta', char: '\u0394' },
      { key: '\\Sigma', char: '\u03A3' },
      { key: '\\Omega', char: '\u03A9' },
    ],
  },
  {
    label: 'Logic',
    symbols: [
      { key: '\\forall', char: '\u2200' },
      { key: '\\exists', char: '\u2203' },
      { key: '\\and', char: '\u2227' },
      { key: '\\or', char: '\u2228' },
      { key: '\\not', char: '\u00AC' },
      { key: '\\to', char: '\u2192' },
      { key: '\\leftarrow', char: '\u2190' },
      { key: '\\iff', char: '\u2194' },
      { key: '\\mapsto', char: '\u21A6' },
      { key: '\\vdash', char: '\u22A2' },
    ],
  },
  {
    label: 'Sets',
    symbols: [
      { key: '\\in', char: '\u2208' },
      { key: '\\notin', char: '\u2209' },
      { key: '\\sub', char: '\u2282' },
      { key: '\\sube', char: '\u2286' },
      { key: '\\cup', char: '\u222A' },
      { key: '\\cap', char: '\u2229' },
      { key: '\\empty', char: '\u2205' },
    ],
  },
  {
    label: 'Number Sets',
    symbols: [
      { key: '\\N', char: '\u2115' },
      { key: '\\Z', char: '\u2124' },
      { key: '\\Q', char: '\u211A' },
      { key: '\\R', char: '\u211D' },
      { key: '\\C', char: '\u2102' },
    ],
  },
  {
    label: 'Relations',
    symbols: [
      { key: '\\ne', char: '\u2260' },
      { key: '\\le', char: '\u2264' },
      { key: '\\ge', char: '\u2265' },
      { key: '\\equiv', char: '\u2261' },
      { key: '\\approx', char: '\u2248' },
    ],
  },
  {
    label: 'Misc',
    symbols: [
      { key: '\\times', char: '\u00D7' },
      { key: '\\cdot', char: '\u00B7' },
      { key: '\\circ', char: '\u2218' },
      { key: '\\sum', char: '\u2211' },
      { key: '\\prod', char: '\u220F' },
      { key: '\\infty', char: '\u221E' },
      { key: '\\langle', char: '\u27E8' },
      { key: '\\rangle', char: '\u27E9' },
    ],
  },
];
