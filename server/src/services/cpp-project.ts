import fs from 'fs';
import path from 'path';

const DEFAULT_CLANGD_CONFIG = `# .clangd — default fallback config
# Used when no compile_commands.json is present (e.g. scratch single-file sessions).
# CMake projects override this automatically via build/<flavor>/compile_commands.json.

CompileFlags:
  Add:
    - -std=c++20
    - -Wall
    - -Wextra
    - -Wpedantic
    - -Wshadow
  # Compiler clangd should pretend it is when discovering system headers.
  # Match what executeFile uses (g++) for consistency.
  Compiler: g++

Diagnostics:
  ClangTidy:
    Add:
      - modernize-*
      - performance-*
      - bugprone-*
      - readability-*
    Remove:
      - modernize-use-trailing-return-type
      - readability-identifier-length
`;

export const cppProject = {
  /**
   * Drops a default .clangd config at the project root if one does not exist.
   * Idempotent — safe to call on every session open.
   */
  ensureClangdConfig(projectPath: string): void {
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }
    const configPath = path.join(projectPath, '.clangd');
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, DEFAULT_CLANGD_CONFIG);
    }
  },
};
