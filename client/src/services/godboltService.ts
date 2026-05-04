import { api } from './api';

export interface GodboltCompiler {
  id: string;
  name: string;
  lang: string;
  compilerType?: string;
  semver?: string;
  instructionSet?: string;
}

export interface GodboltAsmSource {
  file?: string | null;
  line?: number | null;
  column?: number | null;
}

export interface GodboltAsmLine {
  text: string;
  source?: GodboltAsmSource | null;
  opcodes?: string[];
}

export interface GodboltCompileResponse {
  code: number;
  asm: GodboltAsmLine[];
  stdout: { text: string }[];
  stderr: { text: string }[];
  execTime?: string;
  compilationOptions?: string[];
  truncated?: boolean;
}

export interface GodboltFilters {
  binary?: boolean;
  binaryObject?: boolean;
  commentOnly?: boolean;
  demangle?: boolean;
  directives?: boolean;
  execute?: boolean;
  intel?: boolean;
  labels?: boolean;
  libraryCode?: boolean;
  trim?: boolean;
}

export interface CompileRequest {
  compilerId: string;
  source: string;
  userArguments?: string;
  filters?: GodboltFilters;
}

export const godboltService = {
  listCompilers(language = 'c++'): Promise<{ language: string; compilers: GodboltCompiler[] }> {
    return api.get(`/godbolt/compilers?lang=${encodeURIComponent(language)}`);
  },
  compile(req: CompileRequest): Promise<GodboltCompileResponse> {
    return api.post('/godbolt/compile', req);
  },
};
