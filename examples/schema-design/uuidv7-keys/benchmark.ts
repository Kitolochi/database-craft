import { randomUUID } from "node:crypto";
import { uuidv7, cuid2 } from "./uuidv7-keys.js";

/**
 * Simple benchmark comparing ID generation and insertion simulation.
 */

function benchmark(name: string, fn: () => string, iterations: number): void {
  const ids: string[] = [];

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ids.push(fn());
  }
  const genTime = performance.now() - start;

  // Simulate B-tree insertion by sorting (sorted = sequential, unsorted = random pages)
  const sortStart = performance.now();
  ids.sort();
  const sortTime = performance.now() - sortStart;

  // Check if IDs were already sorted (UUIDv7 should be)
  const original = [...ids];
  const wasSorted = ids.every((id, i) => i === 0 || id >= original[i - 1]);

  console.log(`${name}:`);
  console.log(`  Generation: ${genTime.toFixed(2)}ms for ${iterations} IDs`);
  console.log(`  Sort time:  ${sortTime.toFixed(2)}ms`);
  console.log(`  Pre-sorted: ${wasSorted ? "YES (B-tree friendly)" : "NO (random page splits)"}`);
  console.log(`  Sample:     ${ids[0]}`);
  console.log(`  Length:     ${ids[0].length} chars`);
  console.log();
}

const N = 100_000;

console.log(`=== ID Generation Benchmark (${N.toLocaleString()} IDs) ===\n`);
benchmark("UUIDv7", uuidv7, N);
benchmark("UUIDv4", randomUUID, N);
benchmark("CUID2", () => cuid2(), N);
