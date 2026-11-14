/**
 * Path classifiers shared by checks. All paths are posix and repo-relative.
 */

/** Test inputs/outputs: fixtures, snapshot baselines, testdata. Data, not code to maintain. */
const FIXTURE_DIR =
  /(^|\/)(fixtures?|__fixtures__|testdata|test[-_]data|__snapshots__|snapshots?|baselines?|__mocks__|mocks?)\//i;

/** Test code or test data. */
const TEST_DIR = /(^|\/)(tests?|__tests__|spec|specs|e2e|integration[-_]tests?)\//i;
const TEST_FILE =
  /(^|\/)(test_[^/]*\.py|[^/]*_tests?\.(?:py|go|rs)|conftest\.py|[^/]*\.(?:test|spec)\.[cm]?[jt]sx?|tests?\.rs)$/i;

/** Example / tutorial code shipped for users rather than maintained as the product. */
const EXAMPLE_DIR = /(^|\/)(examples?|samples?|docs_src|demos?|playground)\//i;

export function isFixturePath(f: string): boolean {
  return FIXTURE_DIR.test(f);
}

export function isTestPath(f: string): boolean {
  return FIXTURE_DIR.test(f) || TEST_DIR.test(f) || TEST_FILE.test(f);
}

export function isExamplePath(f: string): boolean {
  return EXAMPLE_DIR.test(f);
}

/** Code that is not the product itself: tests, fixtures, examples, docs. */
export function isAuxiliaryPath(f: string): boolean {
  return isTestPath(f) || isExamplePath(f) || /(^|\/)docs?\//i.test(f);
}
