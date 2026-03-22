import { execSync, exec } from 'child_process';
import path from 'path';
import fs from 'fs';

let ojAvailable = false;

try {
  execSync('which oj', { stdio: 'ignore' });
  ojAvailable = true;
} catch {
  ojAvailable = false;
}

export function isOjAvailable(): boolean {
  return ojAvailable;
}

interface ParsedProblem {
  judge: string;
  problem_id: string;
}

export function parseProblemUrl(url: string): ParsedProblem {
  if (url.includes('codeforces.com')) {
    const match = url.match(/problem\/(\d+)\/([A-Z]\d?)/i) || url.match(/contest\/(\d+)\/problem\/([A-Z]\d?)/i);
    return {
      judge: 'codeforces',
      problem_id: match ? `${match[1]}${match[2]}` : '',
    };
  }
  if (url.includes('atcoder.jp')) {
    const match = url.match(/tasks\/(\w+)/);
    return {
      judge: 'atcoder',
      problem_id: match ? match[1] : '',
    };
  }
  if (url.includes('leetcode.com')) {
    const match = url.match(/problems\/([^/]+)/);
    return {
      judge: 'leetcode',
      problem_id: match ? match[1] : '',
    };
  }
  return { judge: 'other', problem_id: '' };
}

interface DownloadedTestCase {
  input: string;
  expected_output: string;
}

export function downloadTestCases(problemUrl: string, workDir: string): Promise<DownloadedTestCase[]> {
  return new Promise((resolve) => {
    if (!ojAvailable) {
      resolve([]);
      return;
    }

    const absDir = path.resolve(workDir);
    const testDir = path.join(absDir, 'test');

    exec(`oj download "${problemUrl}"`, { cwd: absDir, timeout: 30000 }, (error) => {
      if (error || !fs.existsSync(testDir)) {
        resolve([]);
        return;
      }

      const files = fs.readdirSync(testDir);
      const testCases: DownloadedTestCase[] = [];
      const inputFiles = files.filter(f => f.startsWith('sample-') && f.endsWith('.in')).sort();

      for (const inputFile of inputFiles) {
        const outputFile = inputFile.replace('.in', '.out');
        const inputPath = path.join(testDir, inputFile);
        const outputPath = path.join(testDir, outputFile);

        if (fs.existsSync(outputPath)) {
          testCases.push({
            input: fs.readFileSync(inputPath, 'utf-8'),
            expected_output: fs.readFileSync(outputPath, 'utf-8'),
          });
        }
      }

      resolve(testCases);
    });
  });
}
